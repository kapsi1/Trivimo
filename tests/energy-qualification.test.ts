import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessEnergy, type EnergyEvidence } from '../packages/domain/energy-qualification.ts';

const complete: EnergyEvidence = { kind: 'total', value: '1800.00', definition: 'total_including_basal', unit: 'kcal', origin: 'wearable', coverage: 'confirmed', day: 'complete', zeroConfirmed: false };

test('nie przyjmuje BMR, telefonu, nieznanego pochodzenia ani innej definicji', () => {
  assert.equal(assessEnergy({ ...complete, definition: 'basal_only' }).reason, 'basal_only');
  assert.equal(assessEnergy({ ...complete, origin: 'phone' }).reason, 'phone_model');
  assert.equal(assessEnergy({ ...complete, origin: 'unknown' }).reason, 'unknown_origin');
  assert.equal(assessEnergy({ ...complete, kind: 'active' }).reason, 'different_or_unknown_definition');
});

test('zachowuje brak, niepotwierdzone zero i ograniczenia pełności', () => {
  assert.deepEqual(assessEnergy({ ...complete, value: null }), { status: 'missing', value: null, reason: 'missing_value' });
  assert.equal(assessEnergy({ ...complete, value: '0' }).reason, 'unconfirmed_zero');
  assert.deepEqual(assessEnergy({ ...complete, value: '0.00', zeroConfirmed: true }), { status: 'valid', value: '0.00', reason: null });
  assert.equal(assessEnergy({ ...complete, coverage: 'unknown' }).status, 'incomplete');
  assert.equal(assessEnergy({ ...complete, coverage: 'partial' }).reason, 'partial_coverage');
  assert.deepEqual(assessEnergy({ ...complete, coverage: 'partial', day: 'ongoing' }), { status: 'provisional', value: '1800.00', reason: 'ongoing_day' });
});

test('dla active wymaga właściwej definicji i znanej jednostki', () => {
  assert.equal(assessEnergy({ ...complete, kind: 'active', definition: 'active_above_basal' }).status, 'valid');
  assert.equal(assessEnergy({ ...complete, unit: 'unknown' }).reason, 'unknown_unit');
  assert.equal(assessEnergy({ ...complete, value: '-1' }).reason, 'invalid_value');
});
