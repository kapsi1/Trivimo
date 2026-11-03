import { z } from 'zod';
import { readLimitedText } from './limited-json.ts';
import { googleHttpError } from './rate-limit.ts';

export const dailyRollupTypes = ['steps', 'distance', 'total-calories', 'active-energy-burned'] as const;
export type DailyRollupType = (typeof dailyRollupTypes)[number];
export interface DailyRollupValue { date: string; value: string; unit: 'steps' | 'mm' | 'kcal' }
/** Producer limit per dailyRollUp request; checked 2026-11-03 and meant to live in the capability registry later. */
export const maxRollupDays = (type: DailyRollupType): number => type === 'total-calories' ? 14 : 90;
export interface DailyRollupPage { rawJson: string; days: DailyRollupValue[]; nextPageToken: string | null }

const civilDate = z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() });
const civilTime = z.object({ date: civilDate, time: z.object({ hours: z.number().int().optional(), minutes: z.number().int().optional(), seconds: z.number().int().optional(), nanos: z.number().int().optional() }).optional() });
const count = z.string().regex(/^\d{1,18}$/);
const kcal = z.object({ literal: z.string().regex(/^\d{1,12}(?:\.\d{1,40})?(?:[eE][+-]?\d{1,2})?$/) });

/** Exact plain-decimal form of a non-negative JSON number literal (no floating point); the stored raw JSON is untouched. */
export function plainDecimal(literal: string): string {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!match) throw new Error('invalid_number');
  const exponent = Number(match[3] ?? 0);
  let digits = `${match[1]}${match[2] ?? ''}`; let point = match[1]!.length + exponent;
  if (point < 0) { digits = '0'.repeat(-point) + digits; point = 0; }
  if (point > digits.length) digits = digits.padEnd(point, '0');
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0';
  const fraction = digits.slice(point).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
const pointSchema = z.object({ civilStartTime: civilTime, civilEndTime: civilTime, steps: z.object({ countSum: count }).passthrough().optional(), distance: z.object({ millimetersSum: count }).passthrough().optional(), totalCalories: z.object({ kcalSum: kcal }).passthrough().optional(), activeEnergyBurned: z.object({ kcalSum: kcal }).passthrough().optional() }).passthrough();
const responseSchema = z.object({ rollupDataPoints: z.array(pointSchema).max(90).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();

function key(value: z.infer<typeof civilDate>): string { return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`; }
function midnight(value: z.infer<typeof civilTime>): boolean { const time = value.time; return !time || ((time.hours ?? 0) === 0 && (time.minutes ?? 0) === 0 && (time.seconds ?? 0) === 0 && (time.nanos ?? 0) === 0); }
function nextDay(date: string): string { return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function civil(date: string) { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }; }

const plainDecimalOrUndefined = (literal: string | undefined) => literal === undefined ? undefined : plainDecimal(literal);

/** Pure: only whole producer civil days with a value for the requested type are returned; an absent day stays absent, never 0. */
export function parseDailyRollup(rawJson: string, type: DailyRollupType): { days: DailyRollupValue[]; nextPageToken: string | null } {
  // kcalSum is a JSON number; keep its source text so no float rounding enters the stored value.
  const decoded: unknown = JSON.parse(rawJson, function (key: string, value: unknown, context?: { source?: string }) {
    return key === 'kcalSum' && typeof value === 'number' ? { literal: context?.source ?? '' } : value;
  });
  const parsed = responseSchema.parse(decoded);
  const days: DailyRollupValue[] = [];
  for (const point of parsed.rollupDataPoints ?? []) {
    const date = key(point.civilStartTime.date);
    if (!midnight(point.civilStartTime) || !midnight(point.civilEndTime) || key(point.civilEndTime.date) !== nextDay(date)) throw new Error('unexpected_window');
    const value = type === 'steps' ? point.steps?.countSum : type === 'distance' ? point.distance?.millimetersSum : type === 'total-calories' ? plainDecimalOrUndefined(point.totalCalories?.kcalSum.literal) : plainDecimalOrUndefined(point.activeEnergyBurned?.kcalSum.literal);
    if (value === undefined) continue;
    days.push({ date, value, unit: type === 'steps' ? 'steps' : type === 'distance' ? 'mm' : 'kcal' });
  }
  if (new Set(days.map((day) => day.date)).size !== days.length) throw new Error('duplicate_day');
  return { days, nextPageToken: parsed.nextPageToken || null };
}

export const dataSourceFamilies = ['all-sources', 'google-wearables', 'google-sources'] as const;
export type DataSourceFamily = (typeof dataSourceFamilies)[number];
/**
 * Family used by every saved read job. `google-wearables` does not separate the phone from the band and `all-sources`
 * matches the Health app (data contracts, 2026-11-03); jobs do not store a family, so reading another one needs a schema change.
 */
export const readSourceFamily: DataSourceFamily = 'all-sources';
export const sourceFamilyName = (family: DataSourceFamily | undefined) => `users/me/dataSourceFamilies/${z.enum(dataSourceFamilies).parse(family ?? readSourceFamily)}`;

/** One bounded page of one-day windows for the half-open civil range [start, end). Unqualified, unreconciled source values. */
export async function dailyRollupPage(input: { type: DailyRollupType; start: string; end: string; pageToken?: string; family?: DataSourceFamily }, accessToken: string, send: typeof fetch = fetch): Promise<DailyRollupPage> {
  const type = z.enum(dailyRollupTypes).parse(input.type);
  z.iso.date().parse(input.start); z.iso.date().parse(input.end);
  const span = (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86400000;
  if (!(span >= 1 && span <= maxRollupDays(type))) throw new Error('invalid_range');
  if (!accessToken || accessToken.length > 16384 || (input.pageToken !== undefined && (input.pageToken.length === 0 || input.pageToken.length > 8192))) throw new Error('invalid_request');
  const body = { range: { start: civil(input.start), end: civil(input.end) }, windowSizeDays: 1, dataSourceFamily: sourceFamilyName(input.family), pageSize: maxRollupDays(type), ...(input.pageToken ? { pageToken: input.pageToken } : {}) };
  const response = await send(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints:dailyRollUp`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw googleHttpError('google_http', response);
  const rawJson = await readLimitedText(response);
  return { rawJson, ...parseDailyRollup(rawJson, type) };
}
