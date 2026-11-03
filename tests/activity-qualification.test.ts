import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessActivity, type ActivityEvidence } from '../packages/domain/activity-qualification.ts';

const steps: ActivityEvidence = { kind: 'steps', value: '100', unit: 'count', reconciliation: 'confirmed', sourceFamily: 'resolved', dayBoundary: 'warsaw_interval', coverage: 'confirmed', day: 'complete', zeroConfirmed: false };

test('nie uznaje surowej sumy, nieuzgodnionych źródeł ani innej doby', () => {
  assert.equal(assessActivity({ ...steps, reconciliation: 'unresolved' }).reason, 'unresolved_overlap');
  assert.equal(assessActivity({ ...steps, sourceFamily: 'mixed_unresolved' }).reason, 'unresolved_sources');
  assert.equal(assessActivity({ ...steps, dayBoundary: 'producer_day_unmatched' }).reason, 'different_day_boundary');
  assert.equal(assessActivity({ ...steps, dayBoundary: 'unknown' }).status, 'incomparable');
});

test('brak, potwierdzone zero i część dnia pozostają rozróżnione', () => {
  assert.equal(assessActivity({ ...steps, value: null }).status, 'missing');
  assert.equal(assessActivity({ ...steps, value: '0' }).reason, 'unconfirmed_zero');
  assert.deepEqual(assessActivity({ ...steps, value: '0', zeroConfirmed: true }), { status: 'valid', value: '0', reason: null });
  assert.equal(assessActivity({ ...steps, coverage: 'unknown' }).status, 'incomplete');
  assert.equal(assessActivity({ ...steps, day: 'ongoing', coverage: 'partial' }).status, 'provisional');
});

test('wymaga właściwej jednostki i całkowitej liczby kroków', () => {
  assert.equal(assessActivity({ ...steps, value: '1.5' }).reason, 'invalid_value');
  assert.equal(assessActivity({ ...steps, unit: 'km' }).reason, 'unknown_unit');
  assert.equal(assessActivity({ ...steps, kind: 'distance', unit: 'km', value: '1.250' }).status, 'valid');
});
