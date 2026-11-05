import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { csvMappingSchema, type CsvMapping, type CsvMetric } from '../contracts/csv-import.ts';
import { csvNoteMax, csvParserVersion, type ParsedCsv } from '../adapters/csv/mapped-csv.ts';
import { remarksByDay } from './canonical-days.ts';
import { add, equal, fromText, mean, rational, toText, type Rational } from '../domain/rational.ts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const mappingDigest = (mapping: CsvMapping) => sha256(JSON.stringify(csvMappingSchema.parse(mapping)));
export const contentDigest = (content: string) => sha256(content);

export function hasCsvImports(db: DatabaseSync): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'csv_imports'").get();
}

export type CsvNoteAction = { day: string; action: 'create' | 'append'; content: string; added: string } | { day: string; action: 'unchanged' | 'too_long'; content: null; added: null };

const latestNote = (db: DatabaseSync, day: string) => {
  const row = db.prepare('SELECT revision, content FROM user_note_versions WHERE day = ? ORDER BY revision DESC LIMIT 1').get(day);
  return row ? { revision: Number(row.revision), content: String(row.content) } : null;
};

/**
 * What remarks do to the day notes (the same notes the user writes in the application), per day with its distinct
 * remarks. A day without a note gets a new note; a day with a note gets the remarks appended on new lines, except
 * those the note already contains (a repeated import changes nothing). A result over the note limit is not written.
 */
export function planCsvNotes(db: DatabaseSync, remarks: Map<string, string[]>): CsvNoteAction[] {
  return [...remarks].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([day, texts]) => {
    const current = latestNote(db, day)?.content;
    const existing = current !== undefined && current.trim() !== '' ? current : null;
    const added = texts.filter((text) => !existing?.includes(text));
    if (added.length === 0) return { day, action: 'unchanged', content: null, added: null };
    const content = existing === null ? added.join('\n') : `${existing}\n${added.join('\n')}`;
    if (content.length > csvNoteMax) return { day, action: 'too_long', content: null, added: null };
    return { day, action: existing === null ? 'create' : 'append', content, added: added.join('\n') };
  });
}

/** Writes the planned notes as new revisions marked with the import (origin kept in `user_note_sources`). */
function applyCsvNotes(db: DatabaseSync, id: string, remarks: Map<string, string[]>, now: string): number {
  let written = 0;
  for (const item of planCsvNotes(db, remarks)) {
    if (item.content === null) continue;
    const revision = (latestNote(db, item.day)?.revision ?? 0) + 1;
    db.prepare('INSERT INTO user_note_versions VALUES (?, ?, ?, ?)').run(item.day, revision, item.content, now);
    db.prepare("INSERT INTO user_note_sources VALUES (?, ?, ?, 'apply', ?)").run(item.day, revision, id, item.added);
    written++;
  }
  return written;
}

/**
 * Takes back what an import added to the day notes: from the current note (also when edited since) the lines the
 * import added are removed, the last occurrence of each, as a new revision marked `withdraw`. Lines the user already
 * removed are not touched again; the rest of the note stays as it is.
 */
function withdrawCsvNotes(db: DatabaseSync, id: string, now: string): number {
  let written = 0;
  const days = db.prepare(`SELECT s.day, s.action, s.text FROM user_note_sources s WHERE s.import_id = ? AND s.revision = (SELECT MAX(revision) FROM user_note_sources t WHERE t.import_id = s.import_id AND t.day = s.day) ORDER BY s.day`).all(id);
  for (const row of days) {
    if (row.action !== 'apply') continue;
    const day = String(row.day), current = latestNote(db, day);
    if (!current) continue;
    const lines = current.content.split('\n'), removed: string[] = [];
    for (const line of String(row.text).split('\n').reverse()) {
      const at = lines.lastIndexOf(line);
      if (at >= 0) { lines.splice(at, 1); removed.unshift(line); }
    }
    if (removed.length === 0) continue;
    const revision = current.revision + 1;
    db.prepare('INSERT INTO user_note_versions VALUES (?, ?, ?, ?)').run(day, revision, lines.join('\n'), now);
    db.prepare("INSERT INTO user_note_sources VALUES (?, ?, ?, 'withdraw', ?)").run(day, revision, id, removed.join('\n'));
    written++;
  }
  return written;
}

const savedRemarks = (db: DatabaseSync, id: string) => new Map(db.prepare('SELECT day, text FROM csv_import_notes WHERE import_id = ? ORDER BY day').all(id).map((row) => [String(row.day), String(row.text).split('\n')] as const));

/**
 * Save the file text, mapping, parser version, converted values and remarks in one transaction, included in the
 * table; the remarks become new revisions of the day notes in the same transaction (history of the notes kept, each
 * revision marked with the import). The same file with the same mapping is not saved twice; the existing import is
 * returned instead and the notes are not touched.
 */
