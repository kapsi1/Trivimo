import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { sourceKindSchema } from '../contracts/source-records.ts';
import { listSourceRecords } from './source-records.ts';
import { daySnapshotSchema, userNoteSchema } from '../contracts/day-snapshot.ts';
import { projectIssueNotes } from '../domain/data-issues.ts';

/** Validate a read-only imported snapshot without emitting any record contents. */
export function verifyTakeout(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('integrity');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('foreign_keys');
    const missing = db.prepare(`SELECT COUNT(*) AS count FROM import_files f LEFT JOIN artifacts a ON a.kind = f.kind AND a.digest = f.digest
      WHERE f.done != 1 OR a.id IS NULL OR f.row_count != (SELECT COUNT(*) FROM artifact_rows r WHERE r.artifact_id = a.id)`).get();
    if (missing?.count !== 0) throw new Error('import_mismatch');
    for (const artifact of db.prepare('SELECT digest, content FROM artifacts').iterate()) {
      if (!(artifact.content instanceof Uint8Array) || createHash('sha256').update(artifact.content).digest('hex') !== artifact.digest) throw new Error('digest_mismatch');
    }
    if (db.prepare("SELECT COUNT(*) AS count FROM import_sessions WHERE state != 'complete'").get()?.count !== 0) throw new Error('incomplete');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version < 1 || version > 4) throw new Error('unsupported_schema');
    if (version >= 2) {
      for (const row of db.prepare('SELECT day, revision, payload FROM daily_snapshots').iterate()) {
        if (typeof row.payload !== 'string') throw new Error('invalid_snapshot');
        const snapshot = daySnapshotSchema.parse(JSON.parse(row.payload));
        if (snapshot.date !== row.day || snapshot.revision !== row.revision || JSON.stringify(snapshot.notes) !== JSON.stringify(projectIssueNotes(snapshot.issues))) throw new Error('invalid_snapshot');
      }
    }
    if (version >= 3) {
      for (const row of db.prepare('SELECT day AS date, revision, content, created_at AS createdAt FROM user_note_versions').iterate()) userNoteSchema.parse(row);
    }
    for (const kind of sourceKindSchema.options) {
      listSourceRecords(db, kind, 0);
      listSourceRecords(db, kind, 0, '2026-01-01');
    }
  } finally { db.close(); }
}
