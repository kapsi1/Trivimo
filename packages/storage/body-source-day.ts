import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { sourceDay } from '../domain/source-day.ts';
import { sourceIdentity, type SourceIdentity } from '../domain/source-identity.ts';
import { parseSourceValue } from '../domain/source-units.ts';
import { resolveArtifactAccount } from './source-accounts.ts';

export interface BodySourceRow {
  /** A location in an immutable artifact, not the identity of a measurement. */
  locator: { artifact: number; position: number };
  timestamp: string;
  origin: string;
  originalValue: string;
  converted: ReturnType<typeof parseSourceValue>;
  identity: SourceIdentity;
}

/** Read source rows for review, never treating a fallback key as an accepted measurement. */
export function readBodySourceDay(db: DatabaseSync, kind: 'weight' | 'body_fat', day: string) {
  z.iso.date().parse(day);
  const rows: BodySourceRow[] = [];
  let unassigned = 0;
  let matched = 0;
  const accounts = new Map<number, string | null>();
  const valueColumn = kind === 'weight' ? 'weight grams' : 'body fat percentage';
  const query = db.prepare(`SELECT a.id AS artifact, a.header, r.position, r.fields FROM artifacts a
    JOIN artifact_rows r ON r.artifact_id = a.id WHERE a.kind = ? ORDER BY a.id, r.position`);
  for (const row of query.iterate(kind)) {
    if (typeof row.artifact !== 'number' || typeof row.position !== 'number' || typeof row.header !== 'string' || typeof row.fields !== 'string') throw new Error('Nieprawidłowy rekord źródłowy');
    const header: unknown = JSON.parse(row.header), fields: unknown = JSON.parse(row.fields);
    if (!Array.isArray(header) || !Array.isArray(fields) || !header.every((item) => typeof item === 'string') || !fields.every((item) => typeof item === 'string') || header.length !== fields.length) throw new Error('Nieprawidłowy rekord źródłowy');
    const get = (name: string): string => {
      const index = header.indexOf(name);
      if (index < 0 || typeof fields[index] !== 'string') throw new Error('Nieprawidłowy rekord źródłowy');
      return fields[index];
    };
    const timestamp = get('timestamp');
    let assigned: string;
    try { assigned = sourceDay(timestamp); } catch { unassigned++; continue; }
    if (assigned !== day) continue;
    matched++;
    if (rows.length >= 200) continue;
    const origin = get('data source'), originalValue = get(valueColumn);
    if (!accounts.has(row.artifact)) accounts.set(row.artifact, resolveArtifactAccount(db, row.artifact));
    rows.push({
      locator: { artifact: row.artifact, position: row.position }, timestamp, origin, originalValue,
      converted: parseSourceValue(kind, originalValue),
      identity: sourceIdentity({ provider: 'google_takeout', account: accounts.get(row.artifact) ?? '', type: kind, originalId: null, timestamp, origin }),
    });
  }
  return { rows, matched, truncated: matched > rows.length, unassigned, coverage: 'unknown' as const };
}
