import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sourceKindSchema } from '../../packages/contracts/source-records.ts';
import { listSourceRecords } from '../../packages/storage/source-records.ts';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';

let stage = 'otwarcie';
try {
  const path = process.argv[2] ? resolve(process.argv[2]) : takeoutDatabasePath();
  if (!path) throw new Error('Missing data directory');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    stage = 'integralność';
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign keys failed');
    stage = 'powiązania';
    const missing = db.prepare(`SELECT COUNT(*) AS count FROM import_files f LEFT JOIN artifacts a ON a.kind = f.kind AND a.digest = f.digest
      WHERE f.done != 1 OR a.id IS NULL OR f.row_count != (SELECT COUNT(*) FROM artifact_rows r WHERE r.artifact_id = a.id)`).get();
    if (missing?.count !== 0) throw new Error('Import mismatch');
    stage = 'skróty';
    const artifacts = db.prepare('SELECT digest, content FROM artifacts').iterate();
    for (const artifact of artifacts) {
      if (!(artifact.content instanceof Uint8Array) || createHash('sha256').update(artifact.content).digest('hex') !== artifact.digest) throw new Error('Digest mismatch');
    }
    stage = 'sesje';
    const incomplete = db.prepare("SELECT COUNT(*) AS count FROM import_sessions WHERE state != 'complete'").get();
    if (incomplete?.count !== 0) throw new Error('Incomplete import');
    stage = 'odczyt';
    for (const kind of sourceKindSchema.options) {
      listSourceRecords(db, kind, 0);
      listSourceRecords(db, kind, 0, '2026-01-01');
    }
    console.log('Weryfikacja bazy importu: integralność, skróty oryginałów, liczby wierszy i odczyt typów poprawne.');
  } finally { db.close(); }
} catch {
  console.error(`Weryfikacja bazy importu nie powiodła się: ${stage}.`);
  process.exitCode = 1;
}
