import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { csvMappingSchema, csvMetrics, type CsvMapping, type CsvMetric } from '../../packages/contracts/csv-import.ts';
import { csvParserVersion, inspectCsv, parseMappedCsv, type ParsedCsv } from '../../packages/adapters/csv/mapped-csv.ts';
import { sourceDay } from '../../packages/domain/source-day.ts';
import { currentStoreVersion, readCanonicalDay, remarksByDay } from '../../packages/storage/canonical-days.ts';
import { contentDigest, csvDayOrigin, decideCsvImport, listCsvImports, mappingDigest, planCsvNotes, saveCsvImport } from '../../packages/storage/csv-imports.ts';
import { publishDayRangeYielding } from '../../packages/storage/google-day-snapshots.ts';
import { readDayZone } from '../../packages/storage/day-zone.ts';

/**
 * CSV import with a column mapping: inspect the file, preview what the mapping yields and which day values it would
 * fill, then save after confirmation. The preview token binds the exact file text, mapping and parser version, so a
 * changed file or mapping needs a new preview. File contents are untrusted data and are never echoed beyond a few cells.
 */
export class CsvImportService {
  constructor(private readonly path: string, private readonly now: () => number = Date.now) {}
  private open(readOnly: boolean): DatabaseSync {
    let db: DatabaseSync;
    try { const stat = lstatSync(this.path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_store'); db = new DatabaseSync(this.path, { readOnly, timeout: 5000 }); } catch { throw new Error('store_unavailable'); }
    if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || db.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { db.close(); throw new Error('migration_required'); }
    return db;
  }
  /** Today and the day zone of the store; the zone also assigns the days of timestamps with an offset. */
  private clock(db: DatabaseSync) { const zone = readDayZone(db); return { zone, today: sourceDay(new Date(this.now()).toISOString(), zone) }; }
  private token(content: string, mapping: CsvMapping) { return createHash('sha256').update(`${contentDigest(content)}:${mappingDigest(mapping)}:${csvParserVersion}`).digest('hex'); }

  inspect(content: string) { return inspectCsv(content); }

  preview(name: string, content: string, input: unknown) {
    const mapping = csvMappingSchema.parse(input);
    const db = this.open(true);
    let parsed: ParsedCsv;
    try { const { zone, today } = this.clock(db); parsed = parseMappedCsv(content, mapping, today, zone); } catch (error) { db.close(); throw error; }
    const days = [...new Set([...parsed.values, ...parsed.notes].map((value) => value.day))].sort();
    let notes: { values: number; days: number; create: number; append: number; unchanged: number; tooLong: number } | null = null;
    const perMetric = Object.fromEntries(csvMetrics.filter((metric) => mapping.metrics[metric]).map((metric) => [metric, { values: 0, days: 0, fills: 0, keepsGoogle: 0 }])) as Partial<Record<CsvMetric, { values: number; days: number; fills: number; keepsGoogle: number }>>;
    let duplicate = false;
    try {
      duplicate = !!db.prepare('SELECT 1 FROM csv_imports WHERE content_digest = ? AND mapping_digest = ? AND parser = ?').get(contentDigest(content), mappingDigest(mapping), csvParserVersion);
      const byDay = new Map<string, Set<CsvMetric>>();
      for (const value of parsed.values) { perMetric[value.metric]!.values++; byDay.set(value.day, (byDay.get(value.day) ?? new Set()).add(value.metric)); }
      for (const [day, metrics] of byDay) {
        // a metric the published day already has from Google stays from Google; a missing one (or one filled by CSV) is filled
        const snapshot = readCanonicalDay(db, day);
        for (const metric of metrics) {
          const stat = perMetric[metric]!; stat.days++;
          if (!snapshot || snapshot.metrics[metric].status === 'missing' || snapshot.csv?.metrics.includes(metric)) stat.fills++; else stat.keepsGoogle++;
        }
      }
      if (mapping.note !== undefined) {
        // the remarks become day notes on import: a new note, an appended line, or nothing when the note already has it
        const plan = planCsvNotes(db, remarksByDay(parsed.notes)), count = (action: string) => plan.filter((item) => item.action === action).length;
        notes = { values: parsed.notes.length, days: plan.length, create: count('create'), append: count('append'), unchanged: count('unchanged'), tooLong: count('too_long') };
      }
    } finally { db.close(); }
    return {
      token: this.token(content, mapping), name, duplicate, dataRows: parsed.dataRows, values: parsed.values.length, empty: parsed.empty,
      rejected: parsed.rejected.length, rejectedSample: parsed.rejected.slice(0, 20), first: days[0] ?? null, last: days.at(-1) ?? null, days: days.length, perMetric, notes,
    };
  }

  async commit(name: string, content: string, input: unknown, token: string) {
    const mapping = csvMappingSchema.parse(input);
    if (token !== this.token(content, mapping)) throw new Error('plan_changed');
    const db = this.open(false);
    try {
      const { zone, today } = this.clock(db);
      const parsed = parseMappedCsv(content, mapping, today, zone);
      db.exec('PRAGMA foreign_keys = ON');
      const saved = saveCsvImport(db, { fileName: name, content, mapping, parsed, now: new Date(this.now()).toISOString() });
      const days = parsed.values.map((value) => value.day).sort();
      const result = days.length ? await publishDayRangeYielding(db, days[0]!, days.at(-1)!, this.now()) : { published: 0, unchanged: 0 };
      return { id: saved.id, created: saved.created, notes: saved.notes, ...result };
    } finally { db.close(); }
  }

  list() { const db = this.open(true); try { return listCsvImports(db); } finally { db.close(); } }
  /** Origin of one day's data in CSV imports, for the day's provenance panel only. */
  day(date: string) { const db = this.open(true); try { return csvDayOrigin(db, date); } finally { db.close(); } }

  async decide(id: string, state: 'included' | 'excluded') {
    const db = this.open(false);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const range = decideCsvImport(db, id, state, new Date(this.now()).toISOString());
      return { notes: range.notes, ...(range.first && range.last ? await publishDayRangeYielding(db, range.first, range.last, this.now()) : { published: 0, unchanged: 0 }) };
    } finally { db.close(); }
  }
}
