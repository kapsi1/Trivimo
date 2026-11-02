import assert from 'node:assert/strict';
import { test } from 'node:test';
import { warsawDay } from '../packages/domain/warsaw-day.ts';

test('dzień warszawski respektuje przejścia DST i przedział półotwarty', () => {
  assert.deepEqual(warsawDay('2026-03-29'), { start: '2026-03-28T23:00:00.000Z', end: '2026-03-29T22:00:00.000Z' });
  assert.deepEqual(warsawDay('2026-10-25'), { start: '2026-10-24T22:00:00.000Z', end: '2026-10-25T23:00:00.000Z' });
  assert.equal(warsawDay('2026-03-29').end, warsawDay('2026-03-30').start);
  assert.equal(warsawDay('2026-10-25').end, warsawDay('2026-10-26').start);
});

test('sprawdza datę i zakres przed użyciem bazy stref', () => {
  assert.throws(() => warsawDay('2026-02-29'));
  assert.throws(() => warsawDay('2025-12-31'));
  assert.throws(() => warsawDay('2026-13-01'));
  assert.equal(warsawDay('2028-02-29').end, warsawDay('2028-03-01').start);
});
