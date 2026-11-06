import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import {
  currentStoreVersion, migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateCsvNotes, migrateDailyRollups, migrateDailySummaries, migrateDayZone, migrateGooglePages,
  migratePageWindows, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs,
} from '../packages/storage/canonical-days.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';

const account = createHash('sha256').update('synthetic-account').digest('hex');

test('migracja 15 zachowuje zadania, strony i metadane, przyjmuje dobowe podsumowania i odrzuca nieznany rodzaj', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-v15-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path); const step = (n: number) => join(dir, `v${n}.sqlite`);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, step(1)); await migrateUserNotes(db, step(2)); await migrateSourceAccounts(db, step(3), true); await migrateGooglePages(db, step(4));
    await migrateDailyRollups(db, step(5)); await migrateCalorieJobs(db, step(6)); await migrateWindowJobs(db, step(7)); await migrateReadPolicy(db, step(8)); await migrateSourceLists(db, step(9));
    await migrateCsvImports(db, step(10)); await migrateCsvNotes(db, step(11)); await migratePageWindows(db, step(12)); await migrateDayZone(db, step(13));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 14);
    // v14 refuses a daily summary kind (CHECK on kind)
    assert.throws(() => db.prepare("INSERT INTO google_read_jobs VALUES ('x', ?, 'daily-vo2-max', '2026-03-01', '2026-03-02', NULL, 'running', '2026-03-02T00:00:00.000Z')").run(account));
    const id = createGoogleReadJob(db, account, 'steps', '2026-03-01', '2026-03-02');
    commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 3, day: 1 } }, civilEndTime: { date: { year: 2026, month: 3, day: 2 } }, steps: { countSum: '0' } }] }));
    const counts = () => db.prepare('SELECT (SELECT COUNT(*) FROM google_read_jobs) AS jobs, (SELECT COUNT(*) FROM google_read_pages) AS pages, (SELECT COUNT(*) FROM google_read_job_meta) AS meta').get();
    const before = JSON.stringify(counts()), page = db.prepare('SELECT digest, raw_json FROM google_read_pages').get();
    await migrateDailySummaries(db, step(14));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, currentStoreVersion);
    assert.equal(JSON.stringify(counts()), before);
    assert.deepEqual(db.prepare('SELECT digest, raw_json FROM google_read_pages').get(), page);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'google_read_pages_digest'").get());
    const daily = createGoogleReadJob(db, account, 'daily-vo2-max', '2026-03-01', '2026-03-08');
    assert.deepEqual(commitGooglePage(db, daily, null, JSON.stringify({ dataPoints: [{ dailyVo2Max: { date: { year: 2026, month: 3, day: 1 }, vo2Max: 44 } }] })), { complete: true, pageNumber: 1 });
    assert.throws(() => db.prepare("INSERT INTO google_read_jobs VALUES ('y', ?, 'daily-unknown', '2026-03-01', '2026-03-02', NULL, 'running', '2026-03-02T00:00:00.000Z')").run(account));
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    verifyTakeout(path);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
