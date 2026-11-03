export type EnergyKind = 'total' | 'active';
export type EnergyAssessment =
  | { status: 'valid' | 'provisional'; value: string; reason: string | null }
  | { status: 'missing' | 'incomplete' | 'incomparable'; value: null; reason: string };

export interface EnergyEvidence {
  kind: EnergyKind;
  value: string | null;
  definition: 'total_including_basal' | 'active_above_basal' | 'basal_only' | 'unknown';
  unit: 'kcal' | 'unknown';
  origin: 'wearable' | 'phone' | 'unknown';
  coverage: 'confirmed' | 'partial' | 'unknown';
  day: 'complete' | 'ongoing';
  zeroConfirmed: boolean;
}

/** Evidence must be supplied by an adapter or an explicit decision, never inferred from HR alone. */
export function assessEnergy(evidence: EnergyEvidence): EnergyAssessment {
  if (evidence.value === null) return { status: 'missing', value: null, reason: 'missing_value' };
  if (!/^\d+(?:\.\d+)?$/.test(evidence.value) || evidence.value.length > 512) return { status: 'incomparable', value: null, reason: 'invalid_value' };
  const expected = evidence.kind === 'total' ? 'total_including_basal' : 'active_above_basal';
  if (evidence.definition !== expected) return { status: 'incomparable', value: null, reason: evidence.definition === 'basal_only' ? 'basal_only' : 'different_or_unknown_definition' };
  if (evidence.unit !== 'kcal') return { status: 'incomparable', value: null, reason: 'unknown_unit' };
  if (evidence.origin !== 'wearable') return { status: 'incomparable', value: null, reason: evidence.origin === 'phone' ? 'phone_model' : 'unknown_origin' };
  if (!/[1-9]/.test(evidence.value) && !evidence.zeroConfirmed) return { status: 'incomplete', value: null, reason: 'unconfirmed_zero' };
  if (evidence.day === 'ongoing') return { status: 'provisional', value: evidence.value, reason: 'ongoing_day' };
  if (evidence.coverage !== 'confirmed') return { status: 'incomplete', value: null, reason: evidence.coverage === 'partial' ? 'partial_coverage' : 'unknown_coverage' };
  return { status: 'valid', value: evidence.value, reason: null };
}
