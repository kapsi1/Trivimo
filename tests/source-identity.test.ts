import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceIdentity, type SourceIdentityInput } from '../packages/domain/source-identity.ts';

const source: SourceIdentityInput = { provider: 'provider', account: 'local-account', type: 'weight', originalId: null, timestamp: '2026-01-01T00:00:00.123456Z', origin: 'scale' };

test('źródłowe ID jest zakresowane dostawcą, kontem i typem', () => {
  const identified = sourceIdentity({ ...source, originalId: 'record' });
  assert.equal(identified.status, 'identified');
  assert.notDeepEqual(identified, sourceIdentity({ ...source, account: 'another', originalId: 'record' }));
  assert.notDeepEqual(identified, sourceIdentity({ ...source, type: 'body_fat', originalId: 'record' }));
});

test('klucz z czasu i pochodzenia jest kandydatem, nie potwierdzeniem repliki', () => {
  const candidate = sourceIdentity(source);
  assert.equal(candidate.status, 'candidate');
  assert.notDeepEqual(candidate, sourceIdentity({ ...source, timestamp: '2026-01-01T00:00:00.123457Z' }));
  assert.notDeepEqual(candidate, sourceIdentity({ ...source, origin: 'other' }));
  assert.equal(sourceIdentity({ ...source, timestamp: null }).status, 'unresolved');
  assert.equal(sourceIdentity({ ...source, origin: null }).status, 'unresolved');
  assert.equal(sourceIdentity({ ...source, account: '' }).status, 'unresolved');
});
