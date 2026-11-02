import type { DatabaseSync } from 'node:sqlite';

const currentVersion = 1;

/** Apply the initial schema; later upgrades need a backup policy before they are added. */
export function migrateDatabase(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get();
  const version = row?.user_version;
  if (typeof version !== 'number' || version < 0 || version > currentVersion) {
    throw new Error('Nieobsługiwana wersja schematu bazy');
  }
  if (version === currentVersion) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE days (
      date TEXT PRIMARY KEY, value REAL, status TEXT NOT NULL,
      note TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
      CHECK ((status = 'valid' AND value IS NOT NULL) OR (status = 'missing' AND value IS NULL))
    ) STRICT`);
    db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
