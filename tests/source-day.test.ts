import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceDay } from '../packages/domain/source-day.ts';

test('przypisuje czas do dnia warszawskiego, także przy zmianach czasu i offsetach', () => {
  assert.equal(sourceDay('2026-03-28T22:59:59.999999Z'), '2026-03-28');
  assert.equal(sourceDay('2026-03-28T23:00:00Z'), '2026-03-29');
  assert.equal(sourceDay('2026-03-29T22:00:00Z'), '2026-03-30');
  assert.equal(sourceDay('2026-10-24T22:00:00Z'), '2026-10-25');
  assert.equal(sourceDay('2026-10-25T22:59:59Z'), '2026-10-25');
  assert.equal(sourceDay('2026-10-25T23:00:00Z'), '2026-10-26');
  assert.equal(sourceDay('2026-01-01T00:30:00+03:00'), '2025-12-31');
});

test('odrzuca czas bez strefy oraz niepoprawne daty', () => {
  assert.throws(() => sourceDay('2026-01-01T12:00:00'));
  assert.throws(() => sourceDay('2026-02-30T12:00:00Z'));
});
