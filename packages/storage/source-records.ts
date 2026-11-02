import type { DatabaseSync } from 'node:sqlite';
import { sourcePageSchema, type SourceKind, type SourcePage } from '../contracts/source-records.ts';
import { parseSourceValue } from '../domain/source-units.ts';

const valueColumns: Record<SourceKind, string> = {
  weight: 'weight grams', body_fat: 'body fat percentage', steps: 'steps', distance: 'distance',
  total_energy: 'calories', active_energy: 'Kilocalories',
};

/** A page of original fields, with no deduplication or qualification. */
export function listSourceRecords(db: DatabaseSync, kind: SourceKind, after: number, sourceDate: string | null = null): SourcePage {
  const selected = db.prepare(`SELECT r.rowid AS cursor, r.fields, a.header FROM artifact_rows r
    JOIN artifacts a ON a.id = r.artifact_id WHERE a.kind = ? AND r.rowid > ?
    AND (? IS NULL OR substr(json_extract(r.fields, '$[' || (SELECT key FROM json_each(a.header) WHERE value = 'timestamp' LIMIT 1) || ']'), 1, 10) = ?)
    ORDER BY r.rowid LIMIT 101`).all(kind, after, sourceDate, sourceDate);
  const rows = selected.slice(0, 100).map((record) => {
    if (typeof record.fields !== 'string' || typeof record.header !== 'string') throw new Error('Nieprawidłowy rekord');
    const header: unknown = JSON.parse(record.header);
    const fields: unknown = JSON.parse(record.fields);
    if (!Array.isArray(header) || !Array.isArray(fields) || !header.every((x) => typeof x === 'string') || !fields.every((x) => typeof x === 'string') || header.length !== fields.length) throw new Error('Nieprawidłowy rekord');
    const get = (name: string) => fields[header.indexOf(name)];
    const value = get(valueColumns[kind]);
    return { timestamp: get('timestamp'), value, source: get('data source'), converted: typeof value === 'string' ? parseSourceValue(kind, value) : { status: 'invalid' } };
  });
  const cursor = selected.length > 100 ? selected[99]?.cursor : null;
  return sourcePageSchema.parse({ rows, next: cursor });
}
