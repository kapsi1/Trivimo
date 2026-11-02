import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyMean } from '../packages/domain/daily-mean.ts';

test('średnia używa unikalnych pomiarów i nie zależy od kolejności ani powtórzenia', () => {
  const first = { identity: 'a', value: 70 };
  const second = { identity: 'b', value: 72 };
  assert.deepEqual(dailyMean([first, second]), { status: 'valid', value: 71, count: 2 });
  assert.deepEqual(dailyMean([second, first, first]), dailyMean([first, second]));
});

test('brak i zaakceptowane zero pozostają odrębne', () => {
  assert.deepEqual(dailyMean([]), { status: 'missing', value: null, count: 0 });
  assert.deepEqual(dailyMean([{ identity: 'a', value: 0 }]), { status: 'valid', value: 0, count: 1 });
});

test('sprzeczna tożsamość i nieprawidłowe wartości są odrzucane', () => {
  assert.throws(() => dailyMean([{ identity: 'a', value: 1 }, { identity: 'a', value: 2 }]));
  assert.throws(() => dailyMean([{ identity: '', value: 1 }]));
  assert.throws(() => dailyMean([{ identity: 'a', value: NaN }]));
});
