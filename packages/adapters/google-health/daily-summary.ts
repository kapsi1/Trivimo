import { z } from 'zod';
import { readLimitedText } from './limited-json.ts';
import { sourceFamilyName } from './daily-rollup.ts';
import { googleHttpError } from './rate-limit.ts';

/**
 * Daily summary types of Health API v4 (category "Daily": `list` and `reconcile` only, no rollUp/dailyRollUp). Read with
 * `reconcile` (all sources): `list` returns one point per data source, so a day can come twice with different values
 * (checked 2026-11-06: resting heart rate, a DERIVED and an UNKNOWN source); `reconcile` returns the producer's single
 * stream, one point per day, which is what the Health app shows. Pages saved before this change came from `list`.
 * Fields checked 2026-11-06 in the v4 dataPoints reference and the filter guide; the filter field is the snake_case
 * type name plus `.date` (`>=` and `<` only, no OR). The producer computes the value of a civil day, so it is stored as
 * given and never recomputed from samples. Presence of a field is the only "has data" signal: an absent day is not 0.
 */
type Field = { name: string; kind: 'number' | 'int' | 'boolean' | 'enum'; required: boolean };
type Spec = { member: string; filter: string; scope: 'health-metrics' | 'activity'; fields: readonly Field[] };
const field = (name: string, kind: Field['kind'], required: boolean): Field => ({ name, kind, required });

export const dailySummarySpecs = {
  'daily-resting-heart-rate': { member: 'dailyRestingHeartRate', filter: 'daily_resting_heart_rate', scope: 'health-metrics', fields: [field('beatsPerMinute', 'int', true)] },
  'daily-heart-rate-variability': { member: 'dailyHeartRateVariability', filter: 'daily_heart_rate_variability', scope: 'health-metrics', fields: [field('averageHeartRateVariabilityMilliseconds', 'number', false), field('nonRemHeartRateBeatsPerMinute', 'int', false), field('entropy', 'number', false), field('deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds', 'number', false)] },
  'daily-oxygen-saturation': { member: 'dailyOxygenSaturation', filter: 'daily_oxygen_saturation', scope: 'health-metrics', fields: [field('averagePercentage', 'number', true), field('lowerBoundPercentage', 'number', true), field('upperBoundPercentage', 'number', true), field('standardDeviationPercentage', 'number', false)] },
  'daily-respiratory-rate': { member: 'dailyRespiratoryRate', filter: 'daily_respiratory_rate', scope: 'health-metrics', fields: [field('breathsPerMinute', 'number', true)] },
  'daily-sleep-temperature-derivations': { member: 'dailySleepTemperatureDerivations', filter: 'daily_sleep_temperature_derivations', scope: 'health-metrics', fields: [field('nightlyTemperatureCelsius', 'number', true), field('baselineTemperatureCelsius', 'number', false), field('relativeNightlyStddev30dCelsius', 'number', false)] },
  'daily-vo2-max': { member: 'dailyVo2Max', filter: 'daily_vo2_max', scope: 'activity', fields: [field('vo2Max', 'number', true), field('vo2MaxCovariance', 'number', false), field('estimated', 'boolean', false), field('cardioFitnessLevel', 'enum', false)] },
} as const satisfies Record<string, Spec>;
export type DailySummaryType = keyof typeof dailySummarySpecs;
export const dailySummaryTypes = Object.keys(dailySummarySpecs) as DailySummaryType[];
export const isDailySummaryType = (kind: string): kind is DailySummaryType => kind in dailySummarySpecs;
export const dailySummaryScope = (type: DailySummaryType) => dailySummarySpecs[type].scope;
/** The service reads whole civil days; one page holds at most `pageSize` points, so a range is bounded in days. */
export const maxDailySummaryDays = 90;
const pageSize = 90;

export interface DailySummaryDay { date: string; values: Record<string, string> }
export interface DailySummaryPage { rawJson: string; days: DailySummaryDay[]; nextPageToken: string | null }

