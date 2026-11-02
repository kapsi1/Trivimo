import type { DatabaseSync } from 'node:sqlite';
import { sourcePageSchema, type SourceKind, type SourcePage } from '../contracts/source-records.ts';

const valueColumns: Record<SourceKind, string> = {
  weight: 'weight grams', body_fat: 'body fat percentage', steps: 'steps', distance: 'distance',
  total_energy: 'calories', active_energy: 'Kilocalories',
};

/** A page of original fields, with no deduplication or qualification. */
export function listSourceRecords(db: DatabaseSync, kind: SourceKind, after: number): SourcePage {
  const selected = db.prepare(`SELECT r.rowid AS cursor, r.fields, a.header FROM artifact_rows r
    JOIN artifacts a ON a.id = r.artifact_id WHERE a.kind = ? AND r.rowid > ? ORDER BY r.rowid LIMIT 101`).all(kind, after);
  const rows = selected.slice(0, 100).map((record) => {
    if (typeof record.fields !== 'string' || typeof record.header !== 'string') throw new Error('Nieprawidłowy rekord');
    const header: unknown = JSON.parse(record.header);
    const fields: unknown = JSON.parse(record.fields);
    if (!Array.isArray(header) || !Array.isArray(fields) || !header.every((x) => typeof x === 'string') || !fields.every((x) => typeof x === 'string') || header.length !== fields.length) throw new Error('Nieprawidłowy rekord');
    const get = (name: string) => fields[header.indexOf(name)];
    return { timestamp: get('timestamp'), value: get(valueColumns[kind]), source: get('data source') };
  });
  const cursor = selected.length > 100 ? selected[99]?.cursor : null;
  return sourcePageSchema.parse({ rows, next: cursor });
}
