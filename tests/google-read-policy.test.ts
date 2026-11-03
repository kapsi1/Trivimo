import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceLists, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs } from '../packages/storage/canonical-days.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { applyReadPolicy, registerAutomaticJob } from '../packages/storage/google-read-policy.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';

async function migrated() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-policy-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite'));
  await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite'));
  return { dir, path, db };
}
const page = (day: number, steps: string) => JSON.stringify({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 3, day } }, civilEndTime: { date: { year: 2026, month: 3, day: day + 1 } }, steps: { countSum: steps } }] });
const date = (day: number) => `2026-03-${String(day).padStart(2, '0')}`;
const account = 'a'.repeat(64);

function read(db: DatabaseSync, o: { first: number; last: number; value: string; at: string; automatic?: boolean; account?: string }): string {
  const id = createGoogleReadJob(db, o.account ?? account, 'steps', date(o.first), date(o.last + 1));
  if (o.automatic !== false) registerAutomaticJob(db, id);
  const days = []; for (let day = o.first; day <= o.last; day++) days.push({ civilStartTime: { date: { year: 2026, month: 3, day } }, civilEndTime: { date: { year: 2026, month: 3, day: day + 1 } }, steps: { countSum: o.value } });
  commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: days }));
  db.prepare('UPDATE google_read_jobs SET created_at = ? WHERE id = ?').run(o.at, id);
  return id;
}
const jobs = (db: DatabaseSync) => db.prepare('SELECT id FROM google_read_jobs').all().map((row) => String(row.id));
const audit = (db: DatabaseSync) => db.prepare('SELECT reason, pages_removed FROM google_read_supersessions ORDER BY removed_at, id').all().map((row) => `${row.reason}:${row.pages_removed}`);

test('polityka: identyczny ponowny odczyt jest pomijany, a wcześniejszy dostaje potwierdzenie', async () => {
  const env = await migrated();
  try {
    const first = read(env.db, { first: 10, last: 10, value: '100', at: '2026-03-10T10:00:00.000Z' });
    const second = read(env.db, { first: 10, last: 10, value: '100', at: '2026-03-10T11:00:00.000Z' });
    const outcome = applyReadPolicy(env.db, second, Date.parse('2026-03-10T11:00:05Z'));
    assert.deepEqual(outcome, { result: 'unchanged_duplicate', keptJob: first, removed: 1 });
    assert.deepEqual(jobs(env.db), [first]);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM google_read_pages').get()?.n, 1);
    assert.deepEqual({ ...env.db.prepare('SELECT confirmations, confirmed_at FROM google_read_job_meta WHERE job_id = ?').get(first) }, { confirmations: 1, confirmed_at: '2026-03-10T11:00:05.000Z' });
    assert.deepEqual(audit(env.db), ['unchanged_duplicate:1']);
    verifyTakeout(env.path);
  } finally { env.db.close(); rmSync(env.dir, { recursive: true, force: true }); }
});

test('polityka: nowszy odczyt dzisiejszej doby zastępuje pośredni, a doba zakończona zachowuje różne wartości w oknie korekt', async () => {
  const env = await migrated();
  try {
    const morning = read(env.db, { first: 10, last: 10, value: '100', at: '2026-03-10T08:00:00.000Z' });
    const evening = read(env.db, { first: 10, last: 10, value: '300', at: '2026-03-10T20:00:00.000Z' });
    assert.deepEqual(applyReadPolicy(env.db, evening, Date.parse('2026-03-10T20:00:05Z')), { result: 'kept', removed: 1 });
    assert.deepEqual(jobs(env.db), [evening]);
    assert.deepEqual(audit(env.db), ['intermediate_current_day:1']);
    // next day the "last three days" read covers day 10: the last partial reading is kept as a distinct value
    const recent = read(env.db, { first: 8, last: 10, value: '300', at: '2026-03-11T06:00:00.000Z' });
    assert.deepEqual(applyReadPolicy(env.db, recent, Date.parse('2026-03-11T06:00:05Z')), { result: 'kept', removed: 0 });
    assert.deepEqual(jobs(env.db).sort(), [evening, recent].sort());
    // five days later a read of the whole stretch makes it redundant, because day 10 left the correction window
    const catchUp = read(env.db, { first: 8, last: 14, value: '300', at: '2026-03-15T06:00:00.000Z' });
    const outcome = applyReadPolicy(env.db, catchUp, Date.parse('2026-03-15T06:00:05Z'));
    assert.deepEqual(outcome, { result: 'kept', removed: 2 });
    assert.deepEqual(jobs(env.db), [catchUp]);
    assert.deepEqual(audit(env.db), ['intermediate_current_day:1', 'superseded_after_correction_window:1', 'superseded_after_correction_window:1']);
    verifyTakeout(env.path);
  } finally { env.db.close(); rmSync(env.dir, { recursive: true, force: true }); }
});

test('polityka: ręczne odczyty i inne konta nigdy nie są usuwane, a niezakończone zadanie nie uruchamia polityki', async () => {
  const env = await migrated();
  try {
    const manual = read(env.db, { first: 10, last: 10, value: '100', at: '2026-03-10T08:00:00.000Z', automatic: false });
    const other = read(env.db, { first: 10, last: 10, value: '100', at: '2026-03-10T08:30:00.000Z', account: 'b'.repeat(64) });
    const automatic = read(env.db, { first: 10, last: 10, value: '300', at: '2026-03-10T20:00:00.000Z' });
    assert.deepEqual(applyReadPolicy(env.db, automatic, Date.parse('2026-03-10T20:00:05Z')), { result: 'kept', removed: 0 });
    assert.deepEqual(jobs(env.db).sort(), [manual, other, automatic].sort());
    assert.deepEqual(applyReadPolicy(env.db, manual, Date.parse('2026-03-10T20:00:05Z')), { result: 'not_automatic', removed: 0 });
    const running = createGoogleReadJob(env.db, account, 'steps', date(10), date(11)); registerAutomaticJob(env.db, running);
    assert.deepEqual(applyReadPolicy(env.db, running, Date.parse('2026-03-10T20:00:05Z')), { result: 'not_automatic', removed: 0 });
    // an identical re-read of a manual read is still dropped and confirms the manual one
    const again = read(env.db, { first: 10, last: 10, value: '100', at: '2026-03-10T21:00:00.000Z' });
    assert.equal(applyReadPolicy(env.db, again, Date.parse('2026-03-10T21:00:05Z')).result, 'kept');
  } finally { env.db.close(); rmSync(env.dir, { recursive: true, force: true }); }
});
