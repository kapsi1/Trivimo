import { useEffect, useState } from 'react';
import { z } from 'zod';
import { dayResponseSchema, daySnapshotSchema, userNoteSchema } from '../../../packages/contracts/day-snapshot.ts';
import { issueReasons } from '../../../packages/domain/data-issues.ts';

export type Snapshot = z.infer<typeof daySnapshotSchema>;
export type MetricKey = keyof Snapshot['metrics'];
export type MetricValue = Snapshot['metrics'][MetricKey];
export type Group = 'energy' | 'activity' | 'body';
export interface MetricDef { key: MetricKey; label: string; short: string; unit: string; decimals: number; group: Group; form: 'bar' | 'line'; definition: [string, string] }

/** Presentation precision (decision 2026-11-04): weight 0.1 kg, body fat 0.1 %, distance 0.01 km. */
export const metrics: MetricDef[] = [
  { key: 'weight', label: 'Masa ciała', short: 'Masa', unit: 'kg', decimals: 1, group: 'body', form: 'line', definition: ['weight_daily_mean', 'Średnia arytmetyczna unikalnych pomiarów danego dnia z Google Health API. Ostatnia waga nie jest przenoszona na dzień bez pomiaru.'] },
  { key: 'body_fat', label: 'Tkanka tłuszczowa', short: 'Tkanka', unit: '%', decimals: 1, group: 'body', form: 'line', definition: ['body_fat_daily_mean', 'Średnia unikalnych pomiarów procentowych dnia. Nie jest wyliczana z BMI ani z masy.'] },
  { key: 'steps', label: 'Kroki', short: 'Kroki', unit: '', decimals: 0, group: 'activity', form: 'bar', definition: ['steps_daily', 'Wartość dobowa producenta po uzgodnieniu źródeł. Kopie z kilku aplikacji nie są sumowane.'] },
  { key: 'distance', label: 'Dystans', short: 'Dystans', unit: 'km', decimals: 2, group: 'activity', form: 'bar', definition: ['distance_daily', 'Dzienny dystans producenta. Dystans nie jest zgadywany z kroków.'] },
  { key: 'total_energy', label: 'Spalone kalorie', short: 'Spalone', unit: 'kcal', decimals: 0, group: 'energy', form: 'bar', definition: ['total_energy_daily', 'Całkowity wydatek: energia bazowa i aktywna według modelu producenta. Doba z samą energią bazową nie wchodzi do porównań.'] },
  { key: 'active_energy', label: 'Aktywne kalorie', short: 'Aktywne', unit: 'kcal', decimals: 0, group: 'energy', form: 'bar', definition: ['active_energy_daily', 'Energia aktywności ponad bazową, według modelu producenta. Brak nie oznacza zera.'] },
];
export const metricOf = (key: MetricKey) => metrics.find((metric) => metric.key === key)!;
export const groups: Record<Group | 'food', { label: string; color: string }> = {
  energy: { label: 'Energia', color: 'var(--c-energy)' }, activity: { label: 'Aktywność', color: 'var(--c-activity)' },
  body: { label: 'Ciało', color: 'var(--c-body)' }, food: { label: 'Jedzenie', color: 'var(--c-food)' },
};
export const quality: Record<MetricValue['status'], string> = { valid: 'Potwierdzony', provisional: 'Częściowy', missing: 'Brak danych', incomplete: 'Niepełne dane', incomparable: 'Nieporównywalne', conflict: 'Konflikt danych', stale: 'Nieaktualny', unsupported: 'Nieobsługiwane', permission_denied: 'Brak uprawnień', source_error: 'Błąd źródła' };
export const energyModels: Record<NonNullable<Snapshot['energy']>['model'], string> = { current: 'Pełny model: okna 10-minutowe i kalorie aktywne.', legacy: 'Starszy model: kilka długich przedziałów na dobę, bez kalorii aktywnych i rozkładu godzinowego.', basal_only: 'Sama energia bazowa: stała stawka w oknach, brak kalorii aktywnych.', unknown: 'Nieustalony model producenta.' };
/** Reasons of a metric's status from the snapshot's active issues. */
export const reasonsOf = (snapshot: Snapshot | null | undefined, key: MetricKey) => (snapshot?.issues ?? []).filter((issue) => issue.metric === key && issue.state === 'active').map((issue) => issueReasons[issue.code]);
export const ruleOf = (snapshot: Snapshot | null | undefined, group: Group) => group === 'energy' ? snapshot?.energy?.rule ?? 'google-energy-v1' : group === 'activity' ? snapshot?.activity?.rule ?? 'google-activity-v1' : snapshot?.body?.rule ?? 'google-body-v1';

