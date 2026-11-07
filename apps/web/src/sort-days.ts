import type { z } from 'zod';
import { daySnapshotSchema } from '../../../packages/contracts/day-snapshot.ts';
import { summaryNumber, type SummaryType } from './summary-number.ts';

type Metric = keyof z.infer<typeof daySnapshotSchema>['metrics'];
type Row = { date: string; snapshot: z.infer<typeof daySnapshotSchema> | null };
export type SortKey = 'date' | Metric | `summary:${SummaryType}`;

/** Compare exact rationals (summaries: their numbers), keep missing values last in either direction. Summary days with different points are missing here. */
export function compareDailyRows(a: Row, b: Row, sortBy: SortKey, descending: boolean): number {
  if (sortBy === 'date') return descending ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  if (sortBy.startsWith('summary:')) {
    const type = sortBy.slice('summary:'.length) as SummaryType, x = summaryNumber(a.snapshot, type), y = summaryNumber(b.snapshot, type);
    if (x === null || y === null) return x !== null ? -1 : y !== null ? 1 : a.date.localeCompare(b.date);
    return (descending ? y - x : x - y) || a.date.localeCompare(b.date);
  }
  const key = sortBy as Metric;
  const left = a.snapshot?.metrics[key].value, right = b.snapshot?.metrics[key].value;
  if (!left || !right) return left ? -1 : right ? 1 : a.date.localeCompare(b.date);
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  const order = difference < 0n ? -1 : difference > 0n ? 1 : 0;
  return (descending ? -order : order) || a.date.localeCompare(b.date);
}
