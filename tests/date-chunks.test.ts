import assert from 'node:assert/strict';
import test from 'node:test';
import { dateChunks } from '../apps/web/src/api.ts';

test('dateChunks splits an inclusive range into chunks of at most 366 days', () => {
  assert.deepEqual(dateChunks('2026-03-01', '2026-03-03'), [['2026-03-01', '2026-03-03']]);
  assert.deepEqual(dateChunks('2024-01-01', '2024-12-31'), [['2024-01-01', '2024-12-31']]);
  assert.deepEqual(dateChunks('2024-01-01', '2025-01-01'), [['2024-01-01', '2024-12-31'], ['2025-01-01', '2025-01-01']]);
  const chunks = dateChunks('2021-05-10', '2026-11-05');
  assert.equal(chunks[0]![0], '2021-05-10'); assert.equal(chunks.at(-1)![1], '2026-11-05');
  for (const [from, to] of chunks) assert.ok((Date.parse(to) - Date.parse(from)) / 86400000 <= 365);
});
