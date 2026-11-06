import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceDay } from '../packages/domain/source-day.ts';

test('przypisuje czas do doby strefy, także przy zmianach czasu i offsetach', () => {
  assert.equal(sourceDay('2026-03-28T22:59:59.999999Z', 'Europe/Warsaw'), '2026-03-28');
  assert.equal(sourceDay('2026-03-28T23:00:00Z', 'Europe/Warsaw'), '2026-03-29');
  assert.equal(sourceDay('2026-03-29T22:00:00Z', 'Europe/Warsaw'), '2026-03-30');
  assert.equal(sourceDay('2026-10-24T22:00:00Z', 'Europe/Warsaw'), '2026-10-25');
  assert.equal(sourceDay('2026-10-25T22:59:59Z', 'Europe/Warsaw'), '2026-10-25');
  assert.equal(sourceDay('2026-10-25T23:00:00Z', 'Europe/Warsaw'), '2026-10-26');
  assert.equal(sourceDay('2026-01-01T00:30:00+03:00', 'Europe/Warsaw'), '2025-12-31');
  assert.equal(sourceDay('2026-01-01T00:30:00+03:00', 'UTC'), '2025-12-31');
  assert.equal(sourceDay('2026-01-01T23:30:00-05:00', 'Asia/Kolkata'), '2026-01-02');
});

test('odrzuca czas bez strefy oraz niepoprawne daty i strefy', () => {
  assert.throws(() => sourceDay('2026-01-01T12:00:00', 'Europe/Warsaw'));
  assert.throws(() => sourceDay('2026-02-30T12:00:00Z', 'Europe/Warsaw'));
  assert.throws(() => sourceDay('2026-01-01T12:00:00Z', 'Mars/Base'));
});
