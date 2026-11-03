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

/** Build a snapshot only from already assigned days and explicit source/identity decisions. */
export function projectDay(evidence: DayEvidence): DaySnapshotInput {
  if (evidence.totalEnergy.kind !== 'total' || evidence.activeEnergy.kind !== 'active' || evidence.steps.kind !== 'steps' || evidence.distance.kind !== 'distance') throw new Error('Nieprawidłowy typ metryki');
  const weight = projectBodyDay('weight', evidence.weight.candidates, evidence.weight.evaluationComplete);
  const bodyFat = projectBodyDay('body_fat', evidence.bodyFat.candidates, evidence.bodyFat.evaluationComplete);
  const issues: DataIssue[] = [...weight.issues, ...bodyFat.issues];
  const qualified = (metric: Extract<Metric, 'steps' | 'distance' | 'total_energy' | 'active_energy'>, assessment: ReturnType<typeof assessEnergy> | ReturnType<typeof assessActivity>): DayMetricValue => {
    if (assessment.reason && assessment.reason !== 'missing_value') {
      const code: IssueCode = assessment.reason === 'basal_only' ? 'basal_only'
        : assessment.reason === 'unknown_origin' ? 'unknown_origin'
          : ['partial_coverage', 'unknown_coverage', 'unconfirmed_zero', 'ongoing_day'].includes(assessment.reason) ? 'incomplete_coverage'
            : assessment.reason === 'invalid_value' ? 'invalid_value' : assessment.reason === 'unknown_unit' ? 'unknown_unit'
              : ['unknown_boundary', 'different_day_boundary'].includes(assessment.reason) ? 'incomparable_day'
                : assessment.reason === 'unresolved_overlap' ? 'unresolved_overlap' : 'incomparable_source';
      issues.push({ metric, code, state: 'active' });
    }
    if (assessment.value === null) return { status: assessment.status, value: null };
    const exact = dailyMean([{ identity: 'qualified-value', value: assessment.value }]);
    if (exact.status !== 'valid') throw new Error('Nieprawidłowa wartość metryki');
    return { status: assessment.status, value: exact.value };
  };
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
