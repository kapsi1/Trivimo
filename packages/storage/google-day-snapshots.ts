import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { agreedValues, dailySummaryTypes, groupByDay, parseDailySummary, type DailySummaryType } from '../adapters/google-health/daily-summary.ts';
import { parseDailyRollup, type DailyRollupType } from '../adapters/google-health/daily-rollup.ts';
import { snapshotInputSchema, type DaySnapshotInput } from '../contracts/day-snapshot.ts';
import { csvMetrics, type CsvMetric } from '../contracts/csv-import.ts';
import { toText } from '../domain/rational.ts';
import { csvDayValues } from './csv-imports.ts';
import type { ActivityEvidence } from '../domain/activity-qualification.ts';
import { classifyEnergyModel, type EnergyEvidence } from '../domain/energy-qualification.ts';
import { mergeReplicas, type SourceMeasurement } from '../domain/measurement-replicas.ts';
import { projectGoogleDay, type BodyDayEvidence } from '../domain/project-day.ts';
import { parseSourceValue } from '../domain/source-units.ts';
import type { BodyCandidate } from '../domain/body-daily.ts';
import { dayBounds, defaultDayZone } from '../domain/day-zone.ts';
import { readDayZone } from './day-zone.ts';
import { readBandShareRange, savedWindows, type Day } from './google-band-share-day.ts';
import { publishCanonicalDay, readCanonicalDay } from './canonical-days.ts';
import { millimetresToKm } from './google-daily-source-day.ts';

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Newest complete read of a daily kind for each date of [from, to]: its value (null when read with no point) and when it was read. */
function savedDailyValues(db: DatabaseSync, kind: DailyRollupType, from: string, to: string): Map<string, { value: string | null; readAt: number }> {
  const claimed = new Map<string, { value: string | null; readAt: number }>();
  const pages = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  for (const job of db.prepare("SELECT id, range_start, range_end, created_at FROM google_read_jobs WHERE kind = ? AND state = 'complete' AND range_start <= ? AND range_end > ? ORDER BY created_at DESC, id").iterate(kind, to, from)) {
    const first = String(job.range_start) < from ? from : String(job.range_start);
    const needed: string[] = [];
    for (let day = first; day < String(job.range_end) && day <= to; day = addDays(day, 1)) if (!claimed.has(day)) needed.push(day);
    if (needed.length === 0) continue;
    const values = new Map<string, string>();
    for (const page of pages.iterate(job.id)) {
      if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
      for (const day of parseDailyRollup(page.raw_json, kind).days) values.set(day.date, day.value);
    }
    for (const day of needed) claimed.set(day, { value: values.get(day) ?? null, readAt: Date.parse(String(job.created_at)) });
  }
  return claimed;
}

type SummaryRead = { status: 'value'; values: Record<string, string> } | { status: 'conflict'; candidates: Record<string, string>[] } | { status: 'agreed'; values: Record<string, string>; candidates: Record<string, string>[] } | { status: 'absent' };
/** Newest complete read of a daily summary kind covering each date of [from, to] decides it: a point, or absence after a complete read. An unread date is absent from the map. */
function savedDailySummaries(db: DatabaseSync, kind: DailySummaryType, from: string, to: string): Map<string, SummaryRead> {
  const claimed = new Map<string, SummaryRead>();
  const pages = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  for (const job of db.prepare("SELECT id, range_start, range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' AND range_start <= ? AND range_end > ? ORDER BY created_at DESC, id").iterate(kind, to, from)) {
    const first = String(job.range_start) < from ? from : String(job.range_start);
    const needed: string[] = [];
    for (let day = first; day < String(job.range_end) && day <= to; day = addDays(day, 1)) if (!claimed.has(day)) needed.push(day);
    if (needed.length === 0) continue;
    const points: { date: string; values: Record<string, string> }[] = [];
    for (const page of pages.iterate(job.id)) {
      if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
      points.push(...parseDailySummary(page.raw_json, kind).days);
    }
    const grouped = groupByDay(points);
    for (const day of needed) {
      const state = grouped.get(day);
      const agreed = state?.status === 'conflict' ? agreedValues(kind, state.candidates) : null;
      claimed.set(day, state === undefined ? { status: 'absent' } : state.status === 'conflict' && agreed ? { status: 'agreed', values: agreed, candidates: state.candidates } : state);
    }
  }
  return claimed;
}

