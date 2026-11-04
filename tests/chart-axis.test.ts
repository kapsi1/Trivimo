import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitAxis } from '../apps/web/src/format.ts';

test('oś dopasowana do danych: górna linia tuż nad maksimum albo pod nim z marginesem na słupki', () => {
  // maximum 171: the 175 line just above the data is the top, no empty band up to 200
  assert.deepEqual(fitAxis(57, 171, 5), { ticks: [50, 75, 100, 125, 150, 175], lo: 50, hi: 175 });
  // maximum 212: the top line stays at 200 and the range extends just enough to fit 212
  const wide = fitAxis(52, 212, 5);
  assert.deepEqual(wide.ticks, [50, 100, 150, 200]);
  assert.ok(wide.hi >= 212 && wide.hi < 225);
  // every value is inside the plotted range
  for (const [min, max] of [[61, 97], [40, 188], [70, 70]] as const) { const axis = fitAxis(min, max, 3); assert.ok(axis.lo <= min && axis.hi >= max); }
});
