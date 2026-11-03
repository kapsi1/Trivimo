import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessEnergy, classifyEnergyModel, type EnergyEvidence } from '../packages/domain/energy-qualification.ts';

const complete: EnergyEvidence = { kind: 'total', value: '1800.00', definition: 'total_including_basal', unit: 'kcal', origin: 'wearable', coverage: 'confirmed', day: 'complete', zeroConfirmed: false };

test('nie przyjmuje BMR, nieznanego pochodzenia ani innej definicji; telefon i źródło mieszane są dopuszczone z oznaczeniem', () => {
  assert.equal(assessEnergy({ ...complete, definition: 'basal_only' }).reason, 'basal_only');
  assert.deepEqual(assessEnergy({ ...complete, origin: 'phone' }), { status: 'valid', value: '1800.00', reason: null });
  assert.deepEqual(assessEnergy({ ...complete, origin: 'mixed' }), { status: 'valid', value: '1800.00', reason: null });
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
  assert.deepEqual(assessEnergy({ ...complete, day: 'read_before_end' }), { status: 'provisional', value: '1800.00', reason: 'read_before_day_end' });
});

test('dla active wymaga właściwej definicji i znanej jednostki', () => {
  assert.equal(assessEnergy({ ...complete, kind: 'active', definition: 'active_above_basal' }).status, 'valid');
  assert.equal(assessEnergy({ ...complete, unit: 'unknown' }).reason, 'unknown_unit');
  assert.equal(assessEnergy({ ...complete, value: '-1' }).reason, 'invalid_value');
});

test('starszy model daje wartość bez uwagi; model zostaje w dowodach snapshotu', () => {
  assert.deepEqual(assessEnergy({ ...complete, model: 'legacy' }), { status: 'valid', value: '1800.00', reason: null });
  assert.equal(assessEnergy({ ...complete, model: 'legacy', day: 'ongoing' }).reason, 'ongoing_day');
});

test('model doby: stała stawka to sam BMR, aktywne kcal to pełny model, kilka długich przedziałów to starszy model', () => {
  // shape seen on basal-only days: one constant rate, a third of the windows near-zero noise, a partial last window
  const flat = [...Array.from({ length: 95 }, () => '15.625'), ...Array.from({ length: 47 }, () => '0.0000172'), '15.4'];
  assert.equal(classifyEnergyModel({ windowValues: flat.map((value) => value === '0.0000172' ? '0' : value), dayWindows: 144, active: 'absent' }), 'basal_only');
  assert.equal(classifyEnergyModel({ windowValues: flat, dayWindows: 144, active: 'absent' }), 'basal_only');
  assert.equal(classifyEnergyModel({ windowValues: flat, dayWindows: 144, active: 'zero' }), 'basal_only');
  // a few windows of activity above the basal rate do not make it a full day
  assert.equal(classifyEnergyModel({ windowValues: [...flat.slice(0, 140), '30', '25', '18'], dayWindows: 144, active: 'absent' }), 'basal_only');
  // a quiet phone day with some active energy is a real total, even if most windows carry only the basal rate
  assert.equal(classifyEnergyModel({ windowValues: [...flat.slice(0, 140), '30', '25', '18'], dayWindows: 144, active: 'positive' }), 'current');
  const varied = Array.from({ length: 144 }, (_, index) => String(10 + (index % 17)));
  assert.equal(classifyEnergyModel({ windowValues: varied, dayWindows: 144, active: 'positive' }), 'current');
  assert.equal(classifyEnergyModel({ windowValues: varied, dayWindows: 144, active: 'absent' }), 'unknown');
  assert.equal(classifyEnergyModel({ windowValues: ['900', '400', '150', '700', '300'], dayWindows: 144, active: 'absent' }), 'legacy');
  assert.equal(classifyEnergyModel({ windowValues: [], dayWindows: 144, active: 'absent' }), 'legacy');
  // the day of the autumn change has 150 windows; a sparse current day stays current
  assert.equal(classifyEnergyModel({ windowValues: varied.slice(0, 60), dayWindows: 150, active: 'positive' }), 'current');
});
