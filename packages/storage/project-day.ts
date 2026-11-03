import type { DatabaseSync } from 'node:sqlite';
import { projectDay, type DayEvidence } from '../domain/project-day.ts';
import { publishCanonicalDay } from './canonical-days.ts';

/** Publication requires explicit, already resolved source and identity evidence. */
export function publishDayEvidence(db: DatabaseSync, evidence: DayEvidence, expectedRevision: number | null) {
  return publishCanonicalDay(db, projectDay(evidence), expectedRevision);
}
