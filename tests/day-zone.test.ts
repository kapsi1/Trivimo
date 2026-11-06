import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayBounds, dayOfInstant, defaultDayZone, isDayZone, minutesOfDay, requireDayZone } from '../packages/domain/day-zone.ts';

const hours = (zone: string, date: string) => { const bounds = dayBounds(date, zone); return (Date.parse(bounds.end) - Date.parse(bounds.start)) / 3600000; };

test('doba Europe/Warsaw respektuje przejścia DST i przedział półotwarty', () => {
  assert.equal(defaultDayZone, 'Europe/Warsaw');
  assert.deepEqual(dayBounds('2026-03-29', 'Europe/Warsaw'), { start: '2026-03-28T23:00:00.000Z', end: '2026-03-29T22:00:00.000Z' });
  assert.deepEqual(dayBounds('2026-10-25', 'Europe/Warsaw'), { start: '2026-10-24T22:00:00.000Z', end: '2026-10-25T23:00:00.000Z' });
  assert.equal(dayBounds('2026-03-29', 'Europe/Warsaw').end, dayBounds('2026-03-30', 'Europe/Warsaw').start);
  assert.equal(dayBounds('2026-10-25', 'Europe/Warsaw').end, dayBounds('2026-10-26', 'Europe/Warsaw').start);
});

test('strefy bez DST i z przesunięciem połówkowym', () => {
  assert.deepEqual(dayBounds('2026-03-29', 'UTC'), { start: '2026-03-29T00:00:00.000Z', end: '2026-03-30T00:00:00.000Z' });
  assert.deepEqual(dayBounds('2026-06-10', 'Asia/Kolkata'), { start: '2026-06-09T18:30:00.000Z', end: '2026-06-10T18:30:00.000Z' });
  assert.equal(hours('Asia/Kolkata', '2026-03-29'), 24);
  assert.equal(hours('Asia/Kathmandu', '2026-06-10'), 24);
});

test('doba 23 i 25 godzin na obu półkulach', () => {
  assert.deepEqual(dayBounds('2026-03-08', 'America/New_York'), { start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' });
  assert.equal(hours('America/New_York', '2026-03-08'), 23);
  assert.equal(hours('America/New_York', '2026-11-01'), 25);
  assert.equal(hours('Australia/Sydney', '2026-04-05'), 25); // koniec DST na południu
  assert.equal(hours('Australia/Sydney', '2026-10-04'), 23); // początek DST na południu
  assert.deepEqual(dayBounds('2026-10-04', 'Australia/Sydney'), { start: '2026-10-03T14:00:00.000Z', end: '2026-10-04T13:00:00.000Z' });
  for (const zone of ['Europe/Warsaw', 'America/New_York', 'Australia/Sydney', 'Pacific/Auckland']) {
    for (let day = Date.parse('2026-01-01T00:00:00Z'); day < Date.parse('2027-01-01T00:00:00Z'); day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10), next = new Date(day + 86400000).toISOString().slice(0, 10);
      assert.equal(dayBounds(date, zone).end, dayBounds(next, zone).start, `${zone} ${date}: doby przylegają bez luk i zakładek`);
    }
  }
});

test('północ, która nie istnieje albo powtarza się, nie psuje granic doby', () => {
  // Kuba przesuwa zegar o północy: 2026-03-08 zaczyna się o 01:00 (doba 23 h), 2026-11-01 ma powtórzoną godzinę (25 h)
  assert.deepEqual(dayBounds('2026-03-08', 'America/Havana'), { start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' });
  assert.equal(hours('America/Havana', '2026-11-01'), 25);
  assert.equal(dayBounds('2026-03-07', 'America/Havana').end, dayBounds('2026-03-08', 'America/Havana').start);
  assert.equal(dayBounds('2026-11-01', 'America/Havana').end, dayBounds('2026-11-02', 'America/Havana').start);
});

test('przypisanie chwili do doby zależy od strefy', () => {
  const instant = Date.parse('2026-06-10T22:30:00Z');
  assert.equal(dayOfInstant(instant, 'Europe/Warsaw'), '2026-06-11');
  assert.equal(dayOfInstant(instant, 'UTC'), '2026-06-10');
  assert.equal(dayOfInstant(instant, 'America/New_York'), '2026-06-10');
  assert.equal(dayOfInstant(instant, 'Asia/Kolkata'), '2026-06-11');
  assert.equal(minutesOfDay(instant, 'Asia/Kolkata'), 4 * 60);
  assert.equal(minutesOfDay(Date.parse(dayBounds('2026-03-29', 'Europe/Warsaw').end) - 1, 'Europe/Warsaw'), 23 * 60 + 59);
});

test('sprawdza strefę, datę i zakres przed użyciem bazy stref', () => {
  assert.equal(isDayZone('Europe/Warsaw'), true);
  assert.equal(isDayZone('UTC'), true);
  for (const bad of ['', 'Mars/Base', '+02:00', 'Poland', 'europe/warsaw', 5, null, 'x'.repeat(100)]) assert.equal(isDayZone(bad), false, String(bad));
  assert.throws(() => requireDayZone('Mars/Base'));
  assert.throws(() => dayBounds('2026-03-29', 'Mars/Base'));
  assert.throws(() => dayBounds('2026-02-29', 'Europe/Warsaw'));
  assert.throws(() => dayBounds('1999-12-31', 'Europe/Warsaw'));
  assert.deepEqual(dayBounds('2025-12-31', 'Europe/Warsaw'), { start: '2025-12-30T23:00:00.000Z', end: '2025-12-31T23:00:00.000Z' });
  assert.throws(() => dayBounds('2026-13-01', 'Europe/Warsaw'));
  assert.equal(dayBounds('2028-02-29', 'Europe/Warsaw').end, dayBounds('2028-03-01', 'Europe/Warsaw').start);
});
