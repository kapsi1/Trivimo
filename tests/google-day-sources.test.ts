import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { parseSourceList, sourceListPage } from '../packages/adapters/google-health/source-list.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs } from '../packages/storage/canonical-days.ts';
import { readDaySourcesRange } from '../packages/storage/google-day-sources.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { registerAutomaticJob } from '../packages/storage/google-read-policy.ts';

const digest = createHash('sha256').update('synthetic-account').digest('hex');
const date = (value: string) => { const [year, month, day] = value.split('-').map(Number); return { date: { year, month, day } }; };
const band = { platform: 'FITBIT', recordingMethod: 'PASSIVELY_MEASURED', device: { displayName: 'Synthetic Band' } };
const fit = { platform: 'HEALTH_CONNECT', recordingMethod: 'UNKNOWN', application: { packageName: 'com.example.fitness' }, device: { manufacturer: 'Example', formFactor: 'PHONE' } };
const page = (points: [string, object | undefined][], field = 'steps', next?: string) => JSON.stringify({ dataPoints: points.map(([day, dataSource]) => ({ ...(dataSource ? { dataSource } : {}), [field]: { interval: { civilStartTime: date(day) } } })), ...(next ? { nextPageToken: next } : {}) });

test('lista źródeł: liczba wpisów na dzień i źródło, wpis bez źródła jako nieznane; żądanie ogranicza pola', async () => {
  const parsed = parseSourceList(page([['2026-06-10', band], ['2026-06-10', band], ['2026-06-10', fit], ['2026-06-11', undefined]], 'steps', 'n'), 'steps-sources');
  assert.deepEqual(parsed.days, [
    { date: '2026-06-10', source: { platform: 'FITBIT', application: null, device: 'Synthetic Band', recordingMethod: 'PASSIVELY_MEASURED' }, records: 2 },
    { date: '2026-06-10', source: { platform: 'HEALTH_CONNECT', application: 'com.example.fitness', device: 'Example PHONE', recordingMethod: 'UNKNOWN' }, records: 1 },
    { date: '2026-06-11', source: { platform: null, application: null, device: null, recordingMethod: null }, records: 1 },
  ]);
  assert.equal(parsed.nextPageToken, 'n');
  assert.throws(() => parseSourceList(JSON.stringify({ dataPoints: [{ dataSource: band }] }), 'steps-sources'));

  let requested: URL | undefined;
  const result = await sourceListPage({ kind: 'active-energy-sources', start: '2026-06-10', end: '2026-06-17' }, 't', async (address) => { requested = new URL(String(address)); return new Response(page([['2026-06-10', band]], 'activeEnergyBurned')); });
  assert.equal(result.days[0]?.records, 1);
  assert.equal(requested?.pathname, '/v4/users/me/dataTypes/active-energy-burned/dataPoints');
  assert.equal(requested?.searchParams.get('filter'), 'active_energy_burned.interval.civil_start_time >= "2026-06-10T00:00:00" AND active_energy_burned.interval.civil_start_time < "2026-06-17T00:00:00"');
  assert.equal(requested?.searchParams.get('fields'), 'dataPoints(dataSource,activeEnergyBurned(interval(civilStartTime(date)))),nextPageToken');
  assert.equal(requested?.searchParams.get('prettyPrint'), 'false');
  await assert.rejects(sourceListPage({ kind: 'steps-sources', start: '2026-06-10', end: '2026-06-25' }, 't', async () => new Response('{}')), /invalid_range/);
  await assert.rejects(sourceListPage({ kind: 'steps-sources', start: '2026-06-10', end: '2026-06-11' }, 't', async () => new Response('', { status: 429 })), /google_http_429/);
});

async function store(version: 9 | 10) {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-sources-')); const db = new DatabaseSync(join(dir, 'db.sqlite'));
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite'));
  if (version === 10) await migrateSourceLists(db, join(dir, 'v9.sqlite'));
  return { dir, db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('migracja 10 zachowuje zadania, strony i metadane odczytów oraz przyjmuje listy źródeł', async () => {
  const { dir, db, dispose } = await store(9);
  try {
    const id = createGoogleReadJob(db, digest, 'steps', '2026-06-10', '2026-06-11');
    commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: [] }));
    registerAutomaticJob(db, id);
    assert.throws(() => db.prepare("INSERT INTO google_read_jobs VALUES ('x', ?, 'steps-sources', '2026-06-10', '2026-06-11', NULL, 'running', '2026-06-11T00:00:00.000Z')").run(digest));
    await migrateSourceLists(db, join(dir, 'before-v10.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 10);
    assert.deepEqual({ ...db.prepare('SELECT (SELECT COUNT(*) FROM google_read_jobs) AS jobs, (SELECT COUNT(*) FROM google_read_pages) AS pages, (SELECT origin FROM google_read_job_meta WHERE job_id = ?) AS origin').get(id) }, { jobs: 1, pages: 1, origin: 'automatic' });
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const lists = createGoogleReadJob(db, digest, 'steps-sources', '2026-06-10', '2026-06-17');
    assert.equal(commitGooglePage(db, lists, null, page([['2026-06-10', band]])).complete, true);
    assert.throws(() => createGoogleReadJob(db, digest, 'steps-sources', '2026-06-10', '2026-06-30'), /invalid_range/);
  } finally { dispose(); }
});

test('źródła dnia: najnowszy pełny odczyt wygrywa, odczyt bez wpisów to pusta lista, dzień bez odczytu pozostaje nieznany', async () => {
  const { db, dispose } = await store(10);
  try {
    const read = (kind: 'steps-sources' | 'active-energy-sources', start: string, end: string, body: string, createdAt: string) => {
      const id = createGoogleReadJob(db, digest, kind, start, end); commitGooglePage(db, id, null, body);
      db.prepare('UPDATE google_read_jobs SET created_at = ? WHERE id = ?').run(createdAt, id);
    };
    read('steps-sources', '2026-06-10', '2026-06-13', page([['2026-06-10', fit], ['2026-06-11', fit]]), '2026-06-12T08:00:00.000Z');
    read('steps-sources', '2026-06-11', '2026-06-12', page([['2026-06-11', band], ['2026-06-11', band], ['2026-06-11', fit]]), '2026-06-13T08:00:00.000Z');
    read('active-energy-sources', '2026-06-10', '2026-06-11', page([], 'activeEnergyBurned'), '2026-06-12T08:00:00.000Z');
    const days = readDaySourcesRange(db, '2026-06-09', '2026-06-12');
    assert.deepEqual(days.map((day) => [day.date, day.steps?.map((item) => `${item.source.platform}:${item.records}`) ?? null, day.activeEnergy?.length ?? null]), [
      ['2026-06-09', null, null],
      ['2026-06-10', ['HEALTH_CONNECT:1'], 0],
      ['2026-06-11', ['FITBIT:2', 'HEALTH_CONNECT:1'], null],
      ['2026-06-12', [], null],
    ]);
  } finally { dispose(); }
});