export const rangeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_ready') }),
  z.object({ state: z.literal('ready'), days: z.array(z.object({ date: z.iso.date(), snapshot: daySnapshotSchema.nullable(), userNote: userNoteSchema.nullable() })) }),
]);
export type DayRow = Extract<z.infer<typeof rangeSchema>, { state: 'ready' }>['days'][number];
export { dayResponseSchema, userNoteSchema };
const earliestDate = z.iso.date().nullable();
export const earliestSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_ready') }),
  z.object({ state: z.literal('ready'), metrics: z.object({ weight: earliestDate, body_fat: earliestDate, steps: earliestDate, distance: earliestDate, total_energy: earliestDate, active_energy: earliestDate }), heartRateRead: earliestDate }),
]);
export type Earliest = z.infer<typeof earliestSchema>;
/** First day with data in a scope: the earliest over the metrics ('hr' = first completed heart-rate read). undefined while loading, null when there is none. */
export function earliestOf(loaded: Loaded<Earliest>, keys: readonly (MetricKey | 'hr')[]): string | null | undefined {
  const data = loaded.data;
  if (!data) return loaded.error ? null : undefined;
  if (data.state !== 'ready') return null;
  const days = keys.map((key) => key === 'hr' ? data.heartRateRead : data.metrics[key]).filter((day): day is string => day !== null);
  return days.length ? days.reduce((a, b) => a < b ? a : b) : null;
}
export const bandRangeSchema = z.array(z.object({ date: z.iso.date(), totalWindows: z.number().int().positive(), heartRate: z.object({ windows: z.number().int().nonnegative() }).nullable() }));
export const bandShareSchema = z.object({
  totalWindows: z.number().int().positive(), heartRate: z.object({ windows: z.number().int().nonnegative() }).nullable(),
  activeEnergy: z.object({ bandKcal: z.string(), bandWindows: z.number().int(), otherKcal: z.string(), otherWindows: z.number().int() }).nullable(), activeEnergyRead: z.boolean(),
});
export const seriesSchema = z.object({ unit: z.enum(['steps', 'mm', 'kcal']), windowsPerDay: z.number(), windows: z.number(), hours: z.array(z.object({ start: z.iso.datetime(), value: z.string().nullable() })), slots: z.array(z.string().nullable()), total: z.string() }).nullable();
export type Series = z.infer<typeof seriesSchema>;
export const heartRateDaySchema = z.object({ dayWindows: z.number().int().positive(), windows: z.array(z.object({ start: z.iso.datetime(), avg: z.number(), min: z.number(), max: z.number() })) }).nullable();
export type HeartRateDay = z.infer<typeof heartRateDaySchema>;
export const heartRateRangeSchema = z.array(z.object({ date: z.iso.date(), read: z.boolean(), windows: z.number().int().nonnegative(), avg: z.number().nullable(), min: z.number().nullable(), max: z.number().nullable() }));
export type HeartRateSummary = z.infer<typeof heartRateRangeSchema>[number];
export const forecastSchema = z.object({ rule: z.enum(['prognoza-bez-wysilku-v2', 'prognoza-spoczynek-v0']), burnedKcal: z.number(), asOf: z.iso.datetime(), remainingWindows: z.number().int(), forecastKcal: z.number(), floorKcal: z.number().nullable(), restRateKcalPerHour: z.number().nullable(), restWindows: z.number().int().nullable(), historyDays: z.number().int().nullable(), windowKcal: z.array(z.number()) }).nullable();
export type Forecast = z.infer<typeof forecastSchema>;
export const dailyReviewSchema = z.object({
  rows: z.array(z.object({ originalValue: z.string(), unit: z.enum(['steps', 'mm', 'kcal']), converted: z.object({ value: z.string(), unit: z.enum(['szt.', 'km', 'kcal']) }).nullable(), receivedAt: z.string(), jobStartedAt: z.string().optional(), state: z.enum(['running', 'complete']).optional() })),
  truncated: z.boolean(), coverage: z.literal('unknown'), multipleAccounts: z.boolean(),
  jobs: z.array(z.object({ start: z.string(), end: z.string(), state: z.enum(['running', 'complete']) })),
});
export const syncStatusSchema = z.object({
  automatic: z.number().nullable(), running: z.boolean(), unfinishedJobs: z.number(), pausedUntil: z.string().nullable(),
  last: z.object({ at: z.string(), result: z.enum(['ok', 'authorization_required', 'scope_missing', 'migration_required', 'error']), code: z.string().optional(), reads: z.number(), reconciled: z.number().optional(), retryAt: z.string().optional() }).nullable(),
  kinds: z.array(z.object({ kind: z.string(), lastReadAt: z.string().nullable(), coveredThrough: z.string().nullable() })),
  // only the fields the global notice needs; the Coverage view reads the full backfill status itself
  backfill: z.object({ state: z.enum(['idle', 'running', 'stopping', 'stopped', 'done', 'error']), from: z.string(), finishedAt: z.string().nullable(), code: z.string().optional() }).optional(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export const coverageSchema = z.object({ from: z.iso.date(), through: z.iso.date(), kinds: z.number().int().positive(), days: z.array(z.object({ date: z.iso.date(), covered: z.number().int().nonnegative() })) });

/** State of one GET: undefined while loading, `error` on failure (the view says so), never a silent empty value. */
export type Loaded<T> = { data: T; error: false } | { data: undefined; error: boolean };
export function useJson<T>(url: string | null, schema: z.ZodType<T>, refresh = 0): Loaded<T> {
  const [state, setState] = useState<{ url: string | null; result: Loaded<T> }>({ url: null, result: { data: undefined, error: false } });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState((current) => current.url === url ? current : { url, result: { data: undefined, error: false } });
    fetch(url, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then((data: unknown) => setState({ url, result: { data: schema.parse(data), error: false } }))
      .catch(() => { if (!controller.signal.aborted) setState({ url, result: { data: undefined, error: true } }); });
    return () => controller.abort();
  }, [url, refresh]);
  return state.url === url ? state.result : { data: undefined, error: false };
}
/** The server answers at most 366 days at a time: split an inclusive date range into consecutive chunks of that size. */
export function dateChunks(from: string, to: string, span = 366): [string, string][] {
  const chunks: [string, string][] = [];
  const day = 86400000, last = Date.parse(to);
  for (let start = Date.parse(from); start <= last; start += span * day) chunks.push([new Date(start).toISOString().slice(0, 10), new Date(Math.min(start + (span - 1) * day, last)).toISOString().slice(0, 10)]);
  return chunks;
}
/** Like useJson, but for a date range longer than the server limit: fetches the chunks together and hands them to `merge` in date order. */
export function useChunkedJson<T, R>(path: string | null, from: string, to: string, schema: z.ZodType<T>, merge: (parts: T[]) => R): Loaded<R> {
  const [state, setState] = useState<{ key: string | null; result: Loaded<R> }>({ key: null, result: { data: undefined, error: false } });
  const key = path ? `${path}|${from}|${to}` : null;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((current) => current.key === key ? current : { key, result: { data: undefined, error: false } });
    Promise.all(dateChunks(from, to).map(([start, end]) => fetch(`${path}?from=${start}&to=${end}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then((data: unknown) => schema.parse(data))))
      .then((parts) => setState({ key, result: { data: merge(parts), error: false } }))
      .catch(() => { if (!controller.signal.aborted) setState({ key, result: { data: undefined, error: true } }); });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.result : { data: undefined, error: false };
}
export async function post(path: string, body: object): Promise<Response> {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify(body) });
}
/** Readable name of who supplied the records: the app that counted them and, when known, the device. */
/** Whose estimate the calories are (decision of 2026-11-03), from the share of windows with heart rate. */
export function energySource(windows: number | null | undefined, total: number): string {
  if (windows === null || windows === undefined) return 'nieustalone (brak odczytu tętna)';
  if (windows === 0) return 'telefon';
  if (windows >= total) return 'opaska';
  return 'mieszane';
}
