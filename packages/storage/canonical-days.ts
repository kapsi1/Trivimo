import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { daySnapshotSchema, snapshotInputSchema, type DaySnapshotInput } from '../contracts/day-snapshot.ts';
import { projectIssueNotes } from '../domain/data-issues.ts';
import { csvMappingSchema } from '../contracts/csv-import.ts';
import { parseMappedCsv } from '../adapters/csv/mapped-csv.ts';
import { sourceDay } from '../domain/source-day.ts';
import { dayZoneRule, defaultDayZone } from '../domain/day-zone.ts';
import { backupToNewFile } from './backup.ts';
import { verifyTakeout } from './verify-takeout.ts';
import { fillPageWindows } from './google-page-windows.ts';

const applicationId = 1414682185;

/** A backup and a single-writer process are required before upgrading an existing store. */
async function migrateWithBackup(db: DatabaseSync, backupPath: string, version: number, sql: string, afterSql?: () => void, beforeSql?: () => void): Promise<void> {
  if (db.prepare('PRAGMA application_id').get()?.application_id !== applicationId || db.prepare('PRAGMA user_version').get()?.user_version !== version) throw new Error('Nieobsługiwana wersja bazy');
  const dataVersion = db.prepare('PRAGMA data_version').get()?.data_version;
  const changes = db.prepare('SELECT total_changes() AS count').get()?.count;
  await backupToNewFile(db, backupPath);
  verifyTakeout(backupPath);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('PRAGMA user_version').get()?.user_version !== version || db.prepare('PRAGMA data_version').get()?.data_version !== dataVersion || db.prepare('SELECT total_changes() AS count').get()?.count !== changes) throw new Error('Baza zmieniła się podczas tworzenia kopii');
    beforeSql?.();
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
async function rebuildGoogleJobs(db: DatabaseSync, backupPath: string, from: number, kinds: string[], extraSql = ''): Promise<void> {
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
    ${extraSql}
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

/**
 * Version 9: detailed ten-minute series for steps, distance and total calories, plus read bookkeeping:
 * job origin and content digest with unchanged-confirmations, and an audit of superseded reads.
 */
export async function migrateReadPolicy(db: DatabaseSync, backupPath: string): Promise<void> {
  await rebuildGoogleJobs(db, backupPath, 8, ['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m', 'total-calories-10m', 'steps-10m', 'distance-10m'], `
    CREATE TABLE google_read_job_meta (
      job_id TEXT PRIMARY KEY REFERENCES google_read_jobs(id), origin TEXT NOT NULL CHECK(origin IN ('manual','automatic')),
      content_digest TEXT, confirmed_at TEXT, confirmations INTEGER NOT NULL DEFAULT 0 CHECK(confirmations >= 0)
    ) STRICT;
    CREATE TABLE google_read_supersessions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, account_digest TEXT NOT NULL,
      replaced_digest TEXT, replaced_created_at TEXT NOT NULL, replaced_by_job TEXT NOT NULL, pages_removed INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('unchanged_duplicate','intermediate_current_day','superseded_after_correction_window')), removed_at TEXT NOT NULL
    ) STRICT;`);
}

/**
 * Version 10: per-record source lists of steps and active energy (only data source and civil date of each record),
 * read to show which devices and apps supplied a day. Job metadata references the jobs, so it is rebuilt with them.
 */
export async function migrateSourceLists(db: DatabaseSync, backupPath: string): Promise<void> {
  const kinds = ['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m', 'total-calories-10m', 'steps-10m', 'distance-10m', 'steps-sources', 'active-energy-sources'];
  const count = () => db.prepare('SELECT (SELECT COUNT(*) FROM google_read_jobs) AS jobs, (SELECT COUNT(*) FROM google_read_pages) AS pages, (SELECT COUNT(*) FROM google_read_job_meta) AS meta').get();
  let before: ReturnType<typeof count>;
  await migrateWithBackup(db, backupPath, 9, `CREATE TABLE google_read_jobs_v10 (
      id TEXT PRIMARY KEY, account_digest TEXT NOT NULL CHECK(length(account_digest) = 64), kind TEXT NOT NULL CHECK(kind IN (${kinds.map((kind) => `'${kind}'`).join(',')})),
      range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL CHECK(state IN ('running','complete')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE google_read_pages_v10 (
      job_id TEXT NOT NULL REFERENCES google_read_jobs_v10(id), page_number INTEGER NOT NULL CHECK(page_number > 0),
      request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL,
      PRIMARY KEY(job_id, page_number)
    ) STRICT;
    CREATE TABLE google_read_job_meta_v10 (
      job_id TEXT PRIMARY KEY REFERENCES google_read_jobs_v10(id), origin TEXT NOT NULL CHECK(origin IN ('manual','automatic')),
      content_digest TEXT, confirmed_at TEXT, confirmations INTEGER NOT NULL DEFAULT 0 CHECK(confirmations >= 0)
    ) STRICT;
    INSERT INTO google_read_jobs_v10 SELECT id, account_digest, kind, range_start, range_end, cursor, state, created_at FROM google_read_jobs;
    INSERT INTO google_read_pages_v10 SELECT job_id, page_number, request_cursor, next_cursor, raw_json, digest, received_at FROM google_read_pages;
    INSERT INTO google_read_job_meta_v10 SELECT job_id, origin, content_digest, confirmed_at, confirmations FROM google_read_job_meta;
    DROP TABLE google_read_job_meta; DROP TABLE google_read_pages; DROP TABLE google_read_jobs;
    ALTER TABLE google_read_jobs_v10 RENAME TO google_read_jobs;
    ALTER TABLE google_read_pages_v10 RENAME TO google_read_pages;
    ALTER TABLE google_read_job_meta_v10 RENAME TO google_read_job_meta;
    PRAGMA user_version = 10;`, () => {
    const after = count();
    if (!after || JSON.stringify(after) !== JSON.stringify(before) || db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Niespójna migracja zadań Google');
  }, () => { before = count(); });
}

/**
 * Version 11: CSV files imported with a user-chosen column mapping. The file text, its digest, the mapping and the
 * parser version are kept with every converted value; including or excluding an import is a versioned decision.
 */
export async function migrateCsvImports(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 10, `CREATE TABLE csv_imports (
      id TEXT PRIMARY KEY, file_name TEXT NOT NULL, content_digest TEXT NOT NULL CHECK(length(content_digest) = 64), content TEXT NOT NULL,
      mapping TEXT NOT NULL, mapping_digest TEXT NOT NULL CHECK(length(mapping_digest) = 64), parser TEXT NOT NULL,
      data_rows INTEGER NOT NULL CHECK(data_rows >= 0), rejected INTEGER NOT NULL CHECK(rejected >= 0), created_at TEXT NOT NULL,
      UNIQUE(content_digest, mapping_digest, parser)
    ) STRICT;
    CREATE TABLE csv_import_values (
      import_id TEXT NOT NULL REFERENCES csv_imports(id), row_number INTEGER NOT NULL CHECK(row_number > 0),
      metric TEXT NOT NULL CHECK(metric IN ('weight','body_fat','steps','distance','total_energy','active_energy')),
      day TEXT NOT NULL, time TEXT, source_text TEXT NOT NULL, source_unit TEXT NOT NULL, numerator TEXT NOT NULL, denominator TEXT NOT NULL,
      PRIMARY KEY(import_id, row_number, metric)
    ) STRICT;
    CREATE INDEX csv_import_values_day ON csv_import_values(day);
    CREATE TABLE csv_import_decisions (
      import_id TEXT NOT NULL REFERENCES csv_imports(id), revision INTEGER NOT NULL CHECK(revision > 0),
      state TEXT NOT NULL CHECK(state IN ('included','excluded')), created_at TEXT NOT NULL, PRIMARY KEY(import_id, revision)
    ) STRICT;
    PRAGMA user_version = 11;`);
}

/**
 * Version 12: origin of the day notes written by CSV imports, so withdrawing an import also takes back its remarks.
 * `csv_import_notes` keeps the remarks of each day of an import (distinct texts joined by new lines);
 * `user_note_sources` marks a note revision written by an import: `apply` added `text` to the note, `withdraw`
 * removed it. A revision without a row was written in the application. Imports saved before this version are
 * matched by their saved file and mapping, and by note revisions created at the same moment as the import.
 */
export async function migrateCsvNotes(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 11, `CREATE TABLE csv_import_notes (
      import_id TEXT NOT NULL REFERENCES csv_imports(id), day TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(import_id, day)
    ) STRICT;
    CREATE TABLE user_note_sources (
      day TEXT NOT NULL, revision INTEGER NOT NULL, import_id TEXT NOT NULL REFERENCES csv_imports(id),
      action TEXT NOT NULL CHECK(action IN ('apply','withdraw')), text TEXT NOT NULL, PRIMARY KEY(day, revision),
      FOREIGN KEY(day, revision) REFERENCES user_note_versions(day, revision)
    ) STRICT;
    CREATE INDEX user_note_sources_import ON user_note_sources(import_id, day);
    PRAGMA user_version = 12;`, () => {
    const note = db.prepare('INSERT INTO csv_import_notes VALUES (?, ?, ?)');
    const source = db.prepare("INSERT INTO user_note_sources VALUES (?, ?, ?, 'apply', ?)");
    const revisions = db.prepare('SELECT revision, content FROM user_note_versions WHERE day = ? AND created_at = ? ORDER BY revision');
    const previous = db.prepare('SELECT content FROM user_note_versions WHERE day = ? AND revision = ?');
    for (const row of db.prepare("SELECT id, content, mapping, created_at FROM csv_imports WHERE json_extract(mapping, '$.note') IS NOT NULL ORDER BY created_at, id").all()) {
      const parsed = parseMappedCsv(String(row.content), csvMappingSchema.parse(JSON.parse(String(row.mapping))), sourceDay(String(row.created_at), defaultDayZone), defaultDayZone);
      for (const [day, texts] of remarksByDay(parsed.notes)) {
        note.run(row.id, day, texts.join('\n'));
        for (const revision of revisions.all(day, row.created_at)) {
          const before = revision.revision === 1 ? null : previous.get(day, Number(revision.revision) - 1)?.content;
          const content = String(revision.content), prior = typeof before === 'string' && before.trim() !== '' ? before : null;
          const added = prior === null ? content : content.startsWith(`${prior}\n`) ? content.slice(prior.length + 1) : null;
          if (added) source.run(day, revision.revision, row.id, added);
        }
      }
    }
  });
}