/**
 * Measurements of each day (in the day zone) from the newest complete read whose UTC range covers the whole day; values keep their
 * source text (grams converted to kg by shifting the decimal point). An unread day is absent.
 */
function savedMeasurements(db: DatabaseSync, kind: 'weight' | 'body-fat', days: Day[]): Map<string, { records: SourceMeasurement[]; invalid: string[]; readAt: number }> {
  const claimed = new Map<string, { records: SourceMeasurement[]; invalid: string[]; readAt: number }>();
  const field = kind === 'weight' ? 'weight' : 'bodyFat', valueKey = kind === 'weight' ? 'weightGrams' : 'percentage';
  const pages = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  if (days.length === 0) return claimed;
  // only jobs that can cover one of the days, so reads of other years never push relevant ones past the limit
  for (const job of db.prepare("SELECT id, range_start, range_end, created_at FROM google_read_jobs WHERE kind = ? AND state = 'complete' AND julianday(range_start) <= julianday(?) AND julianday(range_end) >= julianday(?) ORDER BY created_at DESC, id LIMIT 500").all(kind, new Date(days.at(-1)!.start).toISOString(), new Date(days[0]!.end).toISOString())) {
    const from = Date.parse(String(job.range_start)), to = Date.parse(String(job.range_end));
    const needed = days.filter((day) => !claimed.has(day.date) && from <= day.start && to >= day.end);
    if (needed.length === 0) continue;
    const records: (SourceMeasurement & { valid: boolean })[] = [];
    for (const page of pages.iterate(job.id)) {
      if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
      // the value is a JSON number; keep its source text so no float rounding enters the mean
      const decoded = JSON.parse(page.raw_json, function (key: string, value: unknown, context?: { source?: string }) { return key === valueKey && typeof value === 'number' ? context?.source ?? '' : value; }) as { dataPoints?: Record<string, any>[] };
      for (const point of decoded.dataPoints ?? []) {
        const time = Date.parse(String(point[field]?.sampleTime?.physicalTime)), literal = String(point[field]?.[valueKey] ?? '');
        if (!Number.isFinite(time) || typeof point.name !== 'string' || !point.name) { records.push({ id: `invalid-${records.length}`, time: Number.isFinite(time) ? time : 0, value: '', valid: false }); continue; }
        const parsed = parseSourceValue(kind === 'weight' ? 'weight' : 'body_fat', literal);
        records.push({ id: point.name, time, value: parsed.status === 'parsed' ? parsed.value : '', valid: parsed.status === 'parsed' });
      }
    }
    for (const day of needed) {
      const own = records.filter((record) => record.time >= day.start && record.time < day.end);
      claimed.set(day.date, { records: own.filter((record) => record.valid).map(({ id, time, value }) => ({ id, time, value })), invalid: own.filter((record) => !record.valid).map((record) => record.id), readAt: Date.parse(String(job.created_at)) });
    }
  }
  return claimed;
}

/** Exact sum of integer window values (steps, millimetres); null when the windows of the day were not read. */
function windowSum(windows: { value: string | null }[] | undefined): bigint | null {
  return windows ? windows.reduce((sum, window) => sum + BigInt(window.value ?? '0'), 0n) : null;
}

/**
 * Day snapshots from saved Google pages for the read days of [from, to]; a day never read gets no snapshot.
 * Calories follow rule google-energy-v1 (the band share marks whose estimate it is). Steps and distance follow
 * google-activity-v1: the producer's all-sources daily value, which on 2026 data equals the band on days with it and
 * one phone source otherwise, never a sum of replicas; it counts for the day when the day's ten-minute windows
 * sum to it exactly (for a day in progress the relation checked on completed days is assumed).
 */
