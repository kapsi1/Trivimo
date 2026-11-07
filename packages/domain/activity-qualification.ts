export interface ActivityEvidence {
  kind: 'steps' | 'distance';
  value: string | null;
  unit: 'count' | 'km' | 'unknown';
  reconciliation: 'confirmed' | 'unresolved';
  sourceFamily: 'resolved' | 'mixed_unresolved' | 'unknown';
  dayBoundary: 'zone_interval' | 'producer_day_unmatched' | 'unknown';
  coverage: 'confirmed' | 'partial' | 'unknown';
  /** `read_before_end`: the day has ended, but its newest read was made while it was still in progress. */
  day: 'complete' | 'ongoing' | 'read_before_end';
  zeroConfirmed: boolean;
  /** google-activity-v2: the day boundary is confirmed by the steps of the same day, but this metric's own windows do not sum to its daily value. */
  windowsDisagree?: boolean;
}

export type ActivityAssessment =
  | { status: 'valid' | 'provisional'; value: string; reason: string | null }
  | { status: 'missing' | 'incomplete' | 'incomparable'; value: null; reason: string };

/** Callers must supply actual reconciliation and coverage evidence; raw sums are not proof. */
export function assessActivity(evidence: ActivityEvidence): ActivityAssessment {
  if (evidence.value === null) return { status: 'missing', value: null, reason: 'missing_value' };
  if (evidence.value.length > 512 || !/^\d+(?:\.\d+)?$/.test(evidence.value)) return { status: 'incomparable', value: null, reason: 'invalid_value' };
  const fraction = evidence.value.split('.')[1] ?? '';
  if (evidence.kind === 'steps' && /[1-9]/.test(fraction)) return { status: 'incomparable', value: null, reason: 'invalid_value' };
  const expectedUnit = evidence.kind === 'steps' ? 'count' : 'km';
  if (evidence.unit !== expectedUnit) return { status: 'incomparable', value: null, reason: 'unknown_unit' };
  if (evidence.reconciliation !== 'confirmed') return { status: 'incomparable', value: null, reason: 'unresolved_overlap' };
  if (evidence.sourceFamily !== 'resolved') return { status: 'incomparable', value: null, reason: evidence.sourceFamily === 'unknown' ? 'unknown_origin' : 'unresolved_sources' };
  if (evidence.dayBoundary !== 'zone_interval') return { status: 'incomparable', value: null, reason: evidence.dayBoundary === 'unknown' ? 'unknown_boundary' : 'different_day_boundary' };
  if (!/[1-9]/.test(evidence.value) && !evidence.zeroConfirmed) return { status: 'incomplete', value: null, reason: 'unconfirmed_zero' };
  if (evidence.day === 'ongoing') return { status: 'provisional', value: evidence.value, reason: 'ongoing_day' };
  if (evidence.day === 'read_before_end') return { status: 'provisional', value: evidence.value, reason: 'read_before_day_end' };
  if (evidence.coverage !== 'confirmed') return { status: 'incomplete', value: null, reason: evidence.coverage === 'partial' ? 'partial_coverage' : 'unknown_coverage' };
  return { status: 'valid', value: evidence.value, reason: evidence.windowsDisagree ? 'windows_mismatch' : null };
}