export function saveCsvImport(db: DatabaseSync, input: { fileName: string; content: string; mapping: CsvMapping; parsed: ParsedCsv; now: string }): { id: string; created: boolean; notes: number } {
  const mapping = csvMappingSchema.parse(input.mapping), digest = contentDigest(input.content), mapDigest = mappingDigest(mapping);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT id FROM csv_imports WHERE content_digest = ? AND mapping_digest = ? AND parser = ?').get(digest, mapDigest, csvParserVersion);
    if (existing) { db.exec('COMMIT'); return { id: String(existing.id), created: false, notes: 0 }; }
    const id = randomUUID();
    db.prepare('INSERT INTO csv_imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.fileName, digest, input.content, JSON.stringify(mapping), mapDigest, csvParserVersion, input.parsed.dataRows, input.parsed.rejected.length, input.now);
    const insert = db.prepare('INSERT INTO csv_import_values VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const value of input.parsed.values) { const exact = toText(value.value); insert.run(id, value.row, value.metric, value.day, value.time, value.sourceText, value.sourceUnit, exact.numerator, exact.denominator); }
    db.prepare("INSERT INTO csv_import_decisions VALUES (?, 1, 'included', ?)").run(id, input.now);
    const remarks = remarksByDay(input.parsed.notes);
    const keep = db.prepare('INSERT INTO csv_import_notes VALUES (?, ?, ?)');
    for (const [day, texts] of remarks) keep.run(id, day, texts.join('\n'));
    const notes = applyCsvNotes(db, id, remarks, input.now);
    db.exec('COMMIT');
    return { id, created: true, notes };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}


const stateOf = "(SELECT d.state FROM csv_import_decisions d WHERE d.import_id = i.id ORDER BY d.revision DESC LIMIT 1)";

/** Imports with counts and range only (no values); newest first. */
export function listCsvImports(db: DatabaseSync) {
  return db.prepare(`SELECT i.id, i.file_name AS fileName, i.created_at AS createdAt, i.data_rows AS dataRows, i.rejected, i.parser, ${stateOf} AS state,
      (SELECT COUNT(*) FROM csv_import_values v WHERE v.import_id = i.id) AS "values", (SELECT MIN(day) FROM csv_import_values v WHERE v.import_id = i.id) AS first,
      (SELECT MAX(day) FROM csv_import_values v WHERE v.import_id = i.id) AS last, (SELECT group_concat(DISTINCT metric) FROM csv_import_values v WHERE v.import_id = i.id) AS metrics, (SELECT COUNT(*) FROM csv_import_notes n WHERE n.import_id = i.id) AS notes
    FROM csv_imports i ORDER BY i.created_at DESC, i.id LIMIT 200`).all().map((row) => ({ ...row, metrics: typeof row.metrics === 'string' ? row.metrics.split(',') : [] }));
}

/**
 * New revision of the include/withdraw decision for all data of the import: its values (the days to recompute are
 * returned) and its remarks in the day notes, taken back or written again as new note revisions.
 */
export function decideCsvImport(db: DatabaseSync, id: string, state: 'included' | 'excluded', now: string): { first: string | null; last: string | null; notes: number } {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(`SELECT ${stateOf} AS state, (SELECT MAX(revision) FROM csv_import_decisions d WHERE d.import_id = i.id) AS revision FROM csv_imports i WHERE i.id = ?`).get(id);
    if (!current) throw new Error('not_found');
    let notes = 0;
    if (current.state !== state) {
      db.prepare('INSERT INTO csv_import_decisions VALUES (?, ?, ?, ?)').run(id, Number(current.revision) + 1, state, now);
      notes = state === 'excluded' ? withdrawCsvNotes(db, id, now) : applyCsvNotes(db, id, savedRemarks(db, id), now);
    }
    const range = db.prepare('SELECT MIN(day) AS first, MAX(day) AS last FROM csv_import_values WHERE import_id = ?').get(id);
    db.exec('COMMIT');
    return { first: typeof range?.first === 'string' ? range.first : null, last: typeof range?.last === 'string' ? range.last : null, notes };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/**
 * Imports that hold data of one day: which metrics have values there, and what the import did to that day's note
 * (the latest note action of the import, with the revision it wrote). For provenance panels only.
 */
export function csvDayOrigin(db: DatabaseSync, day: string) {
  return db.prepare(`SELECT i.id, i.file_name AS fileName, i.created_at AS createdAt, ${stateOf} AS state,
      (SELECT group_concat(DISTINCT v.metric) FROM csv_import_values v WHERE v.import_id = i.id AND v.day = ?1) AS metrics,
      (SELECT s.action FROM user_note_sources s WHERE s.import_id = i.id AND s.day = ?1 ORDER BY s.revision DESC LIMIT 1) AS noteAction,
      (SELECT s.revision FROM user_note_sources s WHERE s.import_id = i.id AND s.day = ?1 ORDER BY s.revision DESC LIMIT 1) AS noteRevision
    FROM csv_imports i WHERE EXISTS (SELECT 1 FROM csv_import_values v WHERE v.import_id = i.id AND v.day = ?1) OR EXISTS (SELECT 1 FROM csv_import_notes n WHERE n.import_id = i.id AND n.day = ?1)
    ORDER BY i.created_at, i.id`).all(day).map((row) => ({ id: String(row.id), fileName: String(row.fileName), createdAt: String(row.createdAt), state: String(row.state), metrics: typeof row.metrics === 'string' ? row.metrics.split(',') : [], note: row.noteAction ? { action: String(row.noteAction), revision: Number(row.noteRevision) } : null }));
}

export type CsvDayValue ={ status: 'valid'; value: Rational; imports: string[] } | { status: 'conflict'; value: null; imports: string[] };

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