export function projectGoogleDays(db: DatabaseSync, from: string, to: string, nowMs: number): DaySnapshotInput[] {
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new Error('range_too_large');
  const zone = readDayZone(db), days: Day[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) { const bounds = dayBounds(date, zone); days.push({ date, start: Date.parse(bounds.start), end: Date.parse(bounds.end) }); }
  const total = savedDailyValues(db, 'total-calories', from, to);
  const steps = savedDailyValues(db, 'steps', from, to), distance = savedDailyValues(db, 'distance', from, to);
  const stepWindows = savedWindows(db, 'steps-10m', 'steps', days), distanceWindows = savedWindows(db, 'distance-10m', 'distance', days);
  const weights = savedMeasurements(db, 'weight', days), bodyFats = savedMeasurements(db, 'body-fat', days);
  const active = savedDailyValues(db, 'active-energy-burned', from, to);
  const windows = savedWindows(db, 'total-calories-10m', 'total-calories', days);
  const summaries = dailySummaryTypes.map((type) => [type, savedDailySummaries(db, type, from, to)] as const);
  const band = new Map(readBandShareRange(db, from, to).map((day) => [day.date, day]));
  const snapshots: DaySnapshotInput[] = [];
  for (const day of days) {
    const totalRead = total.get(day.date), stepsRead = steps.get(day.date), distanceRead = distance.get(day.date);
    const weightRead = weights.get(day.date), bodyFatRead = bodyFats.get(day.date);
    if (!totalRead && !stepsRead && !distanceRead && !weightRead && !bodyFatRead) continue;
    const progressOf = (read: { readAt: number } | undefined) => nowMs < day.end ? 'ongoing' as const : read && read.readAt < day.end ? 'read_before_end' as const : 'complete' as const;
    const matches = (read: { value: string | null } | undefined, windows: bigint | null) => read?.value == null || windows === null ? null : BigInt(read.value) === windows;
    const stepsMatch = matches(stepsRead, windowSum(stepWindows.get(day.date))), distanceMatch = matches(distanceRead, windowSum(distanceWindows.get(day.date)));
    const activity = (kind: 'steps' | 'distance', read: { value: string | null; readAt: number } | undefined, match: boolean | null): ActivityEvidence => ({
      kind, value: read?.value == null ? null : kind === 'distance' ? millimetresToKm(read.value) : read.value, unit: kind === 'steps' ? 'count' : 'km',
      reconciliation: 'confirmed', sourceFamily: 'resolved', coverage: 'confirmed', day: progressOf(read), zeroConfirmed: read?.value != null,
      dayBoundary: nowMs < day.end || match === true ? 'zone_interval' : match === false ? 'producer_day_unmatched' : 'unknown',
    });
    const share = band.get(day.date)!; const activeRead = active.get(day.date);
    // without a read of the day's windows the model cannot be told, so the day is not comparable until they are read;
    // a day read in progress is compared with the windows that had passed by the read, not with the whole day
    const dayWindows = windows.get(day.date);
    const passed = Math.max(1, Math.min(share.totalWindows, Math.floor((Math.min(day.end, totalRead?.readAt ?? day.end, nowMs) - day.start) / 600000)));
    const classified = dayWindows && totalRead ? classifyEnergyModel({ windowValues: dayWindows.flatMap((window) => window.value === null ? [] : [window.value]), dayWindows: passed, active: activeRead?.value == null ? 'absent' : /[1-9]/.test(activeRead.value) ? 'positive' : 'zero' }) : 'unknown';
    const heart = share.heartRate?.windows ?? null;
    const origin = heart === null ? 'unknown' : heart === 0 ? 'phone' : heart === share.totalWindows ? 'wearable' : 'mixed';
    // A day is final only when it has ended and its newest read was made afterwards; earlier reads stay provisional.
    const progress = progressOf(totalRead);
    // early in a day only the basal rate has accrued (and the producer may not report active energy yet): an unfinished
    // day is never declared basal-only; it is judged again once it has ended
    const model = classified === 'basal_only' && progress !== 'complete' ? 'current' : classified;
    const evidence = (kind: 'total' | 'active', read: { value: string | null } | undefined): EnergyEvidence => ({
      kind, value: read?.value ?? null, unit: 'kcal', origin, coverage: 'confirmed', day: progress, zeroConfirmed: read?.value != null,
      definition: model === 'basal_only' ? (kind === 'total' ? 'basal_only' : 'active_above_basal') : model === 'unknown' ? 'unknown' : kind === 'total' ? 'total_including_basal' : 'active_above_basal',
      ...(model === 'legacy' ? { model: 'legacy' as const } : {}),
    });
    // an unparsable value makes the day's mean invalid (a conflict with a note) instead of being dropped silently
    const body = (read: { records: SourceMeasurement[]; invalid: string[]; readAt: number } | undefined, tolerance: string) => {
      if (!read) return { evidence: { candidates: null, day: progressOf(undefined) } satisfies BodyDayEvidence, records: null, replicas: null };
      const merged = mergeReplicas(read.records, tolerance);
      const candidates: BodyCandidate[] = [...merged.candidates, ...read.invalid.map((identity) => ({ identity, value: 'invalid', decision: 'accepted' as const }))];
      return { evidence: { candidates, day: progressOf(read) } satisfies BodyDayEvidence, records: read.records.length + read.invalid.length, replicas: merged.replicas };
    };
    const weight = body(weightRead, '0.001'), bodyFat = body(bodyFatRead, '0.01');
    const summaryItems = summaries.flatMap(([type, reads]) => { const read = reads.get(day.date); return read ? [{ type, ...read }] : []; });
    snapshots.push({ ...projectGoogleDay({
      date: day.date, weight: weight.evidence, bodyFat: bodyFat.evidence,
      body: { rule: 'google-body-v1', weightRecords: weight.records, weightReplicas: weight.replicas, bodyFatRecords: bodyFat.records, bodyFatReplicas: bodyFat.replicas },
      steps: activity('steps', stepsRead, stepsMatch), distance: activity('distance', distanceRead, distanceMatch),
      totalEnergy: evidence('total', totalRead), activeEnergy: evidence('active', activeRead),
      activity: { rule: 'google-activity-v1', stepsMatchWindows: stepsMatch, distanceMatchWindows: distanceMatch },
      energy: { rule: 'google-energy-v1', model, heartRateWindows: heart, dayWindows: share.totalWindows, activeWithHeartRateKcal: share.activeEnergy?.bandKcal ?? null, activeWithoutHeartRateKcal: share.activeEnergy?.otherKcal ?? null },
    }), zone, ...(summaryItems.length ? { summaries: { rule: 'google-daily-summaries-v2' as const, items: summaryItems } } : {}) });
  }
  return snapshots;
}

