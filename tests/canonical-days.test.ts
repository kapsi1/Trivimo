import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, publishCanonicalDay, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import type { DaySnapshotInput } from '../packages/contracts/day-snapshot.ts';
import { dayResponseSchema } from '../packages/contracts/day-snapshot.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { createApp } from '../apps/server/app.ts';
import { publishDayEvidence } from '../packages/storage/project-day.ts';

test('migracja tworzy kopię poprzedniej wersji i snapshot zachowuje wartości oraz uwagi w rewizji', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-projection-'));
  const backupPath = join(directory, 'before.sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, backupPath);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try { assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version, 1); } finally { backup.close(); }
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 2);
    initializeTakeoutStore(db);
    const missing = { status: 'missing' as const, value: null };
    const input: DaySnapshotInput = {
      date: '2026-01-01',
      metrics: { weight: { status: 'valid', value: { numerator: '71', denominator: '1' } }, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing },
      issues: [{ metric: 'total_energy', code: 'basal_only', state: 'active' }],
    };
    const first = publishCanonicalDay(db, input, null);
    assert.equal(first.revision, 1);
    assert.deepEqual(first.notes, ['Kalorie: tylko energia bazowa']);
    assert.deepEqual(readCanonicalDay(db, input.date), first);
    assert.throws(() => publishCanonicalDay(db, input, null), /Konflikt/);
    const second = publishCanonicalDay(db, { ...input, issues: [{ ...input.issues[0]!, state: 'resolved' }] }, 1);
    assert.equal(second.revision, 2);
    assert.deepEqual(second.notes, []);
    assert.deepEqual(readCanonicalDay(db, input.date), second);
    const previous = db.prepare('SELECT payload FROM daily_snapshots WHERE day = ? AND revision = 1').get(input.date);
    assert.deepEqual(JSON.parse(String(previous?.payload)), first);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('REST zwraca jedną rewizję wartości i uwag, a przed migracją jawny stan niegotowy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-projection-'));
  const db = new DatabaseSync(':memory:');
  const demo = createDemoDatabase();
  initializeTakeoutStore(db);
  const server = createApp(demo, db);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const read = async () => dayResponseSchema.parse(await (await fetch(`${base}/api/day?date=2026-01-01`, { headers: { Cookie: cookie } })).json());
    assert.deepEqual(await read(), { state: 'not_ready' });
    await migrateCanonicalDays(db, join(directory, 'before.sqlite'));
    assert.deepEqual(await read(), { state: 'ready', snapshot: null, notesAvailable: false, userNote: null });
    const snapshot = publishDayEvidence(db, {
      date: '2026-01-01',
      weight: { candidates: [{ identity: 'one', value: '71.25', decision: 'accepted' }], evaluationComplete: true },
      bodyFat: { candidates: [], evaluationComplete: true },
      steps: { kind: 'steps', value: null, unit: 'unknown', reconciliation: 'unresolved', sourceFamily: 'unknown', dayBoundary: 'unknown', coverage: 'unknown', day: 'complete', zeroConfirmed: false },
      distance: { kind: 'distance', value: null, unit: 'unknown', reconciliation: 'unresolved', sourceFamily: 'unknown', dayBoundary: 'unknown', coverage: 'unknown', day: 'complete', zeroConfirmed: false },
      totalEnergy: { kind: 'total', value: '1500', definition: 'basal_only', unit: 'kcal', origin: 'wearable', coverage: 'confirmed', day: 'complete', zeroConfirmed: false },
      activeEnergy: { kind: 'active', value: null, definition: 'unknown', unit: 'unknown', origin: 'unknown', coverage: 'unknown', day: 'complete', zeroConfirmed: false },
    }, null);
    assert.deepEqual(await read(), { state: 'ready', snapshot, notesAvailable: false, userNote: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    demo.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('snapshot nie zamienia braku w zero i odrzuca sprzeczną wartość', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-projection-'));
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(directory, 'before.sqlite'));
    const missing = { status: 'missing' as const, value: null };
    const input: DaySnapshotInput = { date: '2026-01-01', metrics: { weight: missing, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing }, issues: [] };
    const stored = publishCanonicalDay(db, input, null);
    assert.equal(stored.metrics.steps.value, null);
    assert.throws(() => publishCanonicalDay(db, { ...input, metrics: { ...input.metrics, steps: { status: 'missing', value: { numerator: '0', denominator: '1' } } } }, 1));
    assert.throws(() => publishCanonicalDay(db, { ...input, metrics: { ...input.metrics, steps: { status: 'valid', value: { numerator: '3', denominator: '2' } } } }, 1));
    assert.throws(() => publishCanonicalDay(db, { ...input, metrics: { ...input.metrics, body_fat: { status: 'valid', value: { numerator: '101', denominator: '1' } } } }, 1));
    assert.deepEqual(readCanonicalDay(db, input.date), stored);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
