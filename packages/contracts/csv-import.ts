import { z } from 'zod';

export const csvMetrics = ['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy'] as const;
export type CsvMetric = (typeof csvMetrics)[number];
/** Units a column may declare; the import converts them exactly to the application's units (kg, %, steps, km, kcal). */
export const csvUnits = {
  weight: ['kg', 'g', 'lb'], body_fat: ['%', 'fraction'], steps: ['count'], distance: ['km', 'm', 'mi'], total_energy: ['kcal', 'kJ'], active_energy: ['kcal', 'kJ'],
} as const satisfies Record<CsvMetric, readonly string[]>;
export const csvDateFormats = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'ISO_DATETIME'] as const;

const column = z.number().int().min(0).max(255);
const metricColumn = <T extends readonly [string, ...string[]]>(units: T) => z.object({ column, unit: z.enum(units) }).strict();

/**
 * How the columns of one CSV file map to the application's metrics. Columns are zero-based positions in the file;
 * the day is the civil date written in the file (an ISO time with an offset is assigned to its civil day in the day zone active at the import).
 * `dailyRows` decides what several rows of one day mean for daily totals: `single` (copies; differing values are a
 * conflict) or `sum` (parts of the day, added up by this explicit choice). Weight and body fat are always measurements.
 * `note` is a column of remarks: on import they are written to the day notes, like notes typed in the application.
 */
export const csvMappingSchema = z.object({
  delimiter: z.enum([',', ';', '\t']),
  header: z.boolean(),
  decimal: z.enum(['.', ',']),
  date: z.object({ column, format: z.enum(csvDateFormats) }).strict(),
  time: column.nullable(),
  dailyRows: z.enum(['single', 'sum']),
  // optional column with a free-text remark of the day; absent in mappings saved before csv-mapped-v2
  note: column.optional(),
  metrics: z.object({
    weight: metricColumn(csvUnits.weight).optional(), body_fat: metricColumn(csvUnits.body_fat).optional(), steps: metricColumn(csvUnits.steps).optional(),
    distance: metricColumn(csvUnits.distance).optional(), total_energy: metricColumn(csvUnits.total_energy).optional(), active_energy: metricColumn(csvUnits.active_energy).optional(),
  }).strict(),
}).strict().refine((mapping) => Object.keys(mapping.metrics).length > 0 || mapping.note !== undefined, { message: 'Wybierz co najmniej jedną metrykę lub kolumnę uwag' });
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export const csvContentSchema = z.object({ name: z.string().min(1).max(255), content: z.string().min(1).max(8 * 1024 * 1024) }).strict();

