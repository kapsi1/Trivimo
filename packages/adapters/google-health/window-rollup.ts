import { z } from 'zod';
import { plainDecimal } from './daily-rollup.ts';
import { readLimitedText } from './limited-json.ts';

/** Ten-minute physical-time windows: heart rate as wear evidence, active energy for its split by wear. */
export const windowRollupTypes = ['heart-rate', 'active-energy-burned'] as const;
export type WindowRollupType = (typeof windowRollupTypes)[number];
export const windowSeconds = 600;
export const maxWindowRangeDays = 14;
export interface RollupWindow { start: string; end: string; value: string | null }
export interface WindowRollupPage { rawJson: string; windows: RollupWindow[]; nextPageToken: string | null }

const kcal = z.object({ literal: z.string().regex(/^\d{1,12}(?:\.\d{1,40})?(?:[eE][+-]?\d{1,2})?$/) });
const pointSchema = z.object({
  startTime: z.iso.datetime(), endTime: z.iso.datetime(),
  heartRate: z.object({ beatsPerMinuteAvg: z.number() }).passthrough().optional(),
  activeEnergyBurned: z.object({ kcalSum: kcal }).passthrough().optional(),
}).passthrough();
const responseSchema = z.object({ rollupDataPoints: z.array(pointSchema).max(10000).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();

/** Pure: only whole ten-minute windows with a value are returned. Heart rate carries no value text (presence is the evidence). */
export function parseWindowRollup(rawJson: string, type: WindowRollupType): { windows: RollupWindow[]; nextPageToken: string | null } {
  // kcalSum is a JSON number; keep its source text so no float rounding enters the stored value.
  const decoded: unknown = JSON.parse(rawJson, function (key: string, value: unknown, context?: { source?: string }) {
    return key === 'kcalSum' && typeof value === 'number' ? { literal: context?.source ?? '' } : value;
  });
  const parsed = responseSchema.parse(decoded);
  const windows: RollupWindow[] = [];
  for (const point of parsed.rollupDataPoints ?? []) {
    const start = Date.parse(point.startTime), end = Date.parse(point.endTime);
    if (end - start !== windowSeconds * 1000 || (start / 1000) % windowSeconds !== 0) throw new Error('unexpected_window');
    const present = type === 'heart-rate' ? point.heartRate !== undefined : point.activeEnergyBurned !== undefined;
    if (!present) continue;
    windows.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), value: type === 'heart-rate' ? null : plainDecimal(point.activeEnergyBurned!.kcalSum.literal) });
  }
  if (new Set(windows.map((window) => window.start)).size !== windows.length) throw new Error('duplicate_window');
  return { windows, nextPageToken: parsed.nextPageToken || null };
}

/** One bounded page of ten-minute windows for the half-open UTC range [start, end). Unqualified source values from all sources. */
export async function windowRollupPage(input: { type: WindowRollupType; start: string; end: string; pageToken?: string }, accessToken: string, send: typeof fetch = fetch): Promise<WindowRollupPage> {
  const type = z.enum(windowRollupTypes).parse(input.type);
  z.iso.datetime().parse(input.start); z.iso.datetime().parse(input.end);
  const span = Date.parse(input.end) - Date.parse(input.start);
  if (!(span >= windowSeconds * 1000 && span <= maxWindowRangeDays * 86400000) || (Date.parse(input.start) / 1000) % windowSeconds !== 0 || (Date.parse(input.end) / 1000) % windowSeconds !== 0) throw new Error('invalid_range');
  if (!accessToken || accessToken.length > 16384 || (input.pageToken !== undefined && (input.pageToken.length === 0 || input.pageToken.length > 8192))) throw new Error('invalid_request');
  const body = { range: { startTime: new Date(input.start).toISOString(), endTime: new Date(input.end).toISOString() }, windowSize: `${windowSeconds}s`, pageSize: 10000, dataSourceFamily: 'users/me/dataSourceFamilies/all-sources', ...(input.pageToken ? { pageToken: input.pageToken } : {}) };
  const response = await send(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints:rollUp`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`google_http_${response.status}`);
  const rawJson = await readLimitedText(response);
  return { rawJson, ...parseWindowRollup(rawJson, type) };
}
