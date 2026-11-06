import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calmActiveKcal, clockSlot as slotIn, forecastEnergy, forecastRule, maxHistoryDays, minHistoryDays, profileRule, type HistoryDay } from '../packages/domain/energy-forecast.ts';
import { warsawDay } from './helpers/warsaw-day.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { readEnergyForecast } from '../packages/storage/google-energy-forecast.ts';

const windowMs = 600000;
const clockSlot = (ms: number) => slotIn(ms, 'Europe/Warsaw');
const day = (date: string) => { const bounds = warsawDay(date); return { start: Date.parse(bounds.start), end: Date.parse(bounds.end), count: (Date.parse(bounds.end) - Date.parse(bounds.start)) / windowMs }; };
const next = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Windows of a day, `value(index)` by window index; null leaves the window out. */
function windows(date: string, count: number | null, value: (index: number) => number | null) {
  const bounds = day(date), n = count ?? bounds.count;
  return Array.from({ length: n }, (_, index) => ({ start: bounds.start + index * windowMs, value: value(index) === null ? null : String(value(index)) })).filter((window) => window.value !== null);
}
// a synthetic everyday: 10 kcal at night, 14 kcal in the waking hours 10:00–11:00 (slots 60–65, active 2 — not significant),
// and a daily workout in slots 100–103 (30 kcal of which 20 active — significant)
const total = (index: number) => index >= 100 && index < 104 ? 30 : index >= 60 && index < 66 ? 14 : 10;
const active = (index: number) => index >= 100 && index < 104 ? 20 : index >= 60 && index < 66 ? 2 : 0;
function history(days: number, from = '2026-06-01', complete = true): HistoryDay[] {
  return Array.from({ length: days }, (_, k) => { const date = next(from, k); return { windows: windows(date, null, (index) => complete || index !== 5 ? total(index) : null), dayWindows: day(date).count, active: windows(date, null, (index) => active(index) || null) }; });
}
const quiet = (date: string, count: number) => windows(date, count, () => 10);
const zeros = (date: string, count: number) => windows(date, count, () => 0);
const input = (date: string, done: number, days: HistoryDay[]) => { const today = day(date); return { dayStart: today.start, dayEnd: today.end, total: quiet(date, done), steps: zeros(date, done), active: zeros(date, done), history: days, zone: 'Europe/Warsaw' }; };

test('v2: reszta doby w tempie dnia powszednim — okna z treningiem w historii nie wchodzą do profilu', () => {
  const result = forecastEnergy(input('2026-06-20', 48, history(8)));        // up to 08:00; 96 windows remain
  assert.ok(result);
  assert.equal(result.rule, profileRule);
  assert.deepEqual([result.historyDays, result.remainingWindows, result.windowKcal.length], [8, 96, 96]);
  // remaining window j is slot 48 + j: 10:00–11:00 (slots 60–65) is the everyday 14 kcal, the workout slots 100–103 are 10 like the hour's others
  assert.deepEqual([result.windowKcal[11], result.windowKcal[12], result.windowKcal[17], result.windowKcal[18]], [10, 14, 14, 10]);
  assert.deepEqual([result.windowKcal[51], result.windowKcal[52], result.windowKcal[55], result.windowKcal[56]], [10, 10, 10, 10]);
  assert.equal(result.burnedKcal, 480);
  assert.equal(result.forecastKcal, 480 + 90 * 10 + 6 * 14);
  // v0 gives the same here (it assumes the rest idle at 10 kcal per window): 480 + 96 × 10; v2 is above it by the waking hour
  assert.equal(result.floorKcal, 1440);
  assert.ok(result.forecastKcal > result.floorKcal!);
  assert.ok(Math.abs(result.windowKcal.reduce((a, b) => a + b, 0) + result.burnedKcal - result.forecastKcal) < 1e-9);
});

