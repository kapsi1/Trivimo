import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CsvImportService } from '../apps/server/csv-import-service.ts';
import { currentStoreVersion } from '../packages/storage/canonical-days.ts';
import { createEmptyStore } from '../packages/storage/create-store.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';

test('pusty magazyn w bieżącej wersji: tworzony w nowym katalogu, istniejący plik nigdy nie jest zastępowany', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-empty-'));
  try {
    const path = join(dir, 'nowy', 'takeout-raw.sqlite');
    assert.equal(await createEmptyStore(path), true);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual([db.prepare('PRAGMA application_id').get()?.application_id, db.prepare('PRAGMA user_version').get()?.user_version], [1414682185, currentStoreVersion]);
      // nothing imported: no snapshots, notes, imports or reads
      for (const table of ['daily_snapshots', 'user_note_versions', 'csv_imports', 'google_read_jobs', 'import_sessions']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0, table);
    } finally { db.close(); }
    verifyTakeout(path);
    // services that need the current version open it without a migration
    assert.deepEqual(new CsvImportService(path).list(), []);
    // a second start, or any existing file, is left as it is
    assert.equal(await createEmptyStore(path), false);
    const other = join(dir, 'inny.sqlite'); writeFileSync(other, 'not a store');
    assert.equal(await createEmptyStore(other), false);
    assert.equal(readFileSync(other, 'utf8'), 'not a store');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
