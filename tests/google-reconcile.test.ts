import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceLists, migrateCsvImports, migrateCsvNotes, migratePageWindows, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs } from '../packages/storage/canonical-days.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { GoogleAuth } from '../apps/server/google-auth.ts';
import { GoogleSyncService, planReconcile, reconcileInterval, reconcileReadsManual, reconcileReadsPerRun, verifiedDays } from '../apps/server/google-sync.ts';

const account = 'a'.repeat(64);
let counter = 0;
function store() {
  const db = createDemoDatabase();
  db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE google_read_job_meta (job_id TEXT PRIMARY KEY, origin TEXT NOT NULL, content_digest TEXT, confirmed_at TEXT, confirmations INTEGER NOT NULL DEFAULT 0);`);
  return db;
}
function done(db: DatabaseSync, kind: string, start: string, end: string, createdAt: string, confirmedAt?: string) {
  const id = `r${counter++}`;
  db.prepare("INSERT INTO google_read_jobs (id, account_digest, kind, range_start, range_end, state, created_at) VALUES (?, ?, ?, ?, ?, 'complete', ?)").run(id, account, kind, start, end, createdAt);
  if (confirmedAt) db.prepare("INSERT INTO google_read_job_meta (job_id, origin, confirmed_at, confirmations) VALUES (?, 'automatic', ?, 1)").run(id, confirmedAt);
}
const at = (iso: string) => Date.parse(iso);

test('weryfikacja doby: liczy się odczyt po końcu doby, a potwierdzenie „bez zmian” odświeża weryfikację', () => {
  const db = store();
  try {
    done(db, 'steps', '2026-03-01', '2026-03-04', '2026-03-03T12:00:00.000Z', '2026-03-10T08:00:00.000Z');
    const verified = verifiedDays(db, 'steps', '2026-03-01', '2026-03-10');
    // 03-01 and 03-02 ended before the read; 03-03 was still in progress at creation but ended before the confirmation
    assert.equal(verified.get('2026-03-01'), at('2026-03-10T08:00:00.000Z'));
    assert.equal(verified.get('2026-03-03'), at('2026-03-10T08:00:00.000Z'));
    assert.equal(verified.has('2026-03-04'), false);
    const unconfirmed = store();
    done(unconfirmed, 'steps', '2026-03-01', '2026-03-04', '2026-03-03T12:00:00.000Z');
    const only = verifiedDays(unconfirmed, 'steps', '2026-03-01', '2026-03-10');
    assert.deepEqual([...only.keys()], ['2026-03-01', '2026-03-02']);
    unconfirmed.close();
  } finally { db.close(); }
});

test('plan rekonsyliacji: pusta baza, luki i okno odświeżania nie dają odczytów', () => {
  const db = store();
  try {
    assert.deepEqual(planReconcile(db, '2026-04-20', at('2026-04-20T10:00:00Z'), '2026-01-01', 5), []);
    // a read that ends before the last completed days leaves them unverified: the chunk with a gap is the backfill's job
    done(db, 'steps', '2026-01-01', '2026-04-01', '2026-04-02T00:00:00.000Z');
    done(db, 'steps', '2026-04-01', '2026-04-20', '2026-04-20T00:00:00.000Z');
    const plan = planReconcile(db, '2026-04-20', at('2026-04-20T10:00:00Z'), '2026-01-01', 5);
    assert.deepEqual(plan.map((read) => [read.kind, read.first, read.last]), [['steps', '2026-01-01', '2026-03-31']]);
    // days newer than the fourth completed day back belong to the refresh window
    assert.ok(plan.every((read) => read.last <= '2026-04-16'));
    assert.equal(planReconcile(db, '2026-04-20', at('2026-04-20T10:00:00Z'), '2026-04-17', 5).length, 0);
  } finally { db.close(); }
});

test('plan rekonsyliacji: ważność zależy od wieku doby, potwierdzenie ją przedłuża, a ręczne wymuszenie ją pomija', () => {
  const db = store();
  try {
    done(db, 'steps', '2026-01-01', '2026-04-01', '2026-04-02T00:00:00.000Z');
    const chunk = (now: string, force = false) => planReconcile(db, '2026-04-20', at(now), '2026-01-01', 5, force).length;
    // the last day of the chunk is 20 days old: re-read after 2 days
    assert.equal(chunk('2026-04-03T00:00:00Z'), 0);
    assert.equal(chunk('2026-04-04T00:00:01Z'), 1);
    assert.equal(chunk('2026-04-03T00:00:00Z', true), 1);
    // a confirmation of an identical re-read counts as verification
    const confirmed = store();
    done(confirmed, 'steps', '2026-01-01', '2026-04-01', '2026-04-02T00:00:00.000Z', '2026-04-19T00:00:00.000Z');
    assert.equal(planReconcile(confirmed, '2026-04-20', at('2026-04-20T10:00:00Z'), '2026-01-01', 5).length, 0);
    confirmed.close();
    assert.deepEqual([reconcileInterval(10), reconcileInterval(30), reconcileInterval(31), reconcileInterval(90), reconcileInterval(91)].map((ms) => ms / 86400000), [2, 2, 7, 7, 30]);
  } finally { db.close(); }
});

test('plan rekonsyliacji: najdawniej sprawdzane paczki idą pierwsze, w granicach limitu, a okna są czytane po granicach doby', () => {
  const db = store();
  try {
    done(db, 'steps', '2026-01-01', '2026-04-01', '2026-04-02T00:00:00.000Z');
    done(db, 'distance', '2026-01-01', '2026-04-01', '2026-04-05T00:00:00.000Z');
    // ten-minute windows: chunks of 13 days aligned to the history start, bounds are those of Warsaw days
    done(db, 'heart-rate-10m', warsawDay('2026-01-01').start, warsawDay('2026-01-13').end, '2026-03-01T00:00:00.000Z');
    const plan = planReconcile(db, '2026-04-20', at('2026-04-20T10:00:00Z'), '2026-01-01', 2);
    assert.deepEqual(plan.map((read) => read.kind), ['heart-rate-10m', 'steps']);
    assert.deepEqual([plan[0]!.first, plan[0]!.last, plan[0]!.begin, plan[0]!.end], ['2026-01-01', '2026-01-13', warsawDay('2026-01-01').start, warsawDay('2026-01-13').end]);
    assert.equal(planReconcile(db, '2026-04-20', at('2026-04-20T10:00:00Z'), '2026-01-01', 0).length, 0);
    assert.ok(reconcileReadsPerRun < reconcileReadsManual);
  } finally { db.close(); }
});

function migrated() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-reconcile-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  return { dir, path, db, ready: async () => {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
    await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite'));
  } };
}
const scopes = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
async function authorized() {
  const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'private', expires_in: 3600, scope: scopes }));
  await auth.finish(new URL(auth.start()).searchParams.get('state'), 'code');
  return auth;
}

test('serwis: przebieg odczytuje starsze doby w limicie, a odczyt ręczny wymusza paczki niezależnie od ważności', async () => {
  const env = migrated();
  try {
    await env.ready();
    done(env.db, 'steps', '2026-01-01', '2026-03-07', '2026-03-07T12:00:00.000Z');
    const executed: string[] = [];
    const options = { intervalMinutes: 60, now: () => Date.parse('2026-03-10T12:00:00Z'), execute: async (_db: DatabaseSync, read: { kind: string; first: string; last: string }) => { executed.push(`${read.kind}:${read.first}:${read.last}`); } };
    const automatic = await new GoogleSyncService(env.path, await authorized(), options).runOnce();
    assert.equal(automatic.result, 'ok');
    assert.equal(automatic.reconciled, 1);
    assert.ok(executed.includes('steps:2026-01-01:2026-03-06'));

    executed.length = 0;
    // 1 day after the previous verification, older than the refresh window: not due without force
    const fresh = new GoogleSyncService(env.path, await authorized(), { ...options, now: () => Date.parse('2026-03-08T12:00:00Z') });
    assert.equal((await fresh.runOnce()).reconciled, undefined);
    const forced = await fresh.runOnce({ reconcile: 'force' });
    assert.equal(forced.reconciled, 1);
    assert.ok(executed.includes('steps:2026-01-01:2026-03-04'));
  } finally { env.db.close(); rmSync(env.dir, { recursive: true, force: true }); }
});
