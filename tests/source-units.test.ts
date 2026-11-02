import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSourceValue } from '../packages/domain/source-units.ts';

test('przelicza gramy i metry bez utraty cyfr lub przedwczesnego zaokrąglenia', () => {
  assert.deepEqual(parseSourceValue('weight', '72500.0123'), { status: 'parsed', value: '72.5000123', unit: 'kg' });
  assert.deepEqual(parseSourceValue('distance', '1'), { status: 'parsed', value: '0.001', unit: 'km' });
  assert.deepEqual(parseSourceValue('distance', '0'), { status: 'parsed', value: '0.000', unit: 'km' });
  assert.equal((parseSourceValue('distance', '9007199254740993') as { value: string }).value, '9007199254740.993');
});

test('odróżnia niepoprawne wartości i niepotwierdzoną jednostkę od zera', () => {
  assert.deepEqual(parseSourceValue('steps', '0'), { status: 'parsed', value: '0', unit: 'szt.' });
  assert.equal(parseSourceValue('steps', '1.5').status, 'invalid');
  assert.equal(parseSourceValue('body_fat', '100.01').status, 'invalid');
  assert.equal(parseSourceValue('weight', '0').status, 'invalid');
  assert.equal(parseSourceValue('weight', 'NaN').status, 'invalid');
  assert.equal(parseSourceValue('total_energy', '100').status, 'unsupported');
  assert.deepEqual(parseSourceValue('active_energy', '0.00'), { status: 'parsed', value: '0.00', unit: 'kcal' });
});