/** Remarks of a parsed file per day: distinct texts in row order. */
export function remarksByDay(notes: { day: string; text: string }[]): Map<string, string[]> {
  const days = new Map<string, string[]>();
  for (const item of notes) { const list = days.get(item.day) ?? []; if (!list.includes(item.text)) list.push(item.text); days.set(item.day, list); }
  return days;
}

/**
 * Version 13: derived ten-minute windows of saved pages (`google_page_windows`, see google-page-windows.ts), filled for
 * every existing window page, and an index of pages by digest (derived rows are looked up and cleaned up by it).
 * Originals are unchanged; the rows are a versioned cache checked by the restore check.
 */
export async function migratePageWindows(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 12, `CREATE TABLE google_page_windows (
      digest TEXT NOT NULL CHECK(length(digest) = 64), parser TEXT NOT NULL, windows TEXT NOT NULL, PRIMARY KEY(digest, parser)
    ) STRICT;
    CREATE INDEX google_read_pages_digest ON google_read_pages(digest);
    PRAGMA user_version = 13;`, () => fillPageWindows(db));
}

/**
 * Version 14: the day zone setting (rule `day-zone-v1`). Every day so far was cut in Europe/Warsaw, so revision 1 records
 * that; the snapshots published before this version carry no zone and are read as Warsaw days. A later change of the
 * zone adds a revision and is applied by an explicit recomputation of the days (originals and snapshot history kept).
 */
