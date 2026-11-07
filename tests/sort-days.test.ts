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

type Item = { type: 'daily-resting-heart-rate'; status: 'value' | 'agreed' | 'conflict' | 'absent'; values?: Record<string, string>; candidates?: Record<string, string>[] };
function summaryRow(date: string, item: Item | null) {
  const base = row(date, null);
  return { date, snapshot: { ...base.snapshot, ...(item ? { summaries: { rule: 'google-daily-summaries-v2' as const, items: [item] } } : {}) } as typeof base.snapshot };
}
const value = (bpm: string): Item => ({ type: 'daily-resting-heart-rate', status: 'value', values: { beatsPerMinute: bpm } });
test('sortowanie podsumowań producenta: liczby, a doby z konfliktem, bez wartości i nieodczytane zostają na końcu w obu kierunkach', () => {
  const rows = [
    summaryRow('2026-01-05', { type: 'daily-resting-heart-rate', status: 'conflict', candidates: [{ beatsPerMinute: '50' }, { beatsPerMinute: '90' }] }),
    summaryRow('2026-01-04', { type: 'daily-resting-heart-rate', status: 'absent' }), summaryRow('2026-01-03', value('60')), summaryRow('2026-01-02', value('55')), summaryRow('2026-01-01', null),
  ];
  const order = (descending: boolean) => [...rows].sort((a, b) => compareDailyRows(a, b, 'summary:daily-resting-heart-rate', descending)).map((x) => x.date);
  assert.deepEqual(order(false), ['2026-01-02', '2026-01-03', '2026-01-01', '2026-01-04', '2026-01-05']);
  assert.deepEqual(order(true), ['2026-01-03', '2026-01-02', '2026-01-01', '2026-01-04', '2026-01-05']);
});
