import { parse } from 'csv-parse/sync';
import { csvMetrics, type CsvMapping, type CsvMetric } from '../../contracts/csv-import.ts';
import { isInteger, multiply, parseDecimal, rational, type Rational } from '../../domain/rational.ts';
import { sourceDay } from '../../domain/source-day.ts';
import { firstSupportedDay } from '../../domain/warsaw-day.ts';
import { ungroupDigits } from './decimal.ts';

/**
 * Version of the mapping parser; stored with every import so a changed rule is a new version, not a silent change.
 * v2: a percent value may end with "%" ("20,90%"), and a column of remarks may be mapped to the day's note.
 * v3: digits may be grouped by threes with a space, no-break space, narrow no-break space or thin space ("12 345").
 */
export const csvParserVersion = 'csv-mapped-v3';
export { ungroupDigits };
/** Longest remark kept from one cell (the length limit of a day note). */
export const csvNoteMax = 10000;
const maxRows = 200000, maxColumns = 256, maxRecord = 65536;

function records(text: string, delimiter: string, toLine?: number): string[][] {
  const rows = parse(text, { delimiter, bom: true, relax_column_count: true, relax_quotes: false, skip_empty_lines: true, max_record_size: maxRecord, ...(toLine ? { to_line: toLine } : {}) }) as string[][];
  if (rows.length > maxRows + 1) throw new Error('too_many_rows');
  if (rows.some((row) => row.length > maxColumns)) throw new Error('too_many_columns');
  return rows;
}

/**
 * Columns and a few rows of a file, with the delimiter that splits its first lines into the most consistent columns.
 * Nothing is interpreted yet; the file content is untrusted data.
 */
export function inspectCsv(text: string): { delimiter: ',' | ';' | '\t'; columns: number; rows: number; head: string[][] } {
  let best: { delimiter: ',' | ';' | '\t'; columns: number } | null = null;
  for (const delimiter of [',', ';', '\t'] as const) {
    let sample: string[][];
    try { sample = records(text, delimiter, 50); } catch { continue; }
    if (sample.length === 0) continue;
    const columns = sample[0]!.length, consistent = sample.every((row) => row.length === columns);
    if (columns > 1 && consistent && (!best || columns > best.columns)) best = { delimiter, columns };
  }
  const delimiter = best?.delimiter ?? ',';
  let all: string[][];
  try { all = records(text, delimiter); } catch (error) { throw new Error(error instanceof Error && /^too_many_/.test(error.message) ? error.message : 'invalid_csv'); }
  if (all.length === 0) throw new Error('empty_csv');
  return { delimiter, columns: Math.max(...all.slice(0, 50).map((row) => row.length)), rows: all.length, head: all.slice(0, 6).map((row) => row.map((cell) => cell.slice(0, 200))) };
}

export type CsvRejection = 'invalid_date' | 'date_out_of_range' | 'invalid_time' | 'invalid_number' | 'out_of_range' | 'not_integer' | 'missing_column' | 'note_too_long';
export interface CsvValue { row: number; metric: CsvMetric; day: string; time: string | null; sourceText: string; sourceUnit: string; value: Rational }
export interface CsvNote { row: number; day: string; text: string }
export interface ParsedCsv { values: CsvValue[]; notes: CsvNote[]; rejected: { row: number; metric: CsvMetric | 'note' | null; reason: CsvRejection }[]; empty: number; dataRows: number }

const valid = (year: number, month: number, day: number) => { const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; };
const iso = (year: number, month: number, day: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Civil day (and time of day, when the cell has one) of a date cell in the declared format; null when it does not match. */
export function parseDay(cell: string, format: CsvMapping['date']['format']): { day: string; time: string | null } | null {
  const text = cell.trim();
  if (format === 'ISO_DATETIME') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
    if (!match) return null;
    const [, y, m, d, hh, mm, ss, frac, offset] = match;
    if (!valid(Number(y), Number(m), Number(d)) || (hh !== undefined && (Number(hh) > 23 || Number(mm) > 59 || Number(ss ?? 0) > 59))) return null;
    const time = hh === undefined ? null : `${hh}:${mm}:${ss ?? '00'}${frac ?? ''}`;
    if (!offset) return { day: `${y}-${m}-${d}`, time };
    if (hh === undefined) return null;
    const normalized = `${y}-${m}-${d}T${time}${offset === 'Z' ? 'Z' : `${offset.slice(0, 3)}:${offset.slice(-2)}`}`;
    try { return { day: sourceDay(normalized), time: normalized }; } catch { return null; }
  }
  const pattern = format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/ : format === 'DD.MM.YYYY' ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/ : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const match = pattern.exec(text);
  if (!match) return null;
  const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [year, month, day] = format === 'YYYY-MM-DD' ? [a, b, c] : format === 'MM/DD/YYYY' ? [c, a, b] : [c, b, a];
  return valid(year, month, day) ? { day: iso(year, month, day), time: null } : null;
}

