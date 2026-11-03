import { z } from 'zod';
import { googleHttpError } from './rate-limit.ts';
import { readLimitedText } from './limited-json.ts';

/**
 * Who supplied the records of a day: `list` of each record with only its data source and civil start date (`fields`),
 * which keeps about 200 bytes per record. Checked 2026-11-03 on the account: platform, application package, device and
 * recording method are present; the values themselves are not read.
 */
export const sourceListTypes = { 'steps-sources': { type: 'steps', field: 'steps', filter: 'steps' }, 'active-energy-sources': { type: 'active-energy-burned', field: 'activeEnergyBurned', filter: 'active_energy_burned' } } as const;
export type SourceListKind = keyof typeof sourceListTypes;
export const isSourceListKind = (kind: string): kind is SourceListKind => kind in sourceListTypes;
export const maxSourceListDays = 14;
const pageSize = 2000;

const text = z.string().max(200).optional();
const sourceSchema = z.object({
  platform: text, recordingMethod: text,
  application: z.object({ packageName: text, webClientId: text, displayName: text }).passthrough().optional(),
  device: z.object({ manufacturer: text, model: text, displayName: text, formFactor: text }).passthrough().optional(),
}).passthrough();
const civilDate = z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() });
const responseSchema = z.object({ dataPoints: z.array(z.record(z.string(), z.unknown())).max(pageSize).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();

export interface DataSource { platform: string | null; application: string | null; device: string | null; recordingMethod: string | null }
export interface DaySourceCount { date: string; source: DataSource; records: number }

const key = (date: z.infer<typeof civilDate>) => `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

/** Pure: record counts per civil date and data source; a record without a source is counted as an unknown source. */
export function parseSourceList(rawJson: string, kind: SourceListKind): { days: DaySourceCount[]; nextPageToken: string | null } {
  const parsed = responseSchema.parse(JSON.parse(rawJson) as unknown);
  const counts = new Map<string, DaySourceCount>();
  for (const point of parsed.dataPoints ?? []) {
    const interval = z.object({ interval: z.object({ civilStartTime: z.object({ date: civilDate }) }) }).passthrough().parse(point[sourceListTypes[kind].field]);
    const raw = sourceSchema.parse(point.dataSource ?? {});
    const device = raw.device ? [raw.device.manufacturer, raw.device.displayName ?? raw.device.model, raw.device.formFactor].filter(Boolean).join(' ') || null : null;
    const source: DataSource = { platform: raw.platform ?? null, application: raw.application?.packageName ?? raw.application?.displayName ?? raw.application?.webClientId ?? null, device, recordingMethod: raw.recordingMethod ?? null };
    const date = key(interval.interval.civilStartTime.date); const id = JSON.stringify([date, source]);
    const entry = counts.get(id) ?? { date, source, records: 0 };
    entry.records++; counts.set(id, entry);
  }
  return { days: [...counts.values()], nextPageToken: parsed.nextPageToken || null };
}

/** One page of records whose civil start falls in the half-open civil-date range [start, end). */
export async function sourceListPage(input: { kind: SourceListKind; start: string; end: string; pageToken?: string }, accessToken: string, send: typeof fetch = fetch): Promise<{ rawJson: string; days: DaySourceCount[]; nextPageToken: string | null }> {
  const spec = sourceListTypes[z.enum(Object.keys(sourceListTypes) as [SourceListKind, ...SourceListKind[]]).parse(input.kind)];
  z.iso.date().parse(input.start); z.iso.date().parse(input.end);
  const span = (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86400000;
  if (!(span >= 1 && span <= maxSourceListDays)) throw new Error('invalid_range');
  if (!accessToken || accessToken.length > 16384 || (input.pageToken !== undefined && (input.pageToken.length === 0 || input.pageToken.length > 8192))) throw new Error('invalid_request');
  const url = new URL(`https://health.googleapis.com/v4/users/me/dataTypes/${spec.type}/dataPoints`);
  url.searchParams.set('filter', `${spec.filter}.interval.civil_start_time >= "${input.start}T00:00:00" AND ${spec.filter}.interval.civil_start_time < "${input.end}T00:00:00"`);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('fields', `dataPoints(dataSource,${spec.field}(interval(civilStartTime(date)))),nextPageToken`);
  url.searchParams.set('prettyPrint', 'false');
  if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
  const response = await send(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw googleHttpError('google_http', response);
  const rawJson = await readLimitedText(response);
  return { rawJson, ...parseSourceList(rawJson, input.kind) };
}
