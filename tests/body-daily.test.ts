import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectBodyDay, type BodyCandidate } from '../packages/domain/body-daily.ts';

test('średnia dnia obejmuje tylko zaakceptowane unikalne pomiary', () => {
  const a: BodyCandidate = { identity: 'a', value: '70.25', decision: 'accepted' };
  const b: BodyCandidate = { identity: 'b', value: '71.75', decision: 'accepted' };
  const excluded: BodyCandidate = { identity: 'c', value: '88', decision: 'excluded' };
  assert.deepEqual(projectBodyDay('weight', [a, b, a, excluded], true), { status: 'valid', value: { numerator: '71', denominator: '1' }, count: 2, unit: 'kg', issues: [], notes: [] });
});

test('brak, niepełna ocena i nierozstrzygnięta tożsamość nie są zerem', () => {
  assert.equal(projectBodyDay('body_fat', [], true).status, 'missing');
  const pending: BodyCandidate = { identity: 'a', value: '17', decision: 'pending' };
  const conflict = projectBodyDay('body_fat', [pending], true);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.value, null);
  assert.deepEqual(conflict.notes, ['Tkanka tłuszczowa: niejednoznaczne pomiary']);
  assert.equal(projectBodyDay('body_fat', [], false).status, 'incomplete');
});

test('sprzeczne wersje tej samej tożsamości nie są uśredniane', () => {
  const candidates: BodyCandidate[] = [{ identity: 'a', value: '70', decision: 'accepted' }, { identity: 'a', value: '71', decision: 'accepted' }];
  const result = projectBodyDay('weight', candidates, true);
  assert.equal(result.status, 'conflict');
  assert.equal(result.value, null);
  assert.deepEqual(result.notes, ['Masa ciała: niejednoznaczne pomiary']);
  assert.deepEqual(projectBodyDay('weight', [{ identity: 'a', value: 'invalid', decision: 'accepted' }], true).notes, ['Masa ciała: nieprawidłowa wartość']);
});