const civilDate = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) });
const number = z.object({ literal: z.string().regex(/^-?\d{1,12}(?:\.\d{1,40})?(?:[eE][+-]?\d{1,2})?$/) });
const int = z.string().regex(/^\d{1,9}$/);
const enumName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const responseSchema = z.object({ dataPoints: z.array(z.record(z.string(), z.unknown())).max(pageSize).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();
const key = (date: z.infer<typeof civilDate>) => `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

/**
 * Pure: the value sets of the page in order. A civil day can appear more than once (checked 2026-11-06: sleep temperature
 * returns two different points for one day even from `reconcile`); which one is right is the producer's to say, so the
 * callers keep every candidate (`groupByDay`) instead of choosing. Number literals keep their source text (no float rounding). Unknown fields are ignored. */
export function parseDailySummary(rawJson: string, type: DailySummaryType): { days: DailySummaryDay[]; nextPageToken: string | null } {
  const spec: Spec = dailySummarySpecs[type];
  const decoded: unknown = JSON.parse(rawJson, function (name: string, value: unknown, context?: { source?: string }) {
    return typeof value === 'number' && name !== 'year' && name !== 'month' && name !== 'day' ? { literal: context?.source ?? '' } : value;
  });
  const parsed = responseSchema.parse(decoded);
  const days: DailySummaryDay[] = [];
  for (const point of parsed.dataPoints ?? []) {
    const body = z.record(z.string(), z.unknown()).parse(point[spec.member]);
    const date = key(civilDate.parse(body.date));
    const values: Record<string, string> = {};
    for (const item of spec.fields) {
      const raw = body[item.name];
      // proto JSON writes a number the producer could not compute as the text "NaN" (seen 2026-11-06 on optional sleep temperature fields): no value, never a zero
      if (item.kind === 'number' && raw === 'NaN') { if (item.required) throw new Error('missing_field'); continue; }
      if (raw === undefined) { if (item.required) throw new Error('missing_field'); continue; }
      values[item.name] = item.kind === 'number' ? number.parse(raw).literal : item.kind === 'int' ? int.parse(raw) : item.kind === 'enum' ? enumName.parse(raw) : String(z.boolean().parse(raw));
    }
    // a point with no metric at all carries no value: it must not turn into a zero or an empty day
    if (Object.keys(values).length === 0) throw new Error('empty_point');
    days.push({ date, values });
  }
  return { days, nextPageToken: parsed.nextPageToken || null };
}

/** One bounded page of the reconciled stream for the half-open civil range [start, end). Producer values, not qualified here. */
export async function dailySummaryPage(input: { type: DailySummaryType; start: string; end: string; pageToken?: string }, accessToken: string, send: typeof fetch = fetch): Promise<DailySummaryPage> {
  const type = z.enum(dailySummaryTypes as [DailySummaryType, ...DailySummaryType[]]).parse(input.type);
  z.iso.date().parse(input.start); z.iso.date().parse(input.end);
  const span = (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86400000;
  if (!(span >= 1 && span <= maxDailySummaryDays)) throw new Error('invalid_range');
  if (!accessToken || accessToken.length > 16384 || (input.pageToken !== undefined && (input.pageToken.length === 0 || input.pageToken.length > 8192))) throw new Error('invalid_request');
  const name = dailySummarySpecs[type].filter;
  const url = new URL(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints:reconcile`);
  url.searchParams.set('dataSourceFamily', sourceFamilyName(undefined));
  url.searchParams.set('filter', `${name}.date >= "${input.start}" AND ${name}.date < "${input.end}"`);
  url.searchParams.set('pageSize', String(pageSize));
  if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
  const response = await send(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw googleHttpError('google_http', response);
  const rawJson = await readLimitedText(response);
  return { rawJson, ...parseDailySummary(rawJson, type) };
}

/**
 * Rule `google-daily-summaries-v2` (user decision 2026-11-06): when a day has several different points, only these fields
 * may still be read as one value, and only if every candidate carries the same text for each of them. Checked that day on
 * the account: sleep temperature returns two points per day whose nightly temperature is equal in most days while the
 * 30-day baseline differs (two computations, producer rule unknown), so the baseline and deviation are never chosen.
 */
const agreeOn: Partial<Record<DailySummaryType, readonly string[]>> = { 'daily-sleep-temperature-derivations': ['nightlyTemperatureCelsius'] };
export function agreedValues(type: DailySummaryType, candidates: Record<string, string>[]): Record<string, string> | null {
  const names = agreeOn[type];
  if (!names) return null;
  const values: Record<string, string> = {};
  for (const name of names) {
    const first = candidates[0]?.[name];
    if (first === undefined || candidates.some((candidate) => candidate[name] !== first)) return null;
    values[name] = first;
  }
  return values;
}

export type DailySummaryDayState = { status: 'value'; values: Record<string, string> } | { status: 'conflict'; candidates: Record<string, string>[] };
/** Candidates of each civil day: identical repeats collapse, different value sets of one day stay together in a stable order (a conflict, never a pick). */
export function groupByDay(days: DailySummaryDay[]): Map<string, DailySummaryDayState> {
  const byDay = new Map<string, Map<string, Record<string, string>>>();
  for (const day of days) {
    const key = JSON.stringify(Object.entries(day.values).sort(([a], [b]) => a < b ? -1 : 1));
    const candidates = byDay.get(day.date) ?? new Map<string, Record<string, string>>();
    candidates.set(key, day.values); byDay.set(day.date, candidates);
  }
  return new Map([...byDay].map(([date, candidates]) => {
    const list = [...candidates].sort(([a], [b]) => a < b ? -1 : 1).map(([, values]) => values);
    return [date, list.length === 1 ? { status: 'value' as const, values: list[0]! } : { status: 'conflict' as const, candidates: list }];
  }));
}
