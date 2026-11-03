import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDailyRollups } from '../packages/adapters/google-health/rollup-plan.ts';

test('plan kaloryczny dzieli półotwarty zakres bez luk na okresy do 14 dni', () => {
  assert.deepEqual(planDailyRollups('total-calories', '2026-03-20', '2026-04-20'), [
    { start: '2026-03-20', end: '2026-04-03' }, { start: '2026-04-03', end: '2026-04-17' }, { start: '2026-04-17', end: '2026-04-20' },
  ]);
});
test('plan pozostałych agregatów zachowuje limit i odrzuca nieprawidłowy zakres', () => {
  assert.deepEqual(planDailyRollups('steps', '2026-01-01', '2026-04-02'), [{ start: '2026-01-01', end: '2026-04-01' }, { start: '2026-04-01', end: '2026-04-02' }]);
  assert.throws(() => planDailyRollups('steps', '2026-02-30', '2026-03-02'));
  assert.throws(() => planDailyRollups('steps', '2026-01-01', '2026-01-01'));
});
