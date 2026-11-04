import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, realpathSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { extractZip, isGoogleHealthEntry, listZip } from '../../packages/adapters/takeout/zip.ts';
import { DatabaseSync } from 'node:sqlite';
import { importTakeout, initializeTakeoutStore, previewTakeout, type TakeoutPlan } from '../../packages/adapters/takeout/import.ts';
import { saveUserNote } from '../../packages/storage/user-notes.ts';
import type { UserNoteInput } from '../../packages/contracts/day-snapshot.ts';
import { assignSessions, unassignedSessions } from '../../packages/storage/source-accounts.ts';

export class TakeoutService {
  private previewState?: { token: string; plan: TakeoutPlan; accountId: string | null; expires: number; extracted?: string };
  private uploads = new Map<string, { path: string; digest: string }>();
  /** Working files next to the store (same disk and permissions): uploaded archives and the extracted Google Health folder. */
  private get workDir() { return join(dirname(this.dbPath), 'takeout-work'); }
  private accountState?: { token: string; accountId: string; sessions: string[]; expires: number };
  constructor(private readonly dbPath: string) {}

  preview(directory: string, sameAccount = false) {
    if (!isAbsolute(directory) || directory.length > 4096) throw new Error('invalid_directory');
    let db: DatabaseSync | undefined;
    try {
      if (existsSync(this.dbPath)) {
        db = new DatabaseSync(this.dbPath, { readOnly: true, timeout: 5000 });
      }
      const plan = previewTakeout(directory, db);
      let accountId: string | null = null;
      if (db && [4, 5, 6, 7, 8, 9, 10, 11].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) {
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

  /**
   * Save one uploaded Takeout archive (streamed to disk, at most 64 GiB) and check that it is a ZIP with Google Health
   * files. Uploads older than a day that were never previewed are removed first.
   */
  async saveUpload(body: Readable): Promise<{ id: string; bytes: number; entries: number }> {
    const dir = join(this.workDir, 'uploads');
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) { const file = join(dir, name); try { if (Date.now() - statSync(file).mtimeMs > 86400000) rmSync(file, { force: true }); } catch { /* removed meanwhile */ } }
    const id = randomUUID(), path = join(dir, `${id}.zip`), hash = createHash('sha256');
    let bytes = 0;
    const count = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; if (bytes > 64 * 1024 ** 3) { done(new Error('upload_too_large')); return; } hash.update(chunk); done(null, chunk); } });
    try {
      await pipeline(body, count, createWriteStream(path, { flags: 'wx' }));
      const entries = listZip(path).filter((entry) => isGoogleHealthEntry(entry.name)).length;
      if (entries === 0) throw new Error('no_google_health');
      this.uploads.set(id, { path, digest: hash.digest('hex') });
      return { id, bytes, entries };
    } catch (error) { rmSync(path, { force: true }); throw error; }
  }

  /**
   * Extract the Google Health files of the uploaded archives (parts of one export together) into a folder named by
   * their digests, so the same archives resume an interrupted import, then prepare the usual preview. The archives
   * are removed after extraction; the extracted folder is removed after a successful import.
   */
  async previewZip(ids: string[], sameAccount = false) {
    const parts = ids.map((id) => { const upload = this.uploads.get(id); if (!upload || !existsSync(upload.path)) throw new Error('upload_missing'); return upload; });
    const key = createHash('sha256').update(parts.map((part) => part.digest).sort().join(':')).digest('hex').slice(0, 32);
    const target = join(this.workDir, 'extracted', key), marker = join(this.workDir, 'extracted', `${key}.done`);
    if (!existsSync(marker)) {
      rmSync(target, { recursive: true, force: true });
      for (const [index, part] of parts.entries()) await extractZip(part.path, join(target, `part-${index + 1}`), isGoogleHealthEntry);
      writeFileSync(marker, '');
    }
    for (const [index, part] of parts.entries()) { rmSync(part.path, { force: true }); this.uploads.delete(ids[index]!); }
    try {
      const result = this.preview(target, sameAccount);
      this.previewState!.extracted = target;
      return result;
    } catch (error) { if (!this.pendingRoot(target)) this.removeExtracted(target); throw error; }
  }

  private pendingRoot(target: string): boolean {
    if (!existsSync(this.dbPath)) return false;
    const db = new DatabaseSync(this.dbPath, { readOnly: true, timeout: 5000 });
    try { const row = db.prepare("SELECT root FROM import_sessions WHERE state = 'running' LIMIT 1").get(); return typeof row?.root === 'string' && existsSync(target) && row.root === realpathSync(target); } catch { return false; } finally { db.close(); }
  }
  private removeExtracted(target: string) { rmSync(target, { recursive: true, force: true }); rmSync(`${target}.done`, { force: true }); }

  commit(token: string) {
    const state = this.previewState;
    this.previewState = undefined;
    if (!state || state.token !== token || state.expires < Date.now()) throw new Error('preview_expired');
    const result = this.commitPlan(state);
    // the originals are now in the store; the extracted copy is temporary (kept above only for resuming a failed import)
    if (state.extracted) this.removeExtracted(state.extracted);
    return result;
  }

  private commitPlan(state: NonNullable<TakeoutService['previewState']>) {
    const directory = dirname(this.dbPath);
    mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('invalid_store');
    try { if (lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    try {
      initializeTakeoutStore(db);
      return importTakeout(db, state.plan.root, undefined, state.plan, state.accountId);
    } finally { db.close(); }
  }

  saveNote(input: UserNoteInput) {
    if (!existsSync(this.dbPath) || lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store');
    const db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    try {
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || (version !== 3 && (version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9 && version !== 10 && version !== 11))) throw new Error('invalid_store');
      return saveUserNote(db, input);
    } finally { db.close(); }
  }

  previewAccountAssignment() {
    if (!existsSync(this.dbPath) || lstatSync(this.dbPath).isSymbolicLink()) throw new Error('invalid_store');
    const db = new DatabaseSync(this.dbPath, { readOnly: true, timeout: 5000 });
    try {
      if (![4, 5, 6, 7, 8, 9, 10, 11].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) throw new Error('account_unavailable');
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
    const db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    try {
      if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || ![4, 5, 6, 7, 8, 9, 10, 11].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) throw new Error('invalid_store');
      db.exec('PRAGMA foreign_keys = ON');
      assignSessions(db, state.accountId, state.sessions);
      return { assigned: state.sessions.length };
    } finally { db.close(); }
  }
}
