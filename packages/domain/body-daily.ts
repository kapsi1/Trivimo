import { dailyMean, DailyMeanError } from './daily-mean.ts';
import { projectIssueNotes, type DataIssue } from './data-issues.ts';

export interface BodyCandidate {
  identity: string;
  value: string;
  decision: 'accepted' | 'pending' | 'excluded';
}

export type BodyProjection = {
  status: 'valid' | 'missing' | 'incomplete' | 'conflict';
  value: { numerator: string; denominator: string } | null;
  count: number;
  unit: 'kg' | '%';
  issues: DataIssue[];
  notes: string[];
};

/** Input decisions and day assignment are made upstream; this function never guesses identities. */
export function projectBodyDay(metric: 'weight' | 'body_fat', candidates: readonly BodyCandidate[], evaluationComplete: boolean): BodyProjection {
  const unit = metric === 'weight' ? 'kg' : '%';
  const result = (status: BodyProjection['status'], value: BodyProjection['value'], count: number, issues: DataIssue[]): BodyProjection => ({ status, value, count, unit, issues, notes: projectIssueNotes(issues) });
  if (!evaluationComplete) return result('incomplete', null, 0, [{ metric, code: 'incomplete_coverage', state: 'active' }]);
  if (candidates.some((candidate) => candidate.decision === 'pending')) return result('conflict', null, 0, [{ metric, code: 'identity_conflict', state: 'active' }]);
  const accepted = candidates.filter((candidate) => candidate.decision === 'accepted');
  if (!accepted.length) return result('missing', null, 0, []);
  try {
    const mean = dailyMean(accepted);
    if (mean.status === 'missing') return result('missing', null, 0, []);
    return result('valid', mean.value, mean.count, []);
  } catch (error) {
    if (!(error instanceof DailyMeanError)) throw error;
    return result('conflict', null, 0, [{ metric, code: error.code, state: 'active' }]);
  }
}
