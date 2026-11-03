import { z } from 'zod';
import { readLimitedText } from './limited-json.ts';

export type DailyRollupType = 'steps' | 'distance';
export interface DailyRollupValue { date: string; value: string; unit: 'steps' | 'mm' }
export interface DailyRollupPage { rawJson: string; days: DailyRollupValue[]; nextPageToken: string | null }

const civilDate = z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() });
const civilTime = z.object({ date: civilDate, time: z.object({ hours: z.number().int().optional(), minutes: z.number().int().optional(), seconds: z.number().int().optional(), nanos: z.number().int().optional() }).optional() });
const count = z.string().regex(/^\d{1,18}$/);
const pointSchema = z.object({ civilStartTime: civilTime, civilEndTime: civilTime, steps: z.object({ countSum: count }).passthrough().optional(), distance: z.object({ millimetersSum: count }).passthrough().optional() }).passthrough();
const responseSchema = z.object({ rollupDataPoints: z.array(pointSchema).max(90).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();

function key(value: z.infer<typeof civilDate>): string { return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`; }
function midnight(value: z.infer<typeof civilTime>): boolean { const time = value.time; return !time || ((time.hours ?? 0) === 0 && (time.minutes ?? 0) === 0 && (time.seconds ?? 0) === 0 && (time.nanos ?? 0) === 0); }
function nextDay(date: string): string { return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function civil(date: string) { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }; }

/** Pure: only whole producer civil days with a value for the requested type are returned; an absent day stays absent, never 0. */
export function parseDailyRollup(rawJson: string, type: DailyRollupType): { days: DailyRollupValue[]; nextPageToken: string | null } {
  const parsed = responseSchema.parse(JSON.parse(rawJson) as unknown);
  const days: DailyRollupValue[] = [];
  for (const point of parsed.rollupDataPoints ?? []) {
    const date = key(point.civilStartTime.date);
    if (!midnight(point.civilStartTime) || !midnight(point.civilEndTime) || key(point.civilEndTime.date) !== nextDay(date)) throw new Error('unexpected_window');
    const value = type === 'steps' ? point.steps?.countSum : point.distance?.millimetersSum;
    if (value === undefined) continue;
    days.push({ date, value, unit: type === 'steps' ? 'steps' : 'mm' });
  }
  if (new Set(days.map((day) => day.date)).size !== days.length) throw new Error('duplicate_day');
  return { days, nextPageToken: parsed.nextPageToken || null };
}

/** One bounded page of one-day windows for the half-open civil range [start, end). Unqualified, unreconciled source values. */
export async function dailyRollupPage(input: { type: DailyRollupType; start: string; end: string; pageToken?: string }, accessToken: string, send: typeof fetch = fetch): Promise<DailyRollupPage> {
  const type = z.enum(['steps', 'distance']).parse(input.type);
  z.iso.date().parse(input.start); z.iso.date().parse(input.end);
  const span = (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86400000;
  if (!(span >= 1 && span <= 90)) throw new Error('invalid_range');
  if (!accessToken || accessToken.length > 16384 || (input.pageToken !== undefined && (input.pageToken.length === 0 || input.pageToken.length > 8192))) throw new Error('invalid_request');
  const body = { range: { start: civil(input.start), end: civil(input.end) }, windowSizeDays: 1, dataSourceFamily: 'users/me/dataSourceFamilies/all-sources', pageSize: 90, ...(input.pageToken ? { pageToken: input.pageToken } : {}) };
  const response = await send(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints:dailyRollUp`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`google_http_${response.status}`);
  const rawJson = await readLimitedText(response);
  return { rawJson, ...parseDailyRollup(rawJson, type) };
}
