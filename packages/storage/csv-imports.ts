import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { csvMappingSchema, type CsvMapping, type CsvMetric } from '../contracts/csv-import.ts';
import { csvParserVersion, type ParsedCsv } from '../adapters/csv/mapped-csv.ts';
import { add, equal, fromText, mean, rational, toText, type Rational } from '../domain/rational.ts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const mappingDigest = (mapping: CsvMapping) => sha256(JSON.stringify(csvMappingSchema.parse(mapping)));
export const contentDigest = (content: string) => sha256(content);

export function hasCsvImports(db: DatabaseSync): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'csv_imports'").get();
}

/**
 * Save the file text, mapping, parser version and converted values in one transaction, included in the table.
 * The same file with the same mapping is not saved twice; the existing import is returned instead.
 */
export function saveCsvImport(db: DatabaseSync, input: { fileName: string; content: string; mapping: CsvMapping; parsed: ParsedCsv; now: string }): { id: string; created: boolean } {
  const mapping = csvMappingSchema.parse(input.mapping), digest = contentDigest(input.content), mapDigest = mappingDigest(mapping);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT id FROM csv_imports WHERE content_digest = ? AND mapping_digest = ? AND parser = ?').get(digest, mapDigest, csvParserVersion);
    if (existing) { db.exec('COMMIT'); return { id: String(existing.id), created: false }; }
    const id = randomUUID();
    db.prepare('INSERT INTO csv_imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.fileName, digest, input.content, JSON.stringify(mapping), mapDigest, csvParserVersion, input.parsed.dataRows, input.parsed.rejected.length, input.now);
    const insert = db.prepare('INSERT INTO csv_import_values VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const value of input.parsed.values) { const exact = toText(value.value); insert.run(id, value.row, value.metric, value.day, value.time, value.sourceText, value.sourceUnit, exact.numerator, exact.denominator); }
    db.prepare("INSERT INTO csv_import_decisions VALUES (?, 1, 'included', ?)").run(id, input.now);
    db.exec('COMMIT');
    return { id, created: true };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const stateOf = "(SELECT d.state FROM csv_import_decisions d WHERE d.import_id = i.id ORDER BY d.revision DESC LIMIT 1)";

/** Imports with counts and range only (no values); newest first. */
export function listCsvImports(db: DatabaseSync) {
  return db.prepare(`SELECT i.id, i.file_name AS fileName, i.created_at AS createdAt, i.data_rows AS dataRows, i.rejected, i.parser, ${stateOf} AS state,
      (SELECT COUNT(*) FROM csv_import_values v WHERE v.import_id = i.id) AS "values", (SELECT MIN(day) FROM csv_import_values v WHERE v.import_id = i.id) AS first,
      (SELECT MAX(day) FROM csv_import_values v WHERE v.import_id = i.id) AS last, (SELECT group_concat(DISTINCT metric) FROM csv_import_values v WHERE v.import_id = i.id) AS metrics
    FROM csv_imports i ORDER BY i.created_at DESC, i.id LIMIT 200`).all().map((row) => ({ ...row, metrics: typeof row.metrics === 'string' ? row.metrics.split(',') : [] }));
}

/** New revision of the include/exclude decision; returns the days the import touches (to recompute them). */
export function decideCsvImport(db: DatabaseSync, id: string, state: 'included' | 'excluded', now: string): { first: string | null; last: string | null } {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(`SELECT ${stateOf} AS state, (SELECT MAX(revision) FROM csv_import_decisions d WHERE d.import_id = i.id) AS revision FROM csv_imports i WHERE i.id = ?`).get(id);
    if (!current) throw new Error('not_found');
    if (current.state !== state) db.prepare('INSERT INTO csv_import_decisions VALUES (?, ?, ?, ?)').run(id, Number(current.revision) + 1, state, now);
    const range = db.prepare('SELECT MIN(day) AS first, MAX(day) AS last FROM csv_import_values WHERE import_id = ?').get(id);
    db.exec('COMMIT');
    return { first: typeof range?.first === 'string' ? range.first : null, last: typeof range?.last === 'string' ? range.last : null };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export type CsvDayValue = { status: 'valid'; value: Rational; imports: string[] } | { status: 'conflict'; value: null; imports: string[] };

/**
 * Daily value per metric from the included imports (rule csv-fill-v1). Weight and body fat: mean of unique measurements
 * (same day, time and exact value is one measurement, also across imports). Daily totals: per import one value (copies
 * must agree) or, when that import's mapping says so, the sum of its rows; imports that disagree are a conflict.
 */
export function csvDayValues(db: DatabaseSync, from: string, to: string): Map<string, Partial<Record<CsvMetric, CsvDayValue>>> {
  const days = new Map<string, Partial<Record<CsvMetric, CsvDayValue>>>();
  if (!hasCsvImports(db)) return days;
  const groups = new Map<string, { metric: CsvMetric; day: string; rows: { importId: string; time: string | null; value: Rational; sum: boolean }[] }>();
  const sums = new Map<string, boolean>();
  for (const row of db.prepare(`SELECT v.import_id, v.metric, v.day, v.time, v.numerator, v.denominator, i.mapping FROM csv_import_values v JOIN csv_imports i ON i.id = v.import_id
      WHERE v.day >= ? AND v.day <= ? AND ${stateOf} = 'included' ORDER BY v.day, v.metric, v.import_id, v.row_number`).iterate(from, to)) {
    const importId = String(row.import_id);
    if (!sums.has(importId)) sums.set(importId, (JSON.parse(String(row.mapping)) as CsvMapping).dailyRows === 'sum');
    const key = `${row.day}|${row.metric}`;
    const group = groups.get(key) ?? { metric: row.metric as CsvMetric, day: String(row.day), rows: [] };
    group.rows.push({ importId, time: typeof row.time === 'string' ? row.time : null, value: fromText({ numerator: String(row.numerator), denominator: String(row.denominator) }), sum: sums.get(importId)! });
    groups.set(key, group);
  }
  for (const { metric, day, rows } of groups.values()) {
    const imports = [...new Set(rows.map((row) => row.importId))];
    let result: CsvDayValue;
    if (metric === 'weight' || metric === 'body_fat') {
      const unique = new Map<string, Rational>();
      for (const row of rows) unique.set(`${row.time ?? ''}|${row.value.numerator}/${row.value.denominator}`, row.value);
      result = { status: 'valid', value: mean([...unique.values()]), imports };
    } else {
      const perImport: (Rational | null)[] = imports.map((id) => {
        const own = rows.filter((row) => row.importId === id);
        if (own[0]!.sum) return own.reduce((total, row) => add(total, row.value), rational(0n));
        return own.every((row) => equal(row.value, own[0]!.value)) ? own[0]!.value : null;
      });
      const first = perImport[0];
      result = first && perImport.every((value) => value && equal(value, first)) ? { status: 'valid', value: first, imports } : { status: 'conflict', value: null, imports };
    }
    days.set(day, { ...days.get(day), [metric]: result });
  }
  return days;
}
