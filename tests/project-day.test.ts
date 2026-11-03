import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDay, type DayEvidence } from '../packages/domain/project-day.ts';
import { projectIssueNotes } from '../packages/domain/data-issues.ts';

const input: DayEvidence = {
  date: '2026-01-01',
  weight: { evaluationComplete: true, candidates: [{ identity: 'one', value: '70.25', decision: 'accepted' }, { identity: 'two', value: '71.75', decision: 'accepted' }] },
  bodyFat: { evaluationComplete: false, candidates: [] },
  steps: { kind: 'steps', value: '0', unit: 'count', reconciliation: 'confirmed', sourceFamily: 'resolved', dayBoundary: 'warsaw_interval', coverage: 'confirmed', day: 'complete', zeroConfirmed: true },
  distance: { kind: 'distance', value: null, unit: 'unknown', reconciliation: 'unresolved', sourceFamily: 'unknown', dayBoundary: 'unknown', coverage: 'unknown', day: 'complete', zeroConfirmed: false },
  totalEnergy: { kind: 'total', value: '1500', definition: 'basal_only', unit: 'kcal', origin: 'wearable', coverage: 'confirmed', day: 'complete', zeroConfirmed: false },
  activeEnergy: { kind: 'active', value: null, definition: 'unknown', unit: 'unknown', origin: 'unknown', coverage: 'unknown', day: 'complete', zeroConfirmed: false },
};

test('wynik dnia łączy jawne decyzje i powody bez zastępowania braków zerem', () => {
  const snapshot = projectDay(input);
  assert.deepEqual(snapshot.metrics.weight, { status: 'valid', value: { numerator: '71', denominator: '1' } });
  assert.deepEqual(snapshot.metrics.steps, { status: 'valid', value: { numerator: '0', denominator: '1' } });
  assert.deepEqual(snapshot.metrics.total_energy, { status: 'incomparable', value: null });
  assert.deepEqual(snapshot.metrics.active_energy, { status: 'missing', value: null });
  assert.deepEqual(projectIssueNotes(snapshot.issues), ['Tkanka tłuszczowa: niepełny zakres', 'Kalorie: tylko energia bazowa']);
});

test('brak uzgodnienia kroków i inna doba dystansu nie trafiają jako liczby do wyniku', () => {
  const result = projectDay({ ...input,
    steps: { ...input.steps, value: '100', reconciliation: 'unresolved' },
    distance: { ...input.distance, value: '1.5', unit: 'km', reconciliation: 'confirmed', sourceFamily: 'resolved', dayBoundary: 'producer_day_unmatched', coverage: 'confirmed' },
  });
  assert.deepEqual(result.metrics.steps, { status: 'incomparable', value: null });
  assert.deepEqual(result.metrics.distance, { status: 'incomparable', value: null });
  assert.ok(projectIssueNotes(result.issues).includes('Kroki: nieuzgodnione nakładanie danych'));
  assert.ok(projectIssueNotes(result.issues).includes('Dystans: inny lub nieustalony dzień źródła'));
});

test('powtórzenie i kolejność zaakceptowanych pomiarów nie zmieniają wyniku', () => {
  const weights = input.weight.candidates;
  assert.deepEqual(projectDay({ ...input, weight: { evaluationComplete: true, candidates: [weights[1]!, weights[0]!, weights[0]!] } }), projectDay(input));
});
