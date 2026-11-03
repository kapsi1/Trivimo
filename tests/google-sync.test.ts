import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs } from '../packages/storage/canonical-days.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { createGoogleReadJob, commitGooglePage } from '../packages/storage/google-pages.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { GoogleAuth } from '../apps/server/google-auth.ts';
import { GoogleSyncService, planSync, syncKinds } from '../apps/server/google-sync.ts';

function store() {
  const db = createDemoDatabase();
  db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);`);
  return db;
}
let counter = 0;
function done(db: ReturnType<typeof store>, kind: string, start: string, end: string, createdAt: string) {
  db.prepare("INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, NULL, 'complete', ?)").run(`j${counter++}`, 'a'.repeat(64), kind, start, end, createdAt);
}
const hour = 3600000;

test('plan odświeżania: pusta baza daje trzy ostatnie zakończone doby i dziś dla każdego rodzaju', () => {
  const db = store();
  try {
    const plan = planSync(db, '2026-03-10', Date.parse('2026-03-10T12:00:00Z'), hour);
    assert.equal(plan.length, syncKinds.length * 2);
    const steps = plan.filter((read) => read.kind === 'steps');
    assert.deepEqual(steps.map((read) => [read.first, read.last, read.begin, read.end]), [['2026-03-07', '2026-03-09', '2026-03-07', '2026-03-10'], ['2026-03-10', '2026-03-10', '2026-03-10', '2026-03-11']]);
    const heart = plan.filter((read) => read.kind === 'heart-rate-10m');
    assert.deepEqual(heart.map((read) => [read.begin, read.end]), [[warsawDay('2026-03-07').start, warsawDay('2026-03-09').end], [warsawDay('2026-03-10').start, warsawDay('2026-03-10').end]]);
  } finally { db.close(); }
});

test('plan odświeżania: odczytany zakres nie jest powtarzany, dziś wraca po upływie czasu, a przerwa jest nadrabiana', () => {
  const db = store();
  try {
    for (const kind of syncKinds) {
      const window = kind.endsWith('-10m');
      done(db, kind, window ? warsawDay('2026-03-07').start : '2026-03-07', window ? warsawDay('2026-03-09').end : '2026-03-10', '2026-03-10T10:00:00.000Z');
      done(db, kind, window ? warsawDay('2026-03-10').start : '2026-03-10', window ? warsawDay('2026-03-10').end : '2026-03-11', '2026-03-10T10:00:00.000Z');
    }
    assert.equal(planSync(db, '2026-03-10', Date.parse('2026-03-10T10:20:00Z'), hour).length, 0);
    const later = planSync(db, '2026-03-10', Date.parse('2026-03-10T11:30:00Z'), hour);
    assert.deepEqual(later.map((read) => read.first), syncKinds.map(() => '2026-03-10'));
    // five days later: the last covered day (read while still partial) is read again, and the days in between
    const gap = planSync(db, '2026-03-15', Date.parse('2026-03-15T08:00:00Z'), hour);
    const steps = gap.find((read) => read.kind === 'steps' && read.last === '2026-03-14');
    assert.deepEqual([steps?.first, steps?.last], ['2026-03-10', '2026-03-14']);
    const heart = gap.find((read) => read.kind === 'heart-rate-10m' && read.last === '2026-03-14');
    assert.equal(heart?.first, '2026-03-10');
    // a very long gap is limited to 13 days; the rest stays an uncovered gap, not a guess
    const far = planSync(db, '2026-05-01', Date.parse('2026-05-01T08:00:00Z'), hour).find((read) => read.kind === 'steps' && read.last === '2026-04-30');
    assert.deepEqual([far?.first, far?.last], ['2026-04-18', '2026-04-30']);
  } finally { db.close(); }
});

function migrated() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-sync-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  return { dir, path, db, ready: async () => {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
    await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite'));
  } };
}
const scopes = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
async function authorized() {
  const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'private', expires_in: 3600, scope: scopes }));
  await auth.finish(new URL(auth.start()).searchParams.get('state'), 'code');
  return auth;
}

test('serwis odświeżania: wznawia niedokończone zadanie, wykonuje plan i zatrzymuje się na pierwszym błędzie', async () => {
  const env = migrated();
  try {
    await env.ready();
    const digest = createHash('sha256').update('synthetic-account').digest('hex');
    const running = createGoogleReadJob(env.db, digest, 'steps', '2026-03-01', '2026-03-02');
    commitGooglePage(env.db, running, null, JSON.stringify({ rollupDataPoints: [], nextPageToken: 'n' }));
    const sent: string[] = [];
    const send: typeof fetch = async (address) => { sent.push(String(address)); return String(address).endsWith('/identity') ? Response.json({ healthUserId: 'synthetic-account' }) : Response.json({ rollupDataPoints: [] }); };
    const executed: string[] = [];
    const service = new GoogleSyncService(env.path, await authorized(), { intervalMinutes: 60, now: () => Date.parse('2026-03-10T12:00:00Z'), send, execute: async (_db, read) => { executed.push(`${read.kind}:${read.last}`); } });
    const outcome = await service.runOnce();
    assert.equal(outcome.result, 'ok'); assert.equal(outcome.reads, 1 + syncKinds.length * 2);
    assert.equal(env.db.prepare('SELECT state FROM google_read_jobs WHERE id = ?').get(running)?.state, 'complete');
    assert.equal(executed.length, syncKinds.length * 2);
    assert.ok(sent.some((address) => address.endsWith('/identity')));
    assert.equal(service.status().unfinishedJobs, 0);

    let calls = 0;
    const failing = new GoogleSyncService(env.path, await authorized(), { intervalMinutes: 60, now: () => Date.parse('2026-03-10T12:00:00Z'), execute: async () => { if (++calls === 2) throw new Error('google_http_429'); } });
    const failed = await failing.runOnce();
    assert.deepEqual([failed.result, failed.code, calls], ['error', 'google_http_429', 2]);
    const leaked = new GoogleSyncService(env.path, await authorized(), { intervalMinutes: 60, execute: async () => { throw new Error('token abc-secret'); } });
    assert.equal((await leaked.runOnce()).code, 'google_read_failed');
    const unauthorized = new GoogleSyncService(env.path, new GoogleAuth({ client_id: 'id', client_secret: 'secret' }), { intervalMinutes: null, execute: async () => { throw new Error('authorization_required'); } });
    assert.equal((await unauthorized.runOnce()).result, 'authorization_required');
  } finally { env.db.close(); rmSync(env.dir, { recursive: true, force: true }); }
});
