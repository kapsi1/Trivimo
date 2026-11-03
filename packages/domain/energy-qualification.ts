export type EnergyKind = 'total' | 'active';
export type EnergyAssessment =
  | { status: 'valid' | 'provisional'; value: string; reason: string | null }
  | { status: 'missing' | 'incomplete' | 'incomparable'; value: null; reason: string };

export interface EnergyEvidence {
  kind: EnergyKind;
  value: string | null;
  definition: 'total_including_basal' | 'active_above_basal' | 'basal_only' | 'unknown';
  unit: 'kcal' | 'unknown';
  /** Whose estimate: since 2026-11-03 a phone or mixed estimate is comparable when marked (docs/decisions.md). */
  origin: 'wearable' | 'phone' | 'mixed' | 'unknown';
  coverage: 'confirmed' | 'partial' | 'unknown';
  /** `read_before_end`: the day has ended, but its newest read was made while it was still in progress. */
  day: 'complete' | 'ongoing' | 'read_before_end';
  zeroConfirmed: boolean;
  /**
   * Older producer representation (coarse intervals, no active component). Since 2026-11-03 it carries no note: the
   * model stays in the snapshot evidence (cell details) and the day's sources column shows who supplied it.
   */
  model?: 'legacy';
}

/** Evidence must be supplied by an adapter or an explicit decision, never inferred from HR alone. */
export function assessEnergy(evidence: EnergyEvidence): EnergyAssessment {
  if (evidence.value === null) return { status: 'missing', value: null, reason: 'missing_value' };
  if (!/^\d+(?:\.\d+)?$/.test(evidence.value) || evidence.value.length > 512) return { status: 'incomparable', value: null, reason: 'invalid_value' };
  const expected = evidence.kind === 'total' ? 'total_including_basal' : 'active_above_basal';
  if (evidence.definition !== expected) return { status: 'incomparable', value: null, reason: evidence.definition === 'basal_only' ? 'basal_only' : 'different_or_unknown_definition' };
  if (evidence.unit !== 'kcal') return { status: 'incomparable', value: null, reason: 'unknown_unit' };
  if (evidence.origin === 'unknown') return { status: 'incomparable', value: null, reason: 'unknown_origin' };
  if (!/[1-9]/.test(evidence.value) && !evidence.zeroConfirmed) return { status: 'incomplete', value: null, reason: 'unconfirmed_zero' };
  if (evidence.day === 'ongoing') return { status: 'provisional', value: evidence.value, reason: 'ongoing_day' };
  if (evidence.day === 'read_before_end') return { status: 'provisional', value: evidence.value, reason: 'read_before_day_end' };
  if (evidence.coverage !== 'confirmed') return { status: 'incomplete', value: null, reason: evidence.coverage === 'partial' ? 'partial_coverage' : 'unknown_coverage' };
  return { status: 'valid', value: evidence.value, reason: null };
}

export type EnergyModel = 'current' | 'legacy' | 'basal_only' | 'unknown';

/**
 * Producer model of one day from its ten-minute total-calorie windows (rule google-energy-v1, checked on 2026 data):
 * - basal only: no active energy above zero, windows cover nearly the whole day and the significant ones share one
 *   constant rate (at least 95% within 1% of their median); such days also hold windows of about a millionth of the
 *   rate, so windows under 1% of the day's largest window count as negligible;
 * - current: the producer reports active energy for the day;
 * - legacy: no active energy and the day is held in a few long intervals (under half of the windows);
 * - otherwise unknown. Equal daily sums alone prove nothing: a varied day can match the basal sum by chance, and a
 *   quiet phone day with some active energy is a real total even when most windows carry only the basal rate.
 */
export function classifyEnergyModel(input: { windowValues: readonly string[]; dayWindows: number; active: 'absent' | 'zero' | 'positive' }): EnergyModel {
  const values = input.windowValues.map(Number);
  const largest = Math.max(0, ...values);
  const nonZero = values.filter((value) => value > largest * 0.01).sort((a, b) => a - b);
  const median = nonZero[Math.floor(nonZero.length / 2)] ?? 0;
  const steady = nonZero.filter((value) => Math.abs(value - median) <= median * 0.01).length;
  if (input.active !== 'positive' && nonZero.length > 0 && input.windowValues.length >= input.dayWindows * 0.9 && steady >= nonZero.length * 0.95) return 'basal_only';
  if (input.active !== 'absent') return 'current';
  return input.windowValues.length < input.dayWindows * 0.5 ? 'legacy' : 'unknown';
}
