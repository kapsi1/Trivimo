import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importTakeout, initializeTakeoutStore, previewTakeout, type TakeoutPlan } from '../../packages/adapters/takeout/import.ts';

export class TakeoutService {
  private previewState?: { token: string; plan: TakeoutPlan; expires: number };
  constructor(private readonly dbPath: string) {}

  preview(directory: string) {
    if (!isAbsolute(directory) || directory.length > 4096) throw new Error('invalid_directory');
    let db: DatabaseSync | undefined;
    try {
      if (existsSync(this.dbPath)) {
        db = new DatabaseSync(this.dbPath, { readOnly: true });
      }
      const plan = previewTakeout(directory, db);
      const token = randomBytes(32).toString('hex');
      this.previewState = { token, plan, expires: Date.now() + 30 * 60_000 };
      return { token, files: plan.files.length, rows: plan.files.reduce((sum, file) => sum + file.rows, 0), resuming: plan.pendingId !== null };
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
      return importTakeout(db, state.plan.root, undefined, state.plan);
    } finally { db.close(); }
  }
}
