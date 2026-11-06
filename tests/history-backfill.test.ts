import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateCsvNotes, migratePageWindows, migrateDayZone, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { GoogleAuth } from '../apps/server/google-auth.ts';
import { backfillRetryDelaysMs, GoogleSyncService, planBackfill, syncKinds } from '../apps/server/google-sync.ts';

const scopes = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
const civil = (date: string) => { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day } }; };
const next = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

test('historia sprzed 2026: uzupełnianie od wybranej daty, kalendarz roku i snapshoty starszych dób', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-history-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
    await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite'));
    await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite')); await migrateDayZone(db, join(dir, 'v13.sqlite'));
    const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'private', expires_in: 3600, scope: scopes }));
    await auth.finish(new URL(auth.start()).searchParams.get('state'), 'code');
    // two years back the plan covers the earlier days in producer-limited chunks, like 2026
    assert.ok(planBackfill(db, '2024-12-25', '2025-01-10').some((read) => read.kind === 'steps' && read.first === '2024-12-25'));
    const clock = Date.parse('2026-01-05T10:00:00Z');
    // synthetic producer: steps on 2025-12-30 only; every other read is empty (absence, not 0)
    const service = new GoogleSyncService(path, auth, { intervalMinutes: null, now: () => clock, sleep: async () => undefined, execute: async (store, read) => {
      const id = createGoogleReadJob(store, createHash('sha256').update('synthetic-account').digest('hex'), read.kind, read.begin, read.end);
      const steps = read.kind === 'steps' && read.first <= '2025-12-30' && read.last >= '2025-12-30';
      commitGooglePage(store, id, null, steps ? JSON.stringify({ rollupDataPoints: [{ civilStartTime: civil('2025-12-30'), civilEndTime: civil(next('2025-12-30')), steps: { countSum: '4321' } }] }) : '{}');
      store.prepare('UPDATE google_read_jobs SET created_at = ? WHERE id = ?').run(new Date(clock).toISOString(), id);
    } });
    assert.throws(() => service.startBackfill('1999-12-31'), /invalid_range/);
    assert.throws(() => service.startBackfill('2026-01-05'), /invalid_range/);
    service.startBackfill('2025-12-28'); await service.backfillDone;
    const status = service.backfillStatus();
    assert.deepEqual([status.state, status.from, status.through], ['done', '2025-12-28', '2026-01-04']);
    assert.deepEqual(status.kinds.map((item) => [item.covered, item.total]), syncKinds.map(() => [8, 8]));
    const year = service.coverage(2025)!;
    assert.deepEqual([year.from, year.through, year.days.length, year.days.filter((day) => day.covered === syncKinds.length).map((day) => day.date)], ['2025-01-01', '2025-12-31', 365, ['2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31']]);
    assert.equal(service.coverage(1999), null);
    // the earlier day is qualified by the same rules: the value without a read of its windows is not comparable by day boundary
    const day = readCanonicalDay(db, '2025-12-30');
    assert.equal(day?.metrics.steps.status, 'incomparable');
    assert.equal(readCanonicalDay(db, '2025-12-29')?.metrics.steps.status, 'missing');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('uzupełnianie ponawia paczkę po przejściowym błędzie (5xx, przekroczony czas), a trwały błąd kończy je po ostatniej próbie', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-retry-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
    await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite'));
    await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite')); await migrateDayZone(db, join(dir, 'v13.sqlite'));
    const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'private', expires_in: 3600, scope: scopes }));
    await auth.finish(new URL(auth.start()).searchParams.get('state'), 'code');
    let clock = Date.parse('2026-01-05T10:00:00Z'); const slept: number[] = [];
    let failing = 2, failure = 'google_http_500';
    const service = new GoogleSyncService(path, auth, { intervalMinutes: null, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; }, execute: async (store, read) => {
      if (failing-- > 0) throw new Error(failure);
      const id = createGoogleReadJob(store, createHash('sha256').update('synthetic-account').digest('hex'), read.kind, read.begin, read.end);
      commitGooglePage(store, id, null, '{}');
    } });
    // two server errors: the chunk is repeated after 15 s and 30 s, then the run finishes
    service.startBackfill('2026-01-01'); await service.backfillDone;
    assert.deepEqual([service.backfillStatus().state, service.backfillStatus().retrying, slept.reduce((a, b) => a + b, 0)], ['done', undefined, 45000]);
    // a network error or timeout ends as google_read_failed; persisting, it stops after the last repeat with its code
    db.prepare('DELETE FROM google_read_pages').run(); db.prepare('DELETE FROM google_read_jobs').run();
    failing = Infinity; failure = 'fetch failed'; slept.length = 0;
    service.startBackfill('2026-01-01'); await service.backfillDone;
    assert.deepEqual([service.backfillStatus().state, service.backfillStatus().code], ['error', 'google_read_failed']);
    assert.equal(slept.reduce((a, b) => a + b, 0), backfillRetryDelaysMs.reduce((a, b) => a + b, 0));
    // an authorization error is not repeated
    failing = Infinity; failure = 'authorization_required'; slept.length = 0;
    service.startBackfill('2026-01-01'); await service.backfillDone;
    assert.deepEqual([service.backfillStatus().state, slept.length], ['error', 0]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('tożsamość konta jest pytana raz na token dostępu, nie przy każdym zadaniu i stronie', async () => {
  const { clearIdentityCache, readGoogleJobPage, startGoogleReadJob } = await import('../apps/server/google-read-service.ts');
  clearIdentityCache();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE google_read_pages (job_id TEXT NOT NULL, page_number INTEGER NOT NULL, request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(job_id, page_number)) STRICT;`);
    const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'token-a', expires_in: 3600, scope: scopes }));
    await auth.finish(new URL(auth.start()).searchParams.get('state'), 'code');
    let identity = 0;
    const send: typeof fetch = async (address) => String(address).endsWith('/identity') ? (identity++, Response.json({ healthUserId: 'synthetic-account' })) : Response.json({});
    for (const date of ['2025-01-01', '2025-01-02', '2025-01-03']) {
      const id = await startGoogleReadJob(db, auth, 'steps', date, next(date), send);
      await readGoogleJobPage(db, auth, id, send);
    }
    assert.equal(identity, 1);
  } finally { db.close(); clearIdentityCache(); }
});
