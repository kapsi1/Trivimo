import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import {
  migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateCsvNotes, migrateDailyRollups, migrateDailySummaries, migrateDayZone, migrateGooglePages,
  migratePageWindows, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs, readCanonicalDay,
} from '../packages/storage/canonical-days.ts';
import { agreedValues } from '../packages/adapters/google-health/daily-summary.ts';
import { projectGoogleDays, publishGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { commitGooglePage, createGoogleReadJob, type GoogleJobKind } from '../packages/storage/google-pages.ts';

const account = createHash('sha256').update('synthetic-account').digest('hex');
const civil = (d: number) => ({ date: { year: 2026, month: 3, day: d } });
const now = Date.parse('2026-03-10T12:00:00Z');
async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-summary-')); const db = new DatabaseSync(join(dir, 'db.sqlite')); const v = (n: number) => join(dir, `v${n}.sqlite`);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, v(1)); await migrateUserNotes(db, v(2)); await migrateSourceAccounts(db, v(3), true); await migrateGooglePages(db, v(4)); await migrateDailyRollups(db, v(5));
  await migrateCalorieJobs(db, v(6)); await migrateWindowJobs(db, v(7)); await migrateReadPolicy(db, v(8)); await migrateSourceLists(db, v(9)); await migrateCsvImports(db, v(10));
  await migrateCsvNotes(db, v(11)); await migratePageWindows(db, v(12)); await migrateDayZone(db, v(13)); await migrateDailySummaries(db, v(14));
  return { db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const read = (db: DatabaseSync, kind: GoogleJobKind, start: string, end: string, page: object) => commitGooglePage(db, createGoogleReadJob(db, account, kind, start, end), null, JSON.stringify(page));
const steps = (d: number, total: string) => ({ rollupDataPoints: [{ civilStartTime: civil(d), civilEndTime: civil(d + 1), steps: { countSum: total } }] });
const resting = (d: number, bpm: string) => ({ dataPoints: [{ dailyRestingHeartRate: { date: civil(d).date, beatsPerMinute: bpm } }] });

test('snapshot dnia niesie podsumowania Google: wartość, brak po pełnym odczycie, nieodczytane nie są wymieniane, bez snapshotu samych podsumowań', async () => {
  const { db, dispose } = await store();
  try {
    read(db, 'steps', '2026-03-05', '2026-03-06', steps(5, '1200'));
    read(db, 'daily-resting-heart-rate', '2026-03-04', '2026-03-08', resting(5, '54'));
    read(db, 'daily-vo2-max', '2026-03-04', '2026-03-08', { dataPoints: [] });
    const [day] = projectGoogleDays(db, '2026-03-05', '2026-03-07', now);
    assert.equal(projectGoogleDays(db, '2026-03-05', '2026-03-07', now).length, 1); // 6 and 7 have summaries read but no energy/steps read: no snapshot of their own
    assert.deepEqual(day?.summaries, { rule: 'google-daily-summaries-v2', items: [
      { type: 'daily-resting-heart-rate', status: 'value', values: { beatsPerMinute: '54' } },
      { type: 'daily-vo2-max', status: 'absent' },
    ] });
    // a day without any summary read keeps the snapshot form it had before
    read(db, 'steps', '2026-03-09', '2026-03-10', steps(9, '10'));
    assert.equal(projectGoogleDays(db, '2026-03-09', '2026-03-09', now)[0]?.summaries, undefined);
  } finally { dispose(); }
});

test('podsumowania zmieniają rewizję snapshotu tylko gdy zmieni się ich treść; wygrywa najnowszy odczyt', async () => {
  const { db, dispose } = await store();
  try {
    read(db, 'steps', '2026-03-05', '2026-03-06', steps(5, '1200'));
    assert.deepEqual(publishGoogleDays(db, '2026-03-05', '2026-03-05', now), { published: 1, unchanged: 0 });
    const metricsBefore = JSON.stringify(readCanonicalDay(db, '2026-03-05')?.metrics);
    read(db, 'daily-resting-heart-rate', '2026-03-04', '2026-03-08', resting(5, '54'));
    assert.deepEqual(publishGoogleDays(db, '2026-03-05', '2026-03-05', now), { published: 1, unchanged: 0 });
    assert.deepEqual(publishGoogleDays(db, '2026-03-05', '2026-03-05', now), { published: 0, unchanged: 1 });
    read(db, 'daily-resting-heart-rate', '2026-03-05', '2026-03-06', resting(5, '53'));
    assert.deepEqual(publishGoogleDays(db, '2026-03-05', '2026-03-05', now), { published: 1, unchanged: 0 });
    const snapshot = readCanonicalDay(db, '2026-03-05');
    assert.equal(snapshot?.revision, 3);
    assert.deepEqual(snapshot?.summaries?.items, [{ type: 'daily-resting-heart-rate', status: 'value', values: { beatsPerMinute: '53' } }]);
    assert.equal(JSON.stringify(snapshot?.metrics), metricsBefore); // summaries never change the metrics of the table
  } finally { dispose(); }
});

test('snapshot: dwa różne punkty jednej doby to konflikt z kandydatami, nie wybór', async () => {
  const { db, dispose } = await store();
  try {
    read(db, 'steps', '2026-03-05', '2026-03-06', steps(5, '1200'));
    read(db, 'daily-resting-heart-rate', '2026-03-04', '2026-03-08', { dataPoints: [resting(5, '56'), resting(5, '54')].flatMap((page) => page.dataPoints) });
    const [day] = projectGoogleDays(db, '2026-03-05', '2026-03-05', now);
    assert.deepEqual(day?.summaries?.items, [{ type: 'daily-resting-heart-rate', status: 'conflict', candidates: [{ beatsPerMinute: '54' }, { beatsPerMinute: '56' }] }]);
    assert.deepEqual(publishGoogleDays(db, '2026-03-05', '2026-03-05', now), { published: 1, unchanged: 0 });
    assert.equal(readCanonicalDay(db, '2026-03-05')?.summaries?.items[0]?.status, 'conflict');
  } finally { dispose(); }
});

test('snapshot: temperatura nocna zgodna w punktach doby to wartość „agreed”, reszta pól zostaje kandydatami; różna noc to nadal konflikt', async () => {
  const { db, dispose } = await store();
  try {
    const temp = (d: number, body: object) => ({ dailySleepTemperatureDerivations: { date: civil(d).date, ...body } });
    read(db, 'steps', '2026-03-05', '2026-03-07', { rollupDataPoints: [steps(5, '1200'), steps(6, '1300')].flatMap((page) => page.rollupDataPoints) });
    read(db, 'daily-sleep-temperature-derivations', '2026-03-04', '2026-03-08', { dataPoints: [
      temp(5, { nightlyTemperatureCelsius: 33.5, baselineTemperatureCelsius: 33.1 }),
      temp(5, { nightlyTemperatureCelsius: 33.5, baselineTemperatureCelsius: 33.2, relativeNightlyStddev30dCelsius: 0.4 }),
      temp(6, { nightlyTemperatureCelsius: 33.5, baselineTemperatureCelsius: 33.1 }),
      temp(6, { nightlyTemperatureCelsius: 33.6, baselineTemperatureCelsius: 33.1 }),
    ] });
    const [agreed, differing] = projectGoogleDays(db, '2026-03-05', '2026-03-06', now);
    const item = agreed?.summaries?.items[0];
    assert.equal(item?.status, 'agreed');
    assert.deepEqual(item?.values, { nightlyTemperatureCelsius: '33.5' }); // baseline and deviation are never picked
    assert.equal(item?.candidates?.length, 2);
    assert.equal(differing?.summaries?.items[0]?.status, 'conflict');
    assert.deepEqual(publishGoogleDays(db, '2026-03-05', '2026-03-06', now), { published: 2, unchanged: 0 });
    assert.equal(readCanonicalDay(db, '2026-03-05')?.summaries?.items[0]?.status, 'agreed');
  } finally { dispose(); }
});

test('reguła zgodnych pól dotyczy tylko temperatury nocnej: tętno z różnymi punktami zostaje konfliktem', () => {
  assert.deepEqual(agreedValues('daily-sleep-temperature-derivations', [{ nightlyTemperatureCelsius: '33.5', baselineTemperatureCelsius: '1' }, { nightlyTemperatureCelsius: '33.5' }]), { nightlyTemperatureCelsius: '33.5' });
  assert.equal(agreedValues('daily-sleep-temperature-derivations', [{ nightlyTemperatureCelsius: '33.5' }, { nightlyTemperatureCelsius: '33.50' }]), null); // text, not a rounded number
  assert.equal(agreedValues('daily-resting-heart-rate', [{ beatsPerMinute: '54' }, { beatsPerMinute: '54', entropy: '1' }]), null);
});
