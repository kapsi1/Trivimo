import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, readCanonicalDay } from '../packages/storage/canonical-days.ts';

const repo = (path: string) => pathToFileURL(join(import.meta.dirname, '..', path)).href;

test('twarde przerwanie procesu w trakcie publikacji nie niszczy ostatniego potwierdzonego wyniku', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-kill-'));
  const path = join(dir, 'db.sqlite');
  try {
    const db = new DatabaseSync(path);
    initializeTakeoutStore(db); await migrateCanonicalDays(db, join(dir, 'v1.sqlite'));
    db.close();
    // the writer publishes new revisions of 30 days in a loop, each in its own transaction, until it is killed
    const writer = join(dir, 'writer.mts');
    writeFileSync(writer, `
      import { DatabaseSync } from 'node:sqlite';
      import { publishCanonicalDay, readCanonicalDay } from '${repo('packages/storage/canonical-days.ts')}';
      const db = new DatabaseSync(${JSON.stringify(path)});
      const value = (n) => ({ status: 'valid', value: { numerator: String(n), denominator: '1' } });
      for (let round = 1; ; round++) {
        for (let day = 1; day <= 30; day++) {
          const date = '2026-06-' + String(day).padStart(2, '0');
          const steps = value(round * 100 + day);
          publishCanonicalDay(db, { date, metrics: { weight: value(80), body_fat: value(20), steps, distance: value(1), total_energy: value(2000), active_energy: value(round) }, issues: round % 2 ? [{ metric: 'steps', code: 'incomplete_coverage', state: 'active' }] : [] }, readCanonicalDay(db, date)?.revision ?? null);
        }
        if (round === 3) console.log('ready');
      }`);
    const child = spawn(process.execPath, ['--import', 'tsx', writer], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve, reject) => { child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('ready')) resolve(); }); child.on('exit', () => reject(new Error('writer_exited'))); });
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 200));
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('exit', resolve));

    const after = new DatabaseSync(path);
    try {
      assert.equal(after.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      for (let day = 1; day <= 30; day++) {
        const date = `2026-06-${String(day).padStart(2, '0')}`;
        // every day still has its newest committed revision, whole: value, issues and notes from the same write
        const snapshot = readCanonicalDay(after, date)!;
        const round = Number(snapshot.metrics.active_energy.value!.numerator);
        assert.ok(snapshot.revision >= 3);
        assert.equal(snapshot.revision, round);
        assert.equal(snapshot.metrics.steps.value!.numerator, String(round * 100 + day));
        assert.deepEqual(snapshot.notes, round % 2 ? ['Kroki: niepełny zakres'] : []);
        const revisions = after.prepare('SELECT revision FROM daily_snapshots WHERE day = ? ORDER BY revision').all(date).map((row) => Number(row.revision));
        assert.deepEqual(revisions, Array.from({ length: revisions.length }, (_, index) => index + 1));
      }
    } finally { after.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
