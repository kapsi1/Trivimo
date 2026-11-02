import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyMean } from '../packages/domain/daily-mean.ts';

test('średnia używa unikalnych pomiarów i nie zależy od kolejności ani powtórzenia', () => {
  const first = { identity: 'a', value: '70' };
  const second = { identity: 'b', value: '72' };
  assert.deepEqual(dailyMean([first, second]), { status: 'valid', value: { numerator: '71', denominator: '1' }, count: 2 });
  assert.deepEqual(dailyMean([second, first, first]), dailyMean([first, second]));
});

test('brak i zaakceptowane zero pozostają odrębne', () => {
  assert.deepEqual(dailyMean([]), { status: 'missing', value: null, count: 0 });
  assert.deepEqual(dailyMean([{ identity: 'a', value: '0' }]), { status: 'valid', value: { numerator: '0', denominator: '1' }, count: 1 });
});

test('sprzeczna tożsamość i nieprawidłowe wartości są odrzucane', () => {
  assert.throws(() => dailyMean([{ identity: 'a', value: '1' }, { identity: 'a', value: '2' }]));
  assert.throws(() => dailyMean([{ identity: '', value: '1' }]));
  assert.throws(() => dailyMean([{ identity: 'a', value: 'NaN' }]));
});

test('zachowuje dokładne ułamki i liczby poza precyzją typu number', () => {
  assert.deepEqual(dailyMean([{ identity: 'a', value: '0' }, { identity: 'b', value: '0' }, { identity: 'c', value: '1' }]), { status: 'valid', value: { numerator: '1', denominator: '3' }, count: 3 });
  assert.deepEqual(dailyMean([{ identity: 'a', value: '9007199254740993' }, { identity: 'b', value: '9007199254740994' }]), { status: 'valid', value: { numerator: '18014398509481987', denominator: '2' }, count: 2 });
  assert.deepEqual(dailyMean([{ identity: 'a', value: '1.0' }, { identity: 'a', value: '1.00' }]), { status: 'valid', value: { numerator: '1', denominator: '1' }, count: 1 });
});
