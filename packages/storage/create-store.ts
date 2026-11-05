import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeTakeoutStore } from '../adapters/takeout/import.ts';
import {
  currentStoreVersion, migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateCsvNotes, migrateDailyRollups, migrateGooglePages,
  migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs,
} from './canonical-days.ts';
import { verifyTakeout } from './verify-takeout.ts';

/**
 * An empty store at the current version, built by the same migrations as an existing store (so the schema cannot
 * drift), in a private temporary directory, verified, and only then copied to `path` without replacing anything.
 * The step 3→4 account confirmation is safe here: the store has no imports to assign. Returns false when `path`
 * already exists (nothing is touched).
 */
export async function createEmptyStore(path: string): Promise<boolean> {
  if (existsSync(path)) return false;
  const work = mkdtempSync(join(tmpdir(), 'trivimo-new-store-'));
  try {
    const file = join(work, 'store.sqlite'), step = (version: number) => join(work, `v${version}.sqlite`);
    const db = new DatabaseSync(file);
    try {
      initializeTakeoutStore(db);
      await migrateCanonicalDays(db, step(1)); await migrateUserNotes(db, step(2)); await migrateSourceAccounts(db, step(3), true);
      await migrateGooglePages(db, step(4)); await migrateDailyRollups(db, step(5)); await migrateCalorieJobs(db, step(6));
      await migrateWindowJobs(db, step(7)); await migrateReadPolicy(db, step(8)); await migrateSourceLists(db, step(9));
      await migrateCsvImports(db, step(10)); await migrateCsvNotes(db, step(11));
      if (db.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) throw new Error('store_version_mismatch');
    } finally { db.close(); }
    verifyTakeout(file);
    mkdirSync(dirname(path), { recursive: true });
    try { copyFileSync(file, path, constants.COPYFILE_EXCL); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    return true;
  } finally { rmSync(work, { recursive: true, force: true }); }
}
