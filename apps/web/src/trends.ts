export type TrendMetric = 'weight' | 'body_fat' | 'steps' | 'distance' | 'total_energy' | 'active_energy';
type Value = { status: string; value: { numerator: string; denominator: string } | null };
export interface TrendDay { date: string; snapshot: { metrics: Record<TrendMetric, Value>; energy?: { model: string } } | null }
export interface TrendPoint { date: string; value: number | null; provisional: boolean; legacy: boolean }

/** Daily points of one metric; a day without a qualified value stays null (a gap), never 0. */
export function trendPoints(days: readonly TrendDay[], metric: TrendMetric): TrendPoint[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).map((day) => {
    const item = day.snapshot?.metrics[metric];
    const value = item?.value && (item.status === 'valid' || item.status === 'provisional') ? Number(item.value.numerator) / Number(item.value.denominator) : null;
    const energy = metric === 'total_energy' || metric === 'active_energy';
    return { date: day.date, value, provisional: item?.status === 'provisional', legacy: energy && day.snapshot?.energy?.model === 'legacy' };
  });
}

/**
 * Mean of confirmed days only (a day in progress is left out), with how many days had a value and how many are gaps.
 * Each day counts once, so weight and body fat average daily means, never summed percentages.
 */
export function trendSummary(points: readonly TrendPoint[]): { mean: number | null; valid: number; total: number; gaps: number } {
  const confirmed = points.filter((point) => point.value !== null && !point.provisional).map((point) => point.value!);
  return { mean: confirmed.length ? confirmed.reduce((sum, value) => sum + value, 0) / confirmed.length : null, valid: confirmed.length, total: points.length, gaps: points.filter((point) => point.value === null).length };
}

/** Newest day with a value, with its date: the last known measurement, not carried over as today's value. */
export function lastMeasurement(points: readonly TrendPoint[]): { date: string; value: number } | null {
  for (let index = points.length - 1; index >= 0; index--) { const point = points[index]!; if (point.value !== null) return { date: point.date, value: point.value }; }
  return null;
}

/** Runs of consecutive days with values; a line is drawn only within a run, so it never bridges a missing day. */
export function segments(points: readonly TrendPoint[]): number[][] {
  const runs: number[][] = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    const run = runs.at(-1);
    if (run && run.at(-1) === index - 1) run.push(index); else runs.push([index]);
  });
  return runs;
}
