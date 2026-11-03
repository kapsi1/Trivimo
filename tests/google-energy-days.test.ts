import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceLists, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { projectGoogleEnergyDays, publishGoogleEnergyDays } from '../packages/storage/google-energy-days.ts';
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
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite'));
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
    const snapshots = new Map(projectGoogleEnergyDays(db, '2026-03-01', '2026-06-12', now).map((snapshot) => [snapshot.date, snapshot]));
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
    assert.equal(mixed.metrics.steps.status, 'unsupported');
    assert.equal(snapshots.get('2026-06-11')!.energy?.heartRateWindows, 0);

    // the current day is provisional without a note (the table marks it); a past day read before its end keeps the note
    // read at 10:00 Warsaw time: 60 windows have passed, so a third of the day's windows is not a coarse legacy day
    read(db, 'total-calories', '2026-06-12', '2026-06-13', json([daily('2026-06-12', 'totalCalories', '900')]), '2026-06-12T08:00:00.000Z');
    read(db, 'active-energy-burned', '2026-06-12', '2026-06-13', json([daily('2026-06-12', 'activeEnergyBurned', '120')]));
    read(db, 'total-calories-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, json(windows('2026-06-12', (index) => index < 60 ? { totalCalories: { kcalSum: String(10 + (index % 7)) } } : null)));
    read(db, 'heart-rate-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, []);
    const today = projectGoogleEnergyDays(db, '2026-06-12', '2026-06-12', now)[0]!;
    assert.deepEqual([today.metrics.total_energy.status, today.metrics.active_energy.status, today.energy?.model, today.issues], ['provisional', 'provisional', 'current', []]);
    // read before the day ended: provisional with an incomplete-coverage note
    db.prepare("UPDATE google_read_jobs SET created_at = '2026-06-11T20:00:00.000Z' WHERE kind = 'total-calories' AND range_start = '2026-06-11'").run();
    const early = projectGoogleEnergyDays(db, '2026-06-11', '2026-06-11', now)[0]!;
    assert.deepEqual([early.metrics.total_energy.status, early.issues], ['provisional', [{ metric: 'total_energy', code: 'incomplete_coverage', state: 'active' }, { metric: 'active_energy', code: 'incomplete_coverage', state: 'active' }]]);
  } finally { dispose(); }
});

test('publikacja kalorii: nowa rewizja tylko po zmianie, wartości i uwagi w jednym snapshocie; doba bez odczytu okien nieporównywalna', async () => {
  const { db, dispose } = await store();
  try {
    read(db, 'total-calories', '2026-06-10', '2026-06-11', json([daily('2026-06-10', 'totalCalories', '2600')]));
    read(db, 'heart-rate-10m', warsawDay('2026-06-10').start, warsawDay('2026-06-10').end, []);
    const now = Date.parse('2026-06-12T08:00:00Z');
    assert.deepEqual(publishGoogleEnergyDays(db, '2026-06-01', '2026-06-12', now), { published: 1, unchanged: 0 });
    const first = readCanonicalDay(db, '2026-06-10')!;
    assert.deepEqual([first.revision, first.metrics.total_energy.status, first.energy?.model, first.notes], [1, 'incomparable', 'unknown', ['Kalorie: nieporównywalne źródło']]);
    assert.deepEqual(publishGoogleEnergyDays(db, '2026-06-01', '2026-06-12', now), { published: 0, unchanged: 1 });

    read(db, 'active-energy-burned', '2026-06-10', '2026-06-11', json([daily('2026-06-10', 'activeEnergyBurned', '700')]));
    read(db, 'total-calories-10m', warsawDay('2026-06-10').start, warsawDay('2026-06-10').end, json(windows('2026-06-10', (index) => ({ totalCalories: { kcalSum: String(10 + (index % 7)) } }))));
    assert.deepEqual(publishGoogleEnergyDays(db, '2026-06-01', '2026-06-12', now), { published: 1, unchanged: 0 });
    const second = readCanonicalDay(db, '2026-06-10')!;
    assert.deepEqual([second.revision, second.metrics.total_energy.status, second.metrics.active_energy.status, second.notes], [2, 'valid', 'valid', []]);
  } finally { dispose(); }
});
