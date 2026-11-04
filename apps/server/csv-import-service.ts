import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { csvMappingSchema, csvMetrics, type CsvMapping, type CsvMetric } from '../../packages/contracts/csv-import.ts';
import { csvParserVersion, inspectCsv, parseMappedCsv } from '../../packages/adapters/csv/mapped-csv.ts';
import { sourceDay } from '../../packages/domain/source-day.ts';
import { currentStoreVersion, readCanonicalDay } from '../../packages/storage/canonical-days.ts';
import { contentDigest, decideCsvImport, listCsvImports, mappingDigest, saveCsvImport } from '../../packages/storage/csv-imports.ts';
import { publishDayRange } from '../../packages/storage/google-day-snapshots.ts';

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
  private today() { return sourceDay(new Date(this.now()).toISOString()); }
  private token(content: string, mapping: CsvMapping) { return createHash('sha256').update(`${contentDigest(content)}:${mappingDigest(mapping)}:${csvParserVersion}`).digest('hex'); }

  inspect(content: string) { return inspectCsv(content); }

  preview(name: string, content: string, input: unknown) {
    const mapping = csvMappingSchema.parse(input);
    const parsed = parseMappedCsv(content, mapping, this.today());
    const days = [...new Set(parsed.values.map((value) => value.day))].sort();
    const perMetric = Object.fromEntries(csvMetrics.filter((metric) => mapping.metrics[metric]).map((metric) => [metric, { values: 0, days: 0, fills: 0, keepsGoogle: 0 }])) as Partial<Record<CsvMetric, { values: number; days: number; fills: number; keepsGoogle: number }>>;
    const db = this.open(true);
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
    } finally { db.close(); }
    return {
      token: this.token(content, mapping), name, duplicate, dataRows: parsed.dataRows, values: parsed.values.length, empty: parsed.empty,
      rejected: parsed.rejected.length, rejectedSample: parsed.rejected.slice(0, 20), first: days[0] ?? null, last: days.at(-1) ?? null, days: days.length, perMetric,
    };
  }

  commit(name: string, content: string, input: unknown, token: string) {
    const mapping = csvMappingSchema.parse(input);
    if (token !== this.token(content, mapping)) throw new Error('plan_changed');
    const parsed = parseMappedCsv(content, mapping, this.today());
    const db = this.open(false);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const saved = saveCsvImport(db, { fileName: name, content, mapping, parsed, now: new Date(this.now()).toISOString() });
      const days = parsed.values.map((value) => value.day).sort();
      const result = days.length ? publishDayRange(db, days[0]!, days.at(-1)!, this.now()) : { published: 0, unchanged: 0 };
      return { id: saved.id, created: saved.created, ...result };
    } finally { db.close(); }
  }

  list() { const db = this.open(true); try { return listCsvImports(db); } finally { db.close(); } }

  decide(id: string, state: 'included' | 'excluded') {
    const db = this.open(false);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const range = decideCsvImport(db, id, state, new Date(this.now()).toISOString());
      return range.first && range.last ? publishDayRange(db, range.first, range.last, this.now()) : { published: 0, unchanged: 0 };
    } finally { db.close(); }
  }
}
