import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { GoogleAuth } from '../apps/server/google-auth.ts';
import { GoogleSyncService, planBackfill, syncKinds } from '../apps/server/google-sync.ts';

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
    await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite'));
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
