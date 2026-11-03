import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { daySnapshotSchema, snapshotInputSchema, type DaySnapshotInput } from '../contracts/day-snapshot.ts';
import { projectIssueNotes } from '../domain/data-issues.ts';
import { backupToNewFile } from './backup.ts';
import { verifyTakeout } from './verify-takeout.ts';

const applicationId = 1414682185;

/** A backup and a single-writer process are required before upgrading an existing store. */
async function migrateWithBackup(db: DatabaseSync, backupPath: string, version: number, sql: string, afterSql?: () => void): Promise<void> {
  if (db.prepare('PRAGMA application_id').get()?.application_id !== applicationId || db.prepare('PRAGMA user_version').get()?.user_version !== version) throw new Error('Nieobsługiwana wersja bazy');
  const dataVersion = db.prepare('PRAGMA data_version').get()?.data_version;
  const changes = db.prepare('SELECT total_changes() AS count').get()?.count;
  await backupToNewFile(db, backupPath);
  verifyTakeout(backupPath);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('PRAGMA user_version').get()?.user_version !== version || db.prepare('PRAGMA data_version').get()?.data_version !== dataVersion || db.prepare('SELECT total_changes() AS count').get()?.count !== changes) throw new Error('Baza zmieniła się podczas tworzenia kopii');
    db.exec(sql);
    afterSql?.();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function migrateCanonicalDays(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 1, `CREATE TABLE daily_snapshots (
      day TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), payload TEXT NOT NULL,
      PRIMARY KEY(day, revision)
    ) STRICT; PRAGMA user_version = 2;`);
}

export async function migrateUserNotes(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 2, `CREATE TABLE user_note_versions (
      day TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), content TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(day, revision)
    ) STRICT; PRAGMA user_version = 3;`);
}

/** Association of existing imports is an explicit user decision, not an inferred account. */
export async function migrateSourceAccounts(db: DatabaseSync, backupPath: string, confirmedSingleAccount: boolean): Promise<void> {
  if (!confirmedSingleAccount) throw new Error('Brak potwierdzenia konta');
  const accountId = randomUUID();
  const created = new Date().toISOString();
  await migrateWithBackup(db, backupPath, 3, `CREATE TABLE source_accounts (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider = 'google_health'), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE import_account_decisions (
      session_id TEXT NOT NULL REFERENCES import_sessions(id), revision INTEGER NOT NULL CHECK(revision > 0),
      account_id TEXT NOT NULL REFERENCES source_accounts(id), reason TEXT NOT NULL CHECK(reason = 'user_confirmed'), created_at TEXT NOT NULL,
      PRIMARY KEY(session_id, revision)
    ) STRICT; PRAGMA user_version = 4;`, () => {
    db.prepare("INSERT INTO source_accounts VALUES (?, 'google_health', ?)").run(accountId, created);
    db.prepare("INSERT INTO import_account_decisions SELECT id, 1, ?, 'user_confirmed', ? FROM import_sessions").run(accountId, created);
  });
}

export function publishCanonicalDay(db: DatabaseSync, input: DaySnapshotInput, expectedRevision: number | null) {
  const parsed = snapshotInputSchema.parse(input);
  const notes = projectIssueNotes(parsed.issues);
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT MAX(revision) AS revision FROM daily_snapshots WHERE day = ?').get(parsed.date)?.revision ?? null;
    if (current !== expectedRevision) throw new Error('Konflikt rewizji dnia');
    const revision = expectedRevision === null ? 1 : expectedRevision + 1;
    const snapshot = { ...parsed, revision, notes };
    db.prepare('INSERT INTO daily_snapshots VALUES (?, ?, ?)').run(parsed.date, revision, JSON.stringify(snapshot));
    db.exec('COMMIT');
    return snapshot;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function readCanonicalDay(db: DatabaseSync, date: string) {
  const row = db.prepare('SELECT payload FROM daily_snapshots WHERE day = ? ORDER BY revision DESC LIMIT 1').get(date);
  if (!row) return null;
  if (typeof row.payload !== 'string') throw new Error('Nieprawidłowy snapshot');
  const raw: unknown = JSON.parse(row.payload);
  const result = daySnapshotSchema.parse(raw);
  if (JSON.stringify(result.notes) !== JSON.stringify(projectIssueNotes(result.issues))) throw new Error('Niespójne uwagi snapshotu');
  return result;
}

