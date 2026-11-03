import type { z } from 'zod';
import { daySnapshotSchema } from '../../../packages/contracts/day-snapshot.ts';

type Metric = keyof z.infer<typeof daySnapshotSchema>['metrics'];
type Row = { date: string; snapshot: z.infer<typeof daySnapshotSchema> | null };

/** Compare exact rationals, keep missing values last in either direction. */
export function compareDailyRows(a: Row, b: Row, sortBy: 'date' | Metric, descending: boolean): number {
  if (sortBy === 'date') return descending ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  const left = a.snapshot?.metrics[sortBy].value, right = b.snapshot?.metrics[sortBy].value;
  if (!left || !right) return left ? -1 : right ? 1 : a.date.localeCompare(b.date);
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  const order = difference < 0n ? -1 : difference > 0n ? 1 : 0;
  return (descending ? -order : order) || a.date.localeCompare(b.date);
}
