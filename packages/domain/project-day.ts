import { snapshotInputSchema, type DayMetricValue, type DaySnapshotInput } from '../contracts/day-snapshot.ts';
import { projectBodyDay, type BodyCandidate } from './body-daily.ts';
import { dailyMean } from './daily-mean.ts';
import { assessEnergy, type EnergyEvidence } from './energy-qualification.ts';
import { assessActivity, type ActivityEvidence } from './activity-qualification.ts';
import type { DataIssue, IssueCode, Metric } from './data-issues.ts';

export interface DayEvidence {
  date: string;
  weight: { candidates: BodyCandidate[]; evaluationComplete: boolean };
  bodyFat: { candidates: BodyCandidate[]; evaluationComplete: boolean };
  steps: ActivityEvidence;
  distance: ActivityEvidence;
  totalEnergy: EnergyEvidence;
  activeEnergy: EnergyEvidence;
}

type QualifiedMetric = Extract<Metric, 'steps' | 'distance' | 'total_energy' | 'active_energy'>;
type Assessment = ReturnType<typeof assessEnergy> | ReturnType<typeof assessActivity>;

/**
 * Snapshot value of one assessed metric; a reason other than a plain absence becomes an active issue. A day still in
 * progress is only provisional, without a note: the table marks the current day itself.
 */
function qualifiedMetric(metric: QualifiedMetric, assessment: Assessment, issues: DataIssue[]): DayMetricValue {
  if (assessment.reason && assessment.reason !== 'missing_value' && assessment.reason !== 'ongoing_day') {
    const code: IssueCode = assessment.reason === 'basal_only' ? 'basal_only'
      : assessment.reason === 'legacy_model' ? 'legacy_model'
        : assessment.reason === 'windows_mismatch' ? 'windows_mismatch'
        : assessment.reason === 'unknown_origin' ? 'unknown_origin'
          : ['partial_coverage', 'unknown_coverage', 'unconfirmed_zero', 'read_before_day_end'].includes(assessment.reason) ? 'incomplete_coverage'
            : assessment.reason === 'invalid_value' ? 'invalid_value' : assessment.reason === 'unknown_unit' ? 'unknown_unit'
              : ['unknown_boundary', 'different_day_boundary'].includes(assessment.reason) ? 'incomparable_day'
                : assessment.reason === 'unresolved_overlap' ? 'unresolved_overlap' : 'incomparable_source';
    issues.push({ metric, code, state: 'active' });
  }
  if (assessment.value === null) return { status: assessment.status, value: null };
  const exact = dailyMean([{ identity: 'qualified-value', value: assessment.value }]);
  if (exact.status !== 'valid') throw new Error('Nieprawidłowa wartość metryki');
  return { status: assessment.status, value: exact.value };
}

export interface BodyDayEvidence { candidates: BodyCandidate[] | null; day: 'complete' | 'ongoing' | 'read_before_end' }

/**
 * Daily mean of unique measurements; a day never read is missing. Like the other metrics, a day in progress is
 * provisional without a note and a past day read before its end is provisional with an incomplete-coverage note.
 */
function bodyMetric(metric: 'weight' | 'body_fat', evidence: BodyDayEvidence, issues: DataIssue[]): DayMetricValue {
  if (evidence.candidates === null) return { status: 'missing', value: null };
  const day = projectBodyDay(metric, evidence.candidates, true);
  issues.push(...day.issues);
  if (day.status !== 'valid' || evidence.day === 'complete') return { status: day.status, value: day.value };
  if (evidence.day === 'read_before_end') issues.push({ metric, code: 'incomplete_coverage', state: 'active' });
  return { status: 'provisional', value: day.value };
}

/** Snapshot of the six metrics qualified from Google data (weight, body fat, steps, distance and calories). */
export function projectGoogleDay(input: {
  date: string; weight: BodyDayEvidence; bodyFat: BodyDayEvidence; steps: ActivityEvidence; distance: ActivityEvidence; totalEnergy: EnergyEvidence; activeEnergy: EnergyEvidence;
  energy: NonNullable<DaySnapshotInput['energy']>; activity: NonNullable<DaySnapshotInput['activity']>; body: NonNullable<DaySnapshotInput['body']>;
}): DaySnapshotInput {
  if (input.totalEnergy.kind !== 'total' || input.activeEnergy.kind !== 'active' || input.steps.kind !== 'steps' || input.distance.kind !== 'distance') throw new Error('Nieprawidłowy typ metryki');
  const issues: DataIssue[] = [];
  return snapshotInputSchema.parse({
    date: input.date,
    metrics: {
      weight: bodyMetric('weight', input.weight, issues), body_fat: bodyMetric('body_fat', input.bodyFat, issues),
      steps: qualifiedMetric('steps', assessActivity(input.steps), issues), distance: qualifiedMetric('distance', assessActivity(input.distance), issues),
      total_energy: qualifiedMetric('total_energy', assessEnergy(input.totalEnergy), issues), active_energy: qualifiedMetric('active_energy', assessEnergy(input.activeEnergy), issues),
    },
    issues,
    energy: input.energy,
    activity: input.activity,
    body: input.body,
  });
}

/** Build a snapshot only from already assigned days and explicit source/identity decisions. */
export function projectDay(evidence: DayEvidence): DaySnapshotInput {
  if (evidence.totalEnergy.kind !== 'total' || evidence.activeEnergy.kind !== 'active' || evidence.steps.kind !== 'steps' || evidence.distance.kind !== 'distance') throw new Error('Nieprawidłowy typ metryki');
  const weight = projectBodyDay('weight', evidence.weight.candidates, evidence.weight.evaluationComplete);
  const bodyFat = projectBodyDay('body_fat', evidence.bodyFat.candidates, evidence.bodyFat.evaluationComplete);
  const issues: DataIssue[] = [...weight.issues, ...bodyFat.issues];
  const qualified = (metric: QualifiedMetric, assessment: Assessment) => qualifiedMetric(metric, assessment, issues);
  return snapshotInputSchema.parse({
    date: evidence.date,
    metrics: {
      weight: { status: weight.status, value: weight.value }, body_fat: { status: bodyFat.status, value: bodyFat.value },
      steps: qualified('steps', assessActivity(evidence.steps)), distance: qualified('distance', assessActivity(evidence.distance)),
      total_energy: qualified('total_energy', assessEnergy(evidence.totalEnergy)), active_energy: qualified('active_energy', assessEnergy(evidence.activeEnergy)),
    },
    issues,
  });
}