test('v2: potrzebuje tylko okien total dnia; bez kroków i aktywnych kcal brak dolnej granicy, nie zero', () => {
  const base = input('2026-06-20', 48, history(8));
  const result = forecastEnergy({ ...base, steps: null, active: null });
  assert.ok(result);
  assert.deepEqual([result.rule, result.floorKcal, result.restRateKcalPerHour, result.restWindows], [profileRule, null, null, null]);
  assert.equal(forecastEnergy({ ...base, total: null, steps: null, active: null }), null);
  assert.equal(forecastEnergy({ ...base, total: [], steps: [], active: [] }), null);
});

test('v2: za mało pełnych dób, brak odczytu aktywnych kcal historii albo godzina bez okien codziennych → v0 z jego etykietą', () => {
  const few = forecastEnergy(input('2026-06-20', 48, history(minHistoryDays - 1)));
  assert.ok(few);
  assert.deepEqual([few.rule, few.historyDays, few.floorKcal === few.forecastKcal], [forecastRule, null, true]);
  assert.ok(few.windowKcal.length === 96 && few.windowKcal.every((value) => value === 10));
  // a day with a missing window or an unread active series is not usable
  const gaps = [...history(3, '2026-06-01', false), ...history(4, '2026-06-04')];
  assert.equal(forecastEnergy(input('2026-06-20', 48, gaps))?.rule, forecastRule);
  const unread = history(8).map((item, index) => index < 2 ? { ...item, active: null } : item);
  assert.equal(forecastEnergy(input('2026-06-20', 48, unread))?.rule, forecastRule);
  assert.equal(forecastEnergy(input('2026-06-20', 48, unread.slice(0, 7)))?.historyDays, null);
  // an hour in which nearly every history window was exercise has too few everyday windows: no guess
  const busy = history(8).map((item) => ({ ...item, active: Array.from({ length: 6 }, (_, k) => ({ start: item.windows[0]!.start + (96 + k) * windowMs, value: '20' })) }));
  assert.equal(forecastEnergy(input('2026-06-20', 48, busy))?.rule, forecastRule);
  // without v0 inputs there is nothing to fall back to
  assert.equal(forecastEnergy({ ...input('2026-06-20', 48, history(3)), steps: null }), null);
  // the profile takes the newest 14 complete days
  assert.equal(forecastEnergy(input('2026-06-20', 48, history(20)))?.historyDays, maxHistoryDays);
});

test('v2: próg znaczącej aktywności, brak okna aktywnych kcal to brak aktywności, wynik nie schodzi poniżej v0', () => {
  assert.equal(calmActiveKcal, 3);
  // window with exactly the threshold counts as everyday (its 40 kcal enter the hour's mean), above it as exercise (they do not)
  const run = (activeKcal: number) => forecastEnergy(input('2026-06-20', 48, history(8).map((item) => { const at = item.windows[0]!.start + 61 * windowMs; return { ...item, windows: item.windows.map((window) => window.start === at ? { ...window, value: '40' } : window), active: [{ start: at, value: String(activeKcal) }] }; })))!;
  assert.ok(Math.abs(run(3).windowKcal[12]! - (5 * 14 + 40) / 6) < 1e-9);
  assert.equal(run(3.5).windowKcal[12], 14);
  // the floor: a quiet day at 20 kcal per window (v0 rate) is above a history of 10–14, so the result is stretched to it
  const today = day('2026-06-20');
  const hot = forecastEnergy({ dayStart: today.start, dayEnd: today.end, total: windows('2026-06-20', 48, () => 20), steps: zeros('2026-06-20', 48), active: zeros('2026-06-20', 48), history: history(8), zone: 'Europe/Warsaw' })!;
  assert.equal(hot.floorKcal, 48 * 20 + 96 * 20);
  assert.equal(hot.forecastKcal, hot.floorKcal);
  assert.ok(Math.abs(hot.burnedKcal + hot.windowKcal.reduce((a, b) => a + b, 0) - hot.forecastKcal) < 1e-9);
});

