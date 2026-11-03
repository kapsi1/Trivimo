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

/**
 * Snapshot with qualified calories only; the other metrics are not assessed from these sources yet, so they are
 * "unsupported" rather than missing or zero.
 */
export function projectEnergyDay(input: { date: string; totalEnergy: EnergyEvidence; activeEnergy: EnergyEvidence; energy: NonNullable<DaySnapshotInput['energy']> }): DaySnapshotInput {
  if (input.totalEnergy.kind !== 'total' || input.activeEnergy.kind !== 'active') throw new Error('Nieprawidłowy typ metryki');
  const issues: DataIssue[] = [];
  const unsupported: DayMetricValue = { status: 'unsupported', value: null };
  return snapshotInputSchema.parse({
    date: input.date,
    metrics: {
      weight: unsupported, body_fat: unsupported, steps: unsupported, distance: unsupported,
      total_energy: qualifiedMetric('total_energy', assessEnergy(input.totalEnergy), issues), active_energy: qualifiedMetric('active_energy', assessEnergy(input.activeEnergy), issues),
    },
    issues,
    energy: input.energy,
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
