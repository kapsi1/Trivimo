import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDailyRows } from '../apps/web/src/sort-days.ts';
import type { DaySnapshotInput } from '../packages/contracts/day-snapshot.ts';

const missing = { status: 'missing' as const, value: null };
function row(date: string, numerator: string | null, denominator = '1') {
  const metrics: DaySnapshotInput['metrics'] = { weight: numerator === null ? missing : { status: 'valid', value: { numerator, denominator } }, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing };
  return { date, snapshot: { date, metrics, issues: [], revision: 1, notes: [] } };
}
test('sortowanie metryk porównuje dokładne wartości, a braki pozostają na końcu', () => {
  const rows = [row('2026-01-04', null), row('2026-01-03', '9007199254740993'), row('2026-01-02', '9007199254740992'), row('2026-01-01', '0')];
  assert.deepEqual([...rows].sort((a, b) => compareDailyRows(a, b, 'weight', false)).map((x) => x.date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  assert.deepEqual([...rows].sort((a, b) => compareDailyRows(a, b, 'weight', true)).map((x) => x.date), ['2026-01-03', '2026-01-02', '2026-01-01', '2026-01-04']);
  assert.ok(compareDailyRows(row('2026-01-01', '1', '3'), row('2026-01-02', '2', '5'), 'weight', false) < 0);
  assert.ok(compareDailyRows(rows[0]!, rows[1]!, 'date', true) < 0);
});