test('v2: doby 23 i 25 godzin — godziny po zegarze ściennym, okno po oknie do końca doby', () => {
  assert.equal(clockSlot(day('2026-06-10').start), 0);
  assert.equal(clockSlot(day('2026-06-10').end - windowMs), 143);
  const autumn = day('2026-10-25');
  assert.deepEqual([autumn.count, clockSlot(autumn.start + 17 * windowMs), clockSlot(autumn.start + 18 * windowMs), clockSlot(autumn.start + 24 * windowMs)], [150, 17, 12, 18]);
  const spring = day('2026-03-29');
  assert.deepEqual([spring.count, clockSlot(spring.start + 11 * windowMs), clockSlot(spring.start + 12 * windowMs)], [138, 11, 18]);
  for (const date of ['2026-03-29', '2026-10-25']) {
    const today = day(date), done = 90;
    const result = forecastEnergy(input(date, done, history(8)))!;
    assert.equal(result.rule, profileRule);
    assert.deepEqual([result.remainingWindows, result.windowKcal.length], [today.count - done, today.count - done]);
    assert.equal(result.asOf, new Date(today.start + done * windowMs).toISOString());
  }
  // a history day that is itself a 23 hour day is complete with its 138 windows
  const withDst = [...history(7, '2026-03-20'), { windows: windows('2026-03-29', null, () => 10), dayWindows: 138, active: [] }];
  assert.equal(forecastEnergy(input('2026-03-30', 72, withDst))?.historyDays, 8);
});

test('prognoza z magazynu: okna codzienne z zapisanych okien ostatnich dób; bez historii v0', () => {
  const db = createDemoDatabase();
  try {
    db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE google_read_pages (job_id TEXT NOT NULL, page_number INTEGER NOT NULL, request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL);`);
    let id = 0;
    const save = (kind: string, date: string, points: object[]) => {
      db.prepare("INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, NULL, 'complete', ?)").run(`j${id}`, 'a'.repeat(64), kind, warsawDay(date).start, warsawDay(date).end, '2026-06-30T00:00:00.000Z');
      db.prepare("INSERT INTO google_read_pages VALUES (?, 1, NULL, NULL, ?, 'd', 'x')").run(`j${id++}`, JSON.stringify({ rollupDataPoints: points }));
    };
    const point = (date: string, index: number, field: object) => ({ startTime: new Date(day(date).start + index * windowMs).toISOString(), endTime: new Date(day(date).start + (index + 1) * windowMs).toISOString(), ...field });
    const date = '2026-06-20', noon = day(date).start + 12 * 3600000;
    save('total-calories-10m', date, Array.from({ length: 72 }, (_, index) => point(date, index, { totalCalories: { kcalSum: 10 } })));
    save('steps-10m', date, []); save('active-energy-10m', date, []);
    assert.equal(readEnergyForecast(db, date, noon)?.rule, forecastRule);
    for (let k = 1; k <= 8; k++) {
      const past = next(date, -k);
      save('total-calories-10m', past, Array.from({ length: 144 }, (_, index) => point(past, index, { totalCalories: { kcalSum: total(index) } })));
      if (k > 1) save('active-energy-10m', past, Array.from({ length: 144 }, (_, index) => active(index) ? point(past, index, { activeEnergyBurned: { kcalSum: active(index) } }) : null).filter((item) => item !== null));
    }
    // the day before yesterday… eight days back: seven have an active read, the newest one has not and is skipped
    const result = readEnergyForecast(db, date, noon);
    assert.ok(result);
    assert.deepEqual([result.rule, result.historyDays, result.remainingWindows, result.windowKcal.length], [profileRule, 7, 72, 72]);
    assert.equal(result.floorKcal, 1440);
    // the workout hour (slots 100–103) is at the everyday pace, the waking hour at 14
    assert.deepEqual([result.windowKcal[28], result.windowKcal[0]], [10, 10]);
    assert.equal(readEnergyForecast(db, date, noon + 86400000), null);
  } finally { db.close(); }
});
