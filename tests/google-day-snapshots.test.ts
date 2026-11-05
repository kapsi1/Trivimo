import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceLists, migrateCsvImports, migrateCsvNotes, migratePageWindows, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { projectGoogleDays, publishGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { commitGooglePage, createGoogleReadJob, type GoogleJobKind } from '../packages/storage/google-pages.ts';

const digest = createHash('sha256').update('synthetic-account').digest('hex');
const civil = (date: string) => { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day } }; };
const next = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
function read(db: DatabaseSync, kind: GoogleJobKind, start: string, end: string, points: unknown[], createdAt?: string) {
  const id = createGoogleReadJob(db, digest, kind, start, end);
  commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: points }));
  if (createdAt) db.prepare('UPDATE google_read_jobs SET created_at = ? WHERE id = ?').run(createdAt, id);
}
const daily = (date: string, field: 'totalCalories' | 'activeEnergyBurned', kcal: string) => ({ civilStartTime: civil(date), civilEndTime: civil(next(date)), [field]: { kcalSum: kcal } });
/** Ten-minute windows of one Warsaw day; `value(index)` returns the field object or null for no window. */
function windows(date: string, value: (index: number) => object | null) {
  const start = Date.parse(warsawDay(date).start), count = (Date.parse(warsawDay(date).end) - start) / 600000;
  return Array.from({ length: count }, (_, index) => { const field = value(index); return field && { startTime: new Date(start + index * 600000).toISOString(), endTime: new Date(start + (index + 1) * 600000).toISOString(), ...field }; }).filter(Boolean);
}
// kcalSum is a JSON number in the API; the fixtures write it as text and patch it into a number literal
const json = (points: unknown[]) => JSON.parse(JSON.stringify(points).replace(/"kcalSum":"([\d.]+)"/g, '"kcalSum":$1')) as unknown[];

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-energy-')); const db = new DatabaseSync(join(dir, 'db.sqlite'));
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite'));
  return { db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('kalorie z danych Google: pełny model z udziałem opaski, starszy model bez uwagi, sam BMR pusty, doba w toku częściowa', async () => {
  const { db, dispose } = await store();
  try {
    // 2026-03-10 legacy (few long intervals, no active), 2026-04-10 basal only, 2026-06-10 current with partial wear, 2026-06-11 phone only
    read(db, 'total-calories', '2026-03-10', '2026-03-11', json([daily('2026-03-10', 'totalCalories', '2100.5')]));
    read(db, 'total-calories-10m', warsawDay('2026-03-10').start, warsawDay('2026-03-10').end, json(windows('2026-03-10', (index) => index % 30 === 0 ? { totalCalories: { kcalSum: '420.1' } } : null)));
    read(db, 'heart-rate-10m', warsawDay('2026-03-10').start, warsawDay('2026-03-10').end, []);
    read(db, 'heart-rate-10m', warsawDay('2026-04-10').start, warsawDay('2026-04-10').end, []);
    read(db, 'total-calories', '2026-04-10', '2026-04-11', json([daily('2026-04-10', 'totalCalories', '1500')]));
    read(db, 'total-calories-10m', warsawDay('2026-04-10').start, warsawDay('2026-04-10').end, json(windows('2026-04-10', () => ({ totalCalories: { kcalSum: '10.4167' } }))));
    for (const date of ['2026-06-10', '2026-06-11']) {
      read(db, 'total-calories', date, next(date), json([daily(date, 'totalCalories', '2600.25')]));
      read(db, 'active-energy-burned', date, next(date), json([daily(date, 'activeEnergyBurned', '0.0')]));
      read(db, 'total-calories-10m', warsawDay(date).start, warsawDay(date).end, json(windows(date, (index) => ({ totalCalories: { kcalSum: String(10 + (index % 7)) } }))));
      read(db, 'active-energy-10m', warsawDay(date).start, warsawDay(date).end, json(windows(date, (index) => index < 12 ? { activeEnergyBurned: { kcalSum: '2.5' } } : null)));
      read(db, 'heart-rate-10m', warsawDay(date).start, warsawDay(date).end, windows(date, (index) => date === '2026-06-10' && index < 6 ? { heartRate: { beatsPerMinuteAvg: 90 } } : null));
    }
    const now = Date.parse('2026-06-12T08:00:00Z');
    const snapshots = new Map(projectGoogleDays(db, '2026-03-01', '2026-06-12', now).map((snapshot) => [snapshot.date, snapshot]));
    assert.deepEqual([...snapshots.keys()], ['2026-03-10', '2026-04-10', '2026-06-10', '2026-06-11']);

    const legacy = snapshots.get('2026-03-10')!;
    assert.deepEqual(legacy.metrics.total_energy, { status: 'valid', value: { numerator: '4201', denominator: '2' } });
    assert.deepEqual(legacy.metrics.active_energy, { status: 'missing', value: null });
    assert.deepEqual(legacy.issues, []);
    assert.equal(legacy.energy?.model, 'legacy');

    const basal = snapshots.get('2026-04-10')!;
    assert.deepEqual([basal.metrics.total_energy, basal.energy?.model], [{ status: 'incomparable', value: null }, 'basal_only']);
    assert.deepEqual(basal.issues, [{ metric: 'total_energy', code: 'basal_only', state: 'active' }]);

    const mixed = snapshots.get('2026-06-10')!;
    assert.deepEqual(mixed.metrics.total_energy, { status: 'valid', value: { numerator: '10401', denominator: '4' } });
    // an explicit zero from the producer stays a confirmed zero, not a gap
    assert.deepEqual(mixed.metrics.active_energy, { status: 'valid', value: { numerator: '0', denominator: '1' } });
    assert.deepEqual(mixed.issues, []);
    assert.deepEqual(mixed.energy, { rule: 'google-energy-v1', model: 'current', heartRateWindows: 6, dayWindows: 144, activeWithHeartRateKcal: '15.00', activeWithoutHeartRateKcal: '15.00' });
    // steps and weight were not read for this day: no data, not zero
    assert.deepEqual([mixed.metrics.steps.status, mixed.metrics.weight.status, mixed.body?.weightRecords], ['missing', 'missing', null]);
    assert.equal(snapshots.get('2026-06-11')!.energy?.heartRateWindows, 0);

    // the current day is provisional without a note (the table marks it); a past day read before its end keeps the note
    // read at 10:00 Warsaw time: 60 windows have passed, so a third of the day's windows is not a coarse legacy day
    read(db, 'total-calories', '2026-06-12', '2026-06-13', json([daily('2026-06-12', 'totalCalories', '900')]), '2026-06-12T08:00:00.000Z');
    read(db, 'active-energy-burned', '2026-06-12', '2026-06-13', json([daily('2026-06-12', 'activeEnergyBurned', '120')]));
    read(db, 'total-calories-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, json(windows('2026-06-12', (index) => index < 60 ? { totalCalories: { kcalSum: String(10 + (index % 7)) } } : null)));
    read(db, 'heart-rate-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, []);
    const today = projectGoogleDays(db, '2026-06-12', '2026-06-12', now)[0]!;
    assert.deepEqual([today.metrics.total_energy.status, today.metrics.active_energy.status, today.energy?.model, today.issues], ['provisional', 'provisional', 'current', []]);
    // just after midnight only the basal rate has accrued: still a provisional current day, not basal-only
    read(db, 'total-calories', '2026-06-13', '2026-06-14', json([daily('2026-06-13', 'totalCalories', '30')]), '2026-06-12T22:20:00.000Z');
    read(db, 'active-energy-burned', '2026-06-13', '2026-06-14', json([daily('2026-06-13', 'activeEnergyBurned', '0')]));
    read(db, 'total-calories-10m', warsawDay('2026-06-13').start, warsawDay('2026-06-13').end, json(windows('2026-06-13', (index) => index < 2 ? { totalCalories: { kcalSum: '15' } } : null)));
    read(db, 'heart-rate-10m', warsawDay('2026-06-13').start, warsawDay('2026-06-13').end, []);
    const night = projectGoogleDays(db, '2026-06-13', '2026-06-13', Date.parse('2026-06-12T22:25:00Z'))[0]!;
    assert.deepEqual([night.energy?.model, night.metrics.total_energy.status, night.issues], ['current', 'provisional', []]);
    // also before the producer reports any active energy for the day
    db.prepare("DELETE FROM google_read_pages WHERE job_id IN (SELECT id FROM google_read_jobs WHERE kind = 'active-energy-burned' AND range_start = '2026-06-13')").run();
    db.prepare("DELETE FROM google_read_jobs WHERE kind = 'active-energy-burned' AND range_start = '2026-06-13'").run();
    const noActive = projectGoogleDays(db, '2026-06-13', '2026-06-13', Date.parse('2026-06-12T22:25:00Z'))[0]!;
    assert.deepEqual([noActive.energy?.model, noActive.metrics.total_energy.status, noActive.issues], ['current', 'provisional', []]);
    // read before the day ended: provisional with an incomplete-coverage note
    db.prepare("UPDATE google_read_jobs SET created_at = '2026-06-11T20:00:00.000Z' WHERE kind = 'total-calories' AND range_start = '2026-06-11'").run();
    const early = projectGoogleDays(db, '2026-06-11', '2026-06-11', now)[0]!;
    assert.deepEqual([early.metrics.total_energy.status, early.issues], ['provisional', [{ metric: 'total_energy', code: 'incomplete_coverage', state: 'active' }, { metric: 'active_energy', code: 'incomplete_coverage', state: 'active' }]]);
  } finally { dispose(); }
});

test('publikacja kalorii: nowa rewizja tylko po zmianie, wartości i uwagi w jednym snapshocie; doba bez odczytu okien nieporównywalna', async () => {
  const { db, dispose } = await store();
  try {
    read(db, 'total-calories', '2026-06-10', '2026-06-11', json([daily('2026-06-10', 'totalCalories', '2600')]));
    read(db, 'heart-rate-10m', warsawDay('2026-06-10').start, warsawDay('2026-06-10').end, []);
    const now = Date.parse('2026-06-12T08:00:00Z');
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-12', now), { published: 1, unchanged: 0 });
    const first = readCanonicalDay(db, '2026-06-10')!;
    assert.deepEqual([first.revision, first.metrics.total_energy.status, first.energy?.model, first.notes], [1, 'incomparable', 'unknown', ['Kalorie: nieporównywalne źródło']]);
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-12', now), { published: 0, unchanged: 1 });

    read(db, 'active-energy-burned', '2026-06-10', '2026-06-11', json([daily('2026-06-10', 'activeEnergyBurned', '700')]));
    read(db, 'total-calories-10m', warsawDay('2026-06-10').start, warsawDay('2026-06-10').end, json(windows('2026-06-10', (index) => ({ totalCalories: { kcalSum: String(10 + (index % 7)) } }))));
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-12', now), { published: 1, unchanged: 0 });
    const second = readCanonicalDay(db, '2026-06-10')!;
    assert.deepEqual([second.revision, second.metrics.total_energy.status, second.metrics.active_energy.status, second.notes], [2, 'valid', 'valid', []]);
  } finally { dispose(); }
});

test('kroki i dystans: wartość producenta dla doby warszawskiej, gdy okna sumują się do niej; niezgodność granicy doby jest nieporównywalna', async () => {
  const { db, dispose } = await store();
  try {
    const dailyCount = (date: string, field: 'steps' | 'distance', value: string) => ({ civilStartTime: civil(date), civilEndTime: civil(next(date)), [field]: field === 'steps' ? { countSum: value } : { millimetersSum: value } });
    for (const [date, stepsInWindows] of [['2026-06-10', '100'], ['2026-06-11', '90']] as const) {
      read(db, 'steps', date, next(date), [dailyCount(date, 'steps', '1200')]);
      read(db, 'distance', date, next(date), [dailyCount(date, 'distance', '845123')]);
      read(db, 'steps-10m', warsawDay(date).start, warsawDay(date).end, windows(date, (index) => index < 12 ? { steps: { countSum: stepsInWindows } } : null));
      read(db, 'distance-10m', warsawDay(date).start, warsawDay(date).end, windows(date, (index) => index === 0 ? { distance: { millimetersSum: '845123' } } : null));
    }
    // a confirmed zero: read with a point of zero steps
    read(db, 'steps', '2026-06-12', '2026-06-13', [dailyCount('2026-06-12', 'steps', '0')]);
    read(db, 'steps-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, []);
    const now = Date.parse('2026-06-14T08:00:00Z');
    const days = new Map(projectGoogleDays(db, '2026-06-10', '2026-06-12', now).map((day) => [day.date, day]));
    const matched = days.get('2026-06-10')!;
    assert.deepEqual(matched.metrics.steps, { status: 'valid', value: { numerator: '1200', denominator: '1' } });
    assert.deepEqual(matched.metrics.distance, { status: 'valid', value: { numerator: '845123', denominator: '1000000' } });
    // calories were not read for this day: no data and no note
    assert.deepEqual([matched.activity, matched.issues, matched.metrics.total_energy.status], [{ rule: 'google-activity-v1', stepsMatchWindows: true, distanceMatchWindows: true }, [], 'missing']);
    const unmatched = days.get('2026-06-11')!;
    assert.deepEqual([unmatched.metrics.steps.status, unmatched.metrics.distance.status, unmatched.activity?.stepsMatchWindows], ['incomparable', 'valid', false]);
    assert.ok(unmatched.issues.some((issue) => issue.metric === 'steps' && issue.code === 'incomparable_day'));
    assert.deepEqual(days.get('2026-06-12')!.metrics.steps, { status: 'valid', value: { numerator: '0', denominator: '1' } });
    // the current day: provisional, no note, the window relation assumed
    const ongoing = projectGoogleDays(db, '2026-06-11', '2026-06-11', Date.parse('2026-06-11T12:00:00Z'))[0]!;
    assert.deepEqual([ongoing.metrics.steps.status, ongoing.issues.filter((issue) => issue.metric === 'steps')], ['provisional', []]);
  } finally { dispose(); }
});

test('masa i tkanka tłuszczowa: średnia unikalnych pomiarów doby, kopie z kilku aplikacji liczone raz, konflikt bez średniej', async () => {
  const { db, dispose } = await store();
  try {
    const weightPoint = (name: string, time: string, grams: string, platform: string) => ({ name, dataSource: { platform }, weight: { sampleTime: { physicalTime: time }, weightGrams: grams } });
    const fatPoint = (name: string, time: string, percent: string) => ({ name, dataSource: { platform: 'FITBIT' }, bodyFat: { sampleTime: { physicalTime: time }, percentage: percent } });
    // grams and percentages are JSON numbers in the API
    const numbers = (points: unknown[]) => JSON.parse(JSON.stringify(points).replace(/"(weightGrams|percentage)":"([\d.]+)"/g, '"$1":$2')) as unknown[];
    const page = (kind: 'weight' | 'body-fat', first: string, last: string, points: unknown[]) => {
      const id = createGoogleReadJob(db, digest, kind, warsawDay(first).start, warsawDay(last).end);
      commitGooglePage(db, id, null, JSON.stringify({ dataPoints: numbers(points) }));
    };
    page('weight', '2026-06-10', '2026-06-12', [
      // 06-10: one weighing reported by two apps (same second, same value) and a second weighing in the evening
      weightPoint('users/me/dataTypes/weight/dataPoints/a', '2026-06-10T05:00:00.200Z', '80150', 'FITBIT'),
      weightPoint('users/me/dataTypes/weight/dataPoints/b', '2026-06-10T05:00:00.900Z', '80150.0004', 'HEALTH_CONNECT'),
      weightPoint('users/me/dataTypes/weight/dataPoints/c', '2026-06-10T18:30:00Z', '80950', 'FITBIT'),
      // 06-11: two records at the same moment with clearly different values cannot be told apart
      weightPoint('users/me/dataTypes/weight/dataPoints/d', '2026-06-11T05:00:00Z', '80000', 'FITBIT'),
      weightPoint('users/me/dataTypes/weight/dataPoints/e', '2026-06-11T05:00:00Z', '81000', 'HEALTH_CONNECT'),
      // 06-12 at 23:30 Warsaw time belongs to that Warsaw day, not to the next UTC one
      weightPoint('users/me/dataTypes/weight/dataPoints/f', '2026-06-12T21:30:00Z', '79999', 'FITBIT'),
    ]);
    page('body-fat', '2026-06-10', '2026-06-12', [fatPoint('users/me/dataTypes/body-fat/dataPoints/a', '2026-06-10T05:00:00Z', '18.4')]);
    const now = Date.parse('2026-06-14T08:00:00Z');
    const days = new Map(projectGoogleDays(db, '2026-06-10', '2026-06-12', now).map((day) => [day.date, day]));
    const first = days.get('2026-06-10')!;
    assert.deepEqual(first.metrics.weight, { status: 'valid', value: { numerator: '1611', denominator: '20' } });
    assert.deepEqual(first.metrics.body_fat, { status: 'valid', value: { numerator: '92', denominator: '5' } });
    assert.deepEqual(first.body, { rule: 'google-body-v1', weightRecords: 3, weightReplicas: 1, bodyFatRecords: 1, bodyFatReplicas: 0 });
    const conflict = days.get('2026-06-11')!;
    assert.deepEqual([conflict.metrics.weight, conflict.metrics.body_fat.status], [{ status: 'conflict', value: null }, 'missing']);
    assert.ok(conflict.issues.some((issue) => issue.metric === 'weight' && issue.code === 'identity_conflict'));
    assert.deepEqual(days.get('2026-06-12')!.metrics.weight, { status: 'valid', value: { numerator: '79999', denominator: '1000' } });
    // the current day is provisional without a note
    const ongoing = projectGoogleDays(db, '2026-06-10', '2026-06-10', Date.parse('2026-06-10T12:00:00Z'))[0]!;
    assert.deepEqual([ongoing.metrics.weight.status, ongoing.issues.filter((issue) => issue.metric === 'weight')], ['provisional', []]);
  } finally { dispose(); }
});
