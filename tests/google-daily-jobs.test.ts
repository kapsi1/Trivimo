import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, migrateUserNotes, migrateSourceAccounts, migrateGooglePages, migrateDailyRollups } from '../packages/storage/canonical-days.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';

test('migracja v6 zachowuje zadania i strony, naprawia klucz obcy i dopuszcza zadania dobowe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-v6-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
    const old = createGoogleReadJob(db, 'a'.repeat(64), 'weight', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    commitGooglePage(db, old, null, '{"dataPoints":[{"v":1}],"nextPageToken":"n"}');
    assert.throws(() => createGoogleReadJob(db, 'a'.repeat(64), 'steps', '2026-01-01', '2026-01-02'));
    await assert.rejects(migrateDailyRollups(db, join(dir, 'v4-wrong.sqlite')).then(() => migrateDailyRollups(db, join(dir, 'again.sqlite'))));
  } finally { db.close(); }
  const reopened = new DatabaseSync(path);
  try {
    assert.equal(reopened.prepare('PRAGMA user_version').get()?.user_version, 6);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM google_read_jobs').get()?.n, 1);
    assert.equal(reopened.prepare('SELECT raw_json FROM google_read_pages').get()?.raw_json, '{"dataPoints":[{"v":1}],"nextPageToken":"n"}');
    assert.equal(reopened.prepare("SELECT \"table\" AS t FROM pragma_foreign_key_list('google_read_pages')").get()?.t, 'google_read_jobs');
    assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length, 0);
    const steps = createGoogleReadJob(reopened, 'b'.repeat(64), 'steps', '2026-03-01', '2026-03-02');
    assert.throws(() => createGoogleReadJob(reopened, 'b'.repeat(64), 'steps', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'), /invalid_range/);
    assert.throws(() => createGoogleReadJob(reopened, 'b'.repeat(64), 'distance', '2026-03-01', '2026-06-30'), /invalid_range/);
    const day = (d: number, extra: object) => ({ civilStartTime: { date: { year: 2026, month: 3, day: d } }, civilEndTime: { date: { year: 2026, month: 3, day: d + 1 } }, ...extra });
    assert.throws(() => commitGooglePage(reopened, steps, null, JSON.stringify({ rollupDataPoints: [{ ...day(1, { steps: { countSum: '1' } }), civilEndTime: { date: { year: 2026, month: 3, day: 5 } } }] })), /unexpected_window/);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM google_read_pages WHERE job_id = ?').get(steps)?.n, 0);
    const raw = JSON.stringify({ rollupDataPoints: [day(1, { steps: { countSum: '0' } })] });
    assert.deepEqual(commitGooglePage(reopened, steps, null, raw), { complete: true, pageNumber: 1 });
    assert.equal(reopened.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ?').get(steps)?.raw_json, raw);
  } finally { reopened.close(); }
  verifyTakeout(path);
  rmSync(dir, { recursive: true, force: true });
});