export async function migrateDayZone(db: DatabaseSync, backupPath: string): Promise<void> {
  await migrateWithBackup(db, backupPath, 13, `CREATE TABLE day_zone_versions (
      revision INTEGER PRIMARY KEY CHECK (revision > 0), zone TEXT NOT NULL, rule TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('initial','user')), created_at TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version = 14;`, () => {
    db.prepare("INSERT INTO day_zone_versions VALUES (1, ?, ?, 'initial', ?)").run(defaultDayZone, dayZoneRule, new Date().toISOString());
  });
}

/** Store version the server, services and CLI expect. */
export const currentStoreVersion = 14;
/** Whether a store version has the given feature version (and is not newer than this code understands). */
export const storeHas = (version: unknown, since: number): boolean => typeof version === 'number' && version >= since && version <= currentStoreVersion;

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


const earliestKeys = ['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy'] as const;
/**
 * Earliest day with a stored value (any status, including a confirmed zero; never a missing one) per metric, from the
 * newest revision of each day. One pass over the snapshots in SQL; null when the metric has no value at all.
 */
export function readEarliestMetricDays(db: DatabaseSync): Record<(typeof earliestKeys)[number], string | null> {
  const columns = earliestKeys.map((key) => `MIN(CASE WHEN json_extract(payload, '$.metrics.${key}.value') IS NOT NULL THEN day END) AS ${key}`).join(', ');
  const row = db.prepare(`SELECT ${columns} FROM daily_snapshots s WHERE revision = (SELECT MAX(revision) FROM daily_snapshots t WHERE t.day = s.day)`).get() ?? {};
  return Object.fromEntries(earliestKeys.map((key) => [key, typeof row[key] === 'string' ? row[key] : null])) as Record<(typeof earliestKeys)[number], string | null>;
}