/** Exact factor from the declared unit to the application unit (kg, %, steps, km, kcal). */
const factors: Record<string, Rational> = {
  kg: rational(1n), g: rational(1n, 1000n), lb: rational(45359237n, 100000000n), '%': rational(1n), fraction: rational(100n), count: rational(1n),
  km: rational(1n), m: rational(1n, 1000n), mi: rational(1609344n, 1000000n), kcal: rational(1n), kJ: rational(1000n, 4184n),
};

/**
 * Values of the mapped columns, converted exactly. An empty cell is no value (never 0); a cell that cannot be read
 * rejects that value with a reason and leaves the other columns of the row. Days after `today` are rejected.
 */
export function parseMappedCsv(text: string, mapping: CsvMapping, today: string): ParsedCsv {
  let rows: string[][];
  try { rows = records(text, mapping.delimiter); } catch (error) { throw new Error(error instanceof Error && /^too_many_/.test(error.message) ? error.message : 'invalid_csv'); }
  const result: ParsedCsv = { values: [], notes: [], rejected: [], empty: 0, dataRows: 0 };
  rows.forEach((cells, index) => {
    if (mapping.header && index === 0) return;
    result.dataRows++;
    const row = index + 1;
    const dateCell = cells[mapping.date.column];
    if (dateCell === undefined) { result.rejected.push({ row, metric: null, reason: 'missing_column' }); return; }
    const parsed = parseDay(dateCell, mapping.date.format);
    if (!parsed) { result.rejected.push({ row, metric: null, reason: 'invalid_date' }); return; }
    if (parsed.day < firstSupportedDay || parsed.day > today) { result.rejected.push({ row, metric: null, reason: 'date_out_of_range' }); return; }
    let time = parsed.time;
    if (mapping.time !== null) {
      const cell = (cells[mapping.time] ?? '').trim();
      if (cell) {
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(cell);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) { result.rejected.push({ row, metric: null, reason: 'invalid_time' }); return; }
        time = `${match[1]!.padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
      }
    }
    for (const metric of csvMetrics) {
      const target = mapping.metrics[metric];
      if (!target) continue;
      const cell = cells[target.column];
      if (cell === undefined) { result.rejected.push({ row, metric, reason: 'missing_column' }); continue; }
      if (cell.trim() === '') { result.empty++; continue; }
      // a percent may carry its sign ("20,90%", "20.9 %"); the sign is accepted only where the declared unit is %
      const number = ungroupDigits(target.unit === '%' ? cell.trim().replace(/\s*%$/, '') : cell);
      const source = parseDecimal(number, mapping.decimal);
      if (!source) { result.rejected.push({ row, metric, reason: 'invalid_number' }); continue; }
      const value = multiply(source, factors[target.unit]!);
      if (metric === 'body_fat' && value.numerator > 100n * value.denominator) { result.rejected.push({ row, metric, reason: 'out_of_range' }); continue; }
      if (metric === 'steps' && !isInteger(value)) { result.rejected.push({ row, metric, reason: 'not_integer' }); continue; }
      result.values.push({ row, metric, day: parsed.day, time, sourceText: cell.trim(), sourceUnit: target.unit, value });
    }
    if (mapping.note !== undefined) {
      // free text, kept as written (trimmed); an empty cell is no remark
      const text = (cells[mapping.note] ?? '').trim();
      if (text.length > csvNoteMax) result.rejected.push({ row, metric: 'note', reason: 'note_too_long' });
      else if (text) result.notes.push({ row, day: parsed.day, text });
    }
  });
  return result;
}