const missing = { status: 'missing' as const, value: null };
/**
 * Google projection with CSV imports filling only metrics the Google data left missing (rule csv-fill-v1): a Google
 * value, also an incomparable or conflicting one, is never replaced or added to. A CSV conflict is a conflict of the day.
 */
export function projectDays(db: DatabaseSync, from: string, to: string, nowMs: number): DaySnapshotInput[] {
  const zone = readDayZone(db), google = projectGoogleDays(db, from, to, nowMs), csv = csvDayValues(db, from, to);
  if (csv.size === 0) return google;
  const byDate = new Map(google.map((day) => [day.date, day]));
  for (const date of csv.keys()) if (!byDate.has(date)) byDate.set(date, { date, metrics: { weight: missing, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing }, issues: [], zone });
  return [...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1).map((day) => {
    const values = csv.get(day.date);
    if (!values) return day;
    const metrics = { ...day.metrics }, issues = [...day.issues], filled: CsvMetric[] = [], imports = new Set<string>();
    for (const metric of csvMetrics) {
      const value = values[metric];
      if (!value || metrics[metric].status !== 'missing') continue;
      metrics[metric] = value.status === 'valid' ? { status: 'valid', value: toText(value.value) } : { status: 'conflict', value: null };
      if (value.status === 'conflict') issues.push({ metric, code: 'identity_conflict', state: 'active' });
      filled.push(metric); value.imports.forEach((id) => imports.add(id));
    }
    return filled.length ? snapshotInputSchema.parse({ ...day, metrics, issues, csv: { rule: 'csv-fill-v1', metrics: filled, imports: [...imports].sort() } }) : day;
  });
}

