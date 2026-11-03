import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importTakeout, initializeTakeoutStore, previewTakeout, type TakeoutPlan } from '../../packages/adapters/takeout/import.ts';
import { saveUserNote } from '../../packages/storage/user-notes.ts';
import type { UserNoteInput } from '../../packages/contracts/day-snapshot.ts';
import { assignSessions, unassignedSessions } from '../../packages/storage/source-accounts.ts';

export class TakeoutService {
  private previewState?: { token: string; plan: TakeoutPlan; accountId: string | null; expires: number };
  private accountState?: { token: string; accountId: string; sessions: string[]; expires: number };
  constructor(private readonly dbPath: string) {}

  preview(directory: string, sameAccount = false) {
    if (!isAbsolute(directory) || directory.length > 4096) throw new Error('invalid_directory');
    let db: DatabaseSync | undefined;
    try {
      if (existsSync(this.dbPath)) {
        db = new DatabaseSync(this.dbPath, { readOnly: true });
      }
      const plan = previewTakeout(directory, db);
      let accountId: string | null = null;
      if (db && [4, 5].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) {
        if (plan.pendingId) {
          const previous = db.prepare('SELECT account_id FROM import_account_decisions WHERE session_id = ? ORDER BY revision DESC LIMIT 1').get(plan.pendingId);
          accountId = typeof previous?.account_id === 'string' ? previous.account_id : null;
          if (sameAccount && !accountId) throw new Error('pending_account_locked');
        } else if (sameAccount) {
          const accounts = db.prepare('SELECT id FROM source_accounts LIMIT 2').all();
          if (accounts.length !== 1 || typeof accounts[0]?.id !== 'string') throw new Error('account_unavailable');
          accountId = accounts[0].id;
        }
      } else if (sameAccount) throw new Error('account_unavailable');
      const token = randomBytes(32).toString('hex');
      this.previewState = { token, plan, accountId, expires: Date.now() + 30 * 60_000 };
      return { token, files: plan.files.length, rows: plan.files.reduce((sum, file) => sum + file.rows, 0), resuming: plan.pendingId !== null, accountLinked: accountId !== null };
    } finally { db?.close(); }
  }

  commit(token: string) {
    const state = this.previewState;
    this.previewState = undefined;
    if (!state || state.token !== token || state.expires < Date.now()) throw new Error('preview_expired');
    const directory = dirname(this.dbPath);
    mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('invalid_store');
    try { if (lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const db = new DatabaseSync(this.dbPath);
    try {
      initializeTakeoutStore(db);
      return importTakeout(db, state.plan.root, undefined, state.plan, state.accountId);
    } finally { db.close(); }
  }

  saveNote(input: UserNoteInput) {
    if (!existsSync(this.dbPath) || lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store');
    const db = new DatabaseSync(this.dbPath);
    try {
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || (version !== 3 && (version !== 4 && version !== 5))) throw new Error('invalid_store');
      return saveUserNote(db, input);
    } finally { db.close(); }
  }

  previewAccountAssignment() {
    if (!existsSync(this.dbPath) || lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store');
    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      if (![4, 5].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) throw new Error('account_unavailable');
      const accounts = db.prepare('SELECT id FROM source_accounts LIMIT 2').all();
      if (accounts.length !== 1 || typeof accounts[0]?.id !== 'string') throw new Error('account_unavailable');
      const sessions = unassignedSessions(db);
      if (!sessions.length) { this.accountState = undefined; return { count: 0, token: null }; }
      const token = randomBytes(32).toString('hex');
      this.accountState = { token, accountId: accounts[0].id, sessions, expires: Date.now() + 30 * 60_000 };
      return { count: sessions.length, token };
    } finally { db.close(); }
  }

  commitAccountAssignment(token: string) {
    const state = this.accountState;
    this.accountState = undefined;
    if (!state || state.token !== token || state.expires < Date.now()) throw new Error('preview_expired');
    if (!existsSync(this.dbPath) || lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store');
    const db = new DatabaseSync(this.dbPath);
    try {
      if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || ![4, 5].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) throw new Error('invalid_store');
      db.exec('PRAGMA foreign_keys = ON');
      assignSessions(db, state.accountId, state.sessions);
      return { assigned: state.sessions.length };
    } finally { db.close(); }
  }
}
