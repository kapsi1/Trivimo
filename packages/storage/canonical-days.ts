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

/** Store provider pages and their resume cursor atomically, without assigning an account implicitly. */
export async function migrateGooglePages(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 4, `CREATE TABLE google_read_jobs (
      id TEXT PRIMARY KEY, account_digest TEXT NOT NULL CHECK(length(account_digest) = 64), kind TEXT NOT NULL CHECK(kind IN ('weight','body-fat')),
      range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL CHECK(state IN ('running','complete')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE google_read_pages (
      job_id TEXT NOT NULL REFERENCES google_read_jobs(id), page_number INTEGER NOT NULL CHECK(page_number > 0),
      request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL,
      PRIMARY KEY(job_id, page_number)
    ) STRICT; PRAGMA user_version = 5;`);
}

/** The job tables are rebuilt because SQLite cannot alter a CHECK; rows, pages and the foreign key are preserved. */
async function rebuildGoogleJobs(db: DatabaseSync, backupPath: string, from: number, kinds: string[]): Promise<void> {
  const to = from + 1;
  await migrateWithBackup(db, backupPath, from, `CREATE TABLE google_read_jobs_v6 (
      id TEXT PRIMARY KEY, account_digest TEXT NOT NULL CHECK(length(account_digest) = 64), kind TEXT NOT NULL CHECK(kind IN (${kinds.map((kind) => `'${kind}'`).join(',')})),
      range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL CHECK(state IN ('running','complete')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE google_read_pages_v6 (
      job_id TEXT NOT NULL REFERENCES google_read_jobs_v6(id), page_number INTEGER NOT NULL CHECK(page_number > 0),
      request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL,
      PRIMARY KEY(job_id, page_number)
    ) STRICT;
    INSERT INTO google_read_jobs_v6 SELECT id, account_digest, kind, range_start, range_end, cursor, state, created_at FROM google_read_jobs;
    INSERT INTO google_read_pages_v6 SELECT job_id, page_number, request_cursor, next_cursor, raw_json, digest, received_at FROM google_read_pages;
    DROP TABLE google_read_pages; DROP TABLE google_read_jobs;
    ALTER TABLE google_read_jobs_v6 RENAME TO google_read_jobs;
    ALTER TABLE google_read_pages_v6 RENAME TO google_read_pages;
    PRAGMA user_version = ${to};`, () => {
    const before = db.prepare('SELECT (SELECT COUNT(*) FROM google_read_jobs) AS jobs, (SELECT COUNT(*) FROM google_read_pages) AS pages').get();
    if (!before || db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Niespójna migracja zadań Google');
  });
}

/** Version 6: civil-day aggregate jobs for steps and distance. */
export async function migrateDailyRollups(db: DatabaseSync, backupPath: string): Promise<void> {
  await rebuildGoogleJobs(db, backupPath, 5, ['weight', 'body-fat', 'steps', 'distance']);
}

/** Version 7: civil-day aggregate jobs for total and active calories. */
export async function migrateCalorieJobs(db: DatabaseSync, backupPath: string): Promise<void> {
  await rebuildGoogleJobs(db, backupPath, 6, ['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned']);
}

/** Version 8: ten-minute window jobs (heart rate as wear evidence, active energy for its split by wear). */
export async function migrateWindowJobs(db: DatabaseSync, backupPath: string): Promise<void> {
  await rebuildGoogleJobs(db, backupPath, 7, ['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m']);
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

