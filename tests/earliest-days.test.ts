import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, publishCanonicalDay, readEarliestMetricDays } from '../packages/storage/canonical-days.ts';
import type { DaySnapshotInput } from '../packages/contracts/day-snapshot.ts';

const missing = { status: 'missing' as const, value: null };
const value = (n: string) => ({ status: 'valid' as const, value: { numerator: n, denominator: '1' } });
const day = (date: string, metrics: Partial<DaySnapshotInput['metrics']>): DaySnapshotInput => ({ date, metrics: { weight: missing, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing, ...metrics }, issues: [] });

test('najwcześniejszy dzień z wartością per metryka: brak to nie wartość, zero potwierdzone jest wartością, liczy się najnowsza rewizja', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-earliest-'));
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(directory, 'before.sqlite'));
    initializeTakeoutStore(db);
    assert.deepEqual(Object.values(readEarliestMetricDays(db)), [null, null, null, null, null, null]);
    publishCanonicalDay(db, day('2024-03-02', { steps: value('0') }), null);
    publishCanonicalDay(db, day('2024-03-05', { weight: value('70'), steps: value('900') }), null);
    publishCanonicalDay(db, day('2024-03-01', { weight: value('71') }), null);
    // a newer revision of 2024-03-01 no longer has a weight: the day does not count
    publishCanonicalDay(db, day('2024-03-01', {}), 1);
    const earliest = readEarliestMetricDays(db);
    assert.equal(earliest.weight, '2024-03-05'); assert.equal(earliest.steps, '2024-03-02'); assert.equal(earliest.body_fat, null);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