/** What a day's snapshot says (everything except its revision and the notes derived from issues). */
const content = (day: DaySnapshotInput) => JSON.stringify({ metrics: day.metrics, issues: day.issues, energy: day.energy, activity: day.activity, body: day.body, summaries: day.summaries, csv: day.csv, zone: day.zone ?? defaultDayZone });

/**
 * Publish a new revision only for days whose projection changed; values, issues and evidence move together. A day
 * whose published values came only from CSV imports that are no longer included gets an empty revision (history kept).
 */
export function publishGoogleDays(db: DatabaseSync, from: string, to: string, nowMs: number): { published: number; unchanged: number } {
  let published = 0, unchanged = 0;
  const projected = projectDays(db, from, to, nowMs), dates = new Set(projected.map((day) => day.date));
  // a day whose newest snapshot was cut in another zone and has no projection in the current one is not carried over as is
  const zone = readDayZone(db);
  const cleared = db.prepare("SELECT day FROM daily_snapshots s WHERE day >= ? AND day <= ? AND revision = (SELECT MAX(revision) FROM daily_snapshots t WHERE t.day = s.day) AND (json_extract(payload, '$.csv') IS NOT NULL OR COALESCE(json_extract(payload, '$.zone'), ?) != ?)").all(from, to, defaultDayZone, zone)
    .map((row) => String(row.day)).filter((day) => !dates.has(day))
    .map((date): DaySnapshotInput => ({ date, metrics: { weight: missing, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing }, issues: [], zone }));
  for (const snapshot of [...projected, ...cleared]) {
    const current = readCanonicalDay(db, snapshot.date);
    if (current && content(current) === content(snapshot)) { unchanged++; continue; }
    publishCanonicalDay(db, snapshot, current?.revision ?? null); published++;
  }
  return { published, unchanged };
}

/** `publishGoogleDays` over a range of any length, one year at a time (history before the refresh window). */
export function publishDayRange(db: DatabaseSync, from: string, to: string, nowMs: number): { published: number; unchanged: number } {
  const total = { published: 0, unchanged: 0 };
  for (let first = from; first <= to; first = addDays(first, 365)) {
    const last = addDays(first, 364) < to ? addDays(first, 364) : to;
    const part = publishGoogleDays(db, first, last, nowMs);
    total.published += part.published; total.unchanged += part.unchanged;
  }
  return total;
}

/**
 * `publishGoogleDays` over [from, to] in steps of `stepDays`, yielding to other work between steps (server). Every day
 * is published on its own, so the steps give the same snapshots as one call; a failure keeps the days already published.
 */
export async function publishDayRangeYielding(db: DatabaseSync, from: string, to: string, nowMs: number, stepDays = 31): Promise<{ published: number; unchanged: number }> {
  const total = { published: 0, unchanged: 0 };
  for (let first = from; first <= to; first = addDays(first, stepDays)) {
    const last = addDays(first, stepDays - 1) < to ? addDays(first, stepDays - 1) : to;
    const part = publishGoogleDays(db, first, last, nowMs);
    total.published += part.published; total.unchanged += part.unchanged;
    await nextTurn();
  }
  return total;
}

/**
 * Restore check: the projection rebuilt from the saved originals must equal the newest published snapshot of every
 * day up to `to` (rules of this code version). `nowMs` is the moment of the copy, so day progress is judged as it was.
 */
export function compareGoogleDays(db: DatabaseSync, from: string, to: string, nowMs: number): { matched: number; differing: string[]; unpublished: string[] } {
  const result = { matched: 0, differing: [] as string[], unpublished: [] as string[] };
  for (const snapshot of projectDays(db, from, to, nowMs)) {
    const current = readCanonicalDay(db, snapshot.date);
    if (!current) result.unpublished.push(snapshot.date);
    else if (content(current) === content(snapshot)) result.matched++;
    else result.differing.push(snapshot.date);
  }
  return result;
}
