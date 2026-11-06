import { z } from 'zod';

const rational = z.object({ numerator: z.string().regex(/^\d+$/).max(1024), denominator: z.string().regex(/^[1-9]\d*$/).max(1024) }).strict();
function integers(input: { numerator: string; denominator: string }): [bigint, bigint] | null {
  if (!/^\d+$/.test(input.numerator) || !/^[1-9]\d*$/.test(input.denominator) || input.numerator.length > 1024 || input.denominator.length > 1024) return null;
  return [BigInt(input.numerator), BigInt(input.denominator)];
}
const value = z.object({ status: z.enum(['valid', 'provisional', 'missing', 'incomplete', 'incomparable', 'conflict', 'stale', 'unsupported', 'permission_denied', 'source_error']), value: rational.nullable() }).strict()
  .refine((item) => item.status !== 'valid' || item.value !== null)
  .refine((item) => item.status !== 'missing' || item.value === null);
export const issueSchema = z.object({
  metric: z.enum(['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy']),
  code: z.enum(['basal_only', 'incomparable_source', 'incomplete_coverage', 'unknown_origin', 'identity_conflict', 'invalid_value', 'unknown_unit', 'incomparable_day', 'unresolved_overlap', 'legacy_model']),
  state: z.enum(['active', 'resolved']),
}).strict();
const summaryItem = z.object({
  type: z.enum(['daily-resting-heart-rate', 'daily-heart-rate-variability', 'daily-oxygen-saturation', 'daily-respiratory-rate', 'daily-sleep-temperature-derivations', 'daily-vo2-max']),
  /** `value`: the producer returned a point for the day; `absent`: a complete read covered the day and returned none (not a zero); `conflict`: several different points. An unread type is not listed. */
  status: z.enum(['value', 'absent', 'conflict', 'agreed']),
  /** `value` and `agreed`: for `agreed` only the fields all candidates state identically (rule v2). */
  values: z.record(z.string().max(64), z.string().max(64)).optional(),
  /** `conflict` and `agreed`: the producer returned different points for one day; all are kept, the other fields are not chosen. */
  candidates: z.array(z.record(z.string().max(64), z.string().max(64))).min(2).max(8).optional(),
}).strict()
  .refine((item) => (item.status === 'value' || item.status === 'agreed') === (item.values !== undefined && Object.keys(item.values).length > 0))
  .refine((item) => (item.status === 'conflict' || item.status === 'agreed') === (item.candidates !== undefined));
export const snapshotInputSchema = z.object({
  date: z.iso.date(),
  metrics: z.object({ weight: value, body_fat: value, steps: value, distance: value, total_energy: value, active_energy: value }).strict()
    .refine((metrics) => { const parts = metrics.steps.value && integers(metrics.steps.value); return !metrics.steps.value || !!parts && parts[0] % parts[1] === 0n; }, { path: ['steps'], message: 'Kroki muszą być liczbą całkowitą' })
    .refine((metrics) => { const parts = metrics.body_fat.value && integers(metrics.body_fat.value); return !metrics.body_fat.value || !!parts && parts[0] <= 100n * parts[1]; }, { path: ['body_fat'], message: 'Procent poza zakresem' }),
  issues: z.array(issueSchema).max(1000),
  /** Day zone (IANA name) the day was cut in, rule day-zone-v1. Absent in snapshots published before the setting: Europe/Warsaw. */
  zone: z.string().min(1).max(64).optional(),
  /** Calorie qualification evidence: rule version, producer model and the band share that marks whose estimate it is. */
  energy: z.object({
    rule: z.literal('google-energy-v1'), model: z.enum(['current', 'legacy', 'basal_only', 'unknown']),
    heartRateWindows: z.number().int().nonnegative().nullable(), dayWindows: z.number().int().positive(),
    activeWithHeartRateKcal: z.string().regex(/^\d{1,9}\.\d{2}$/).nullable(), activeWithoutHeartRateKcal: z.string().regex(/^\d{1,9}\.\d{2}$/).nullable(),
  }).strict().optional(),
  /** Steps and distance qualification evidence: rule version and whether the day's windows sum to the daily value. */
  activity: z.object({ rule: z.literal('google-activity-v1'), stepsMatchWindows: z.boolean().nullable(), distanceMatchWindows: z.boolean().nullable() }).strict().optional(),
  /** Weight and body fat evidence: rule version, records read for the day and how many were copies of the same measurement. */
  body: z.object({
    rule: z.literal('google-body-v1'), weightRecords: z.number().int().nonnegative().nullable(), weightReplicas: z.number().int().nonnegative().nullable(),
    bodyFatRecords: z.number().int().nonnegative().nullable(), bodyFatReplicas: z.number().int().nonnegative().nullable(),
  }).strict().optional(),
  /** Producer daily summaries (resting heart rate, HRV, SpO2, respiratory rate, sleep temperature, VO2 max) as the producer computed them; not metrics of the table and not recomputed. */
  summaries: z.object({ rule: z.enum(['google-daily-summaries-v1', 'google-daily-summaries-v2']), items: z.array(summaryItem).min(1).max(6) }).strict().optional(),
  /** Metrics filled from CSV imports (rule csv-fill-v1) because the Google data of the day had no value for them. */
  csv: z.object({
    rule: z.literal('csv-fill-v1'), metrics: z.array(z.enum(['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy'])).min(1).max(6),
    imports: z.array(z.uuid()).min(1).max(100),
  }).strict().optional(),
}).strict();
export type DaySnapshotInput = z.infer<typeof snapshotInputSchema>;
export type DayMetricValue = DaySnapshotInput['metrics']['weight'];
export const daySnapshotSchema = snapshotInputSchema.extend({ revision: z.number().int().positive(), notes: z.array(z.string()) });
export const userNoteSchema = z.object({ date: z.iso.date(), revision: z.number().int().positive(), content: z.string().max(10000), createdAt: z.iso.datetime() }).strict();
export const userNoteInputSchema = z.object({ date: z.iso.date(), expectedRevision: z.number().int().positive().nullable(), content: z.string().max(10000) }).strict();
export type UserNoteInput = z.infer<typeof userNoteInputSchema>;
export const dayResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_ready') }),
  z.object({ state: z.literal('ready'), snapshot: daySnapshotSchema.nullable(), notesAvailable: z.boolean(), userNote: userNoteSchema.nullable() }),
]);
