import { warsawDay } from '../../../packages/domain/warsaw-day.ts';
import { metricOf, type DayRow, type Forecast, type HeartRateDay, type HeartRateSummary, type MetricKey, type Series, type Snapshot } from './api.ts';
import { energyTip, weekTitle, type AxisEvent, type HourKey, type HourPoint, type HrTrendPt, type HrWindow, type TrendPt } from './charts.tsx';
import { addDays, fmtDL, formatRational, hourOf, mondayOf, nf, timeOf, toNumber } from './format.ts';
import { trendPoints } from './trends.ts';

/** A day's value as a number for charts and means: only valid or provisional values count, anything else is a gap. */
export function valueOf(snapshot: Snapshot | null | undefined, key: MetricKey): number | null {
  const item = snapshot?.metrics[key];
  return item?.value && (item.status === 'valid' || item.status === 'provisional') ? toNumber(item.value) : null;
}
/** Mean over confirmed days of [from, to] with how many had a value: never a mean that treats gaps as zeros. */
export function meanValid(rows: readonly DayRow[], key: MetricKey, from: string, to: string) {
  let sum = 0, n = 0, total = 0;
  for (const row of rows) {
    if (row.date < from || row.date > to) continue;
    total++;
    const item = row.snapshot?.metrics[key];
    if (item?.status === 'valid' && item.value) { sum += toNumber(item.value); n++; }
  }
  return { mean: n ? sum / n : null, n, total };
}
/** Newest confirmed measurement on or before a day: shown with its date, never carried over as that day's value. */
export function lastMeasured(rows: readonly DayRow[], key: MetricKey, onOrBefore: string): { date: string; value: number } | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!; const item = row.snapshot?.metrics[key];
    if (row.date <= onOrBefore && item?.status === 'valid' && item.value) return { date: row.date, value: toNumber(item.value) };
  }
  return null;
}

/** Short tooltip of a day's value: date and value with unit; for calories the estimate source and today's forecast. */
export function dayTip(row: DayRow | undefined, date: string, key: MetricKey, forecast?: Forecast): string[] {
  const metric = metricOf(key), value = valueOf(row?.snapshot, key);
  const lines = [fmtDL(date), value === null ? '—' : `${nf(value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ''}`];
  if (key === 'total_energy' && forecast) lines.push(`Prognoza: ${nf(forecast.forecastKcal)} kcal`);
  const energy = row?.snapshot?.energy;
  if (metric.group === 'energy' && value !== null && energy) lines.push(...energyTip(energy.heartRateWindows, energy.dayWindows));
  return lines;
}

const hourMetric: Record<HourKey, MetricKey> = { total: 'total_energy', active: 'active_energy', steps: 'steps', distance: 'distance' };
/**
 * Day total shown beside an hourly chart: the producer's daily value (same number as the card and the table) when the
 * snapshot has one; otherwise the sum of the hours, marked as computed. Null when neither exists.
 */
export function dayTotal(snapshot: Snapshot | null | undefined, key: HourKey, hours: readonly HourPoint[]): { text: string; computed: boolean } | null {
  const metric = metricOf(hourMetric[key]), unit = metric.unit || 'kroków', value = snapshot?.metrics[metric.key].value;
  if (value) return { text: `${formatRational(value, metric.decimals)} ${unit}`, computed: false };
  const values = hours.flatMap((hour) => hour[key] === null ? [] : [hour[key]!]);
  if (!values.length) return null;
  return { text: `${nf(values.reduce((sum, item) => sum + item, 0), metric.decimals)} ${unit}`, computed: true };
}

export interface DayHours { hours: HourPoint[]; hr: HrWindow[]; slots: number; dayStart: number }
const seriesValue = (value: string | null, unit: string) => value === null ? null : unit === 'mm' ? Number(value) / 1e6 : Number(value);
/**
 * Hours of a Warsaw day (23 or 25 across DST) from the saved ten-minute series. For the day in progress, hours after the
 * last read are future; the resting forecast fills them at its rate (own derivation, never a producer value).
 */
export function dayHours(date: string, series: Partial<Record<HourKey, Series>>, heart: HeartRateDay | undefined, forecast: Forecast | undefined, today: boolean): DayHours {
  const bounds = warsawDay(date), dayStart = Date.parse(bounds.start), dayEnd = Date.parse(bounds.end);
  const count = Math.round((dayEnd - dayStart) / 3600000), slots = count * 6;
  const asOf = today ? (forecast ? Date.parse(forecast.asOf) : Date.now()) : Infinity;
  const rate = forecast ? forecast.restRateKcalPerHour : null;
  const hr: HrWindow[] = (heart?.windows ?? []).map((window) => {
    const start = Date.parse(window.start);
    return { index: Math.round((start - dayStart) / 600000), label: `${timeOf(start)}–${timeOf(start + 600000)}`, avg: window.avg, min: window.min, max: window.max };
  });
  const byKey = (key: HourKey, index: number) => { const item = series[key]; return item ? seriesValue(item.hours[index]?.value ?? null, item.unit) : null; };
  const hours: HourPoint[] = [];
  for (let index = 0; index < count; index++) {
    const start = dayStart + index * 3600000, end = start + 3600000;
    const label = hourOf(start), repeat = index > 0 && hourOf(start - 3600000) === label;
    const inHour = hr.filter((window) => window.index >= index * 6 && window.index < index * 6 + 6);
    const futureMs = today ? Math.max(0, end - Math.max(start, asOf)) : 0;
    hours.push({
      start, label: `${label}${repeat ? '′' : ''}`, range: `${timeOf(start)}–${timeOf(end)}${repeat ? ' (drugi raz, czas zimowy)' : ''}`,
      total: byKey('total', index), active: byKey('active', index), steps: byKey('steps', index), distance: byKey('distance', index),
      fc: rate !== null && futureMs > 0 ? rate * futureMs / 3600000 : null, future: start >= asOf, now: start < asOf && asOf < end,
      hrWindows: heart ? inHour.length : null, hrAvg: inHour.length ? inHour.reduce((sum, window) => sum + window.avg, 0) / inHour.length : null,
    });
  }
  return { hours, hr, slots, dayStart };
}

/** Day-level heart-rate values for presentation: min, max and mean of window means (not resting heart rate). */
export const hrOf = (summary: HeartRateSummary | undefined) => summary && summary.avg !== null ? { avg: summary.avg, min: summary.min!, max: summary.max!, n: summary.windows } : null;

/** Points of one metric over days or ISO weeks (mean of confirmed days; a week with fewer such days is paler). */
export function metricTrend(rows: readonly DayRow[], key: MetricKey, agg: 'day' | 'week', forecast?: Forecast): TrendPt[] {
  const metric = metricOf(key), byDate = new Map(rows.map((row) => [row.date, row]));
  const days = trendPoints(rows, key).map((point) => ({ ...point, legacy: key === 'total_energy' && point.legacy, tip: dayTip(byDate.get(point.date), point.date, key, rows.at(-1)?.date === point.date ? forecast : undefined) }));
  if (agg === 'day') return days;
  const weeks = new Map<string, typeof days>();
  for (const point of days) { const monday = mondayOf(point.date); weeks.set(monday, [...(weeks.get(monday) ?? []), point]); }
  return [...weeks].map(([monday, points]) => {
    const ok = points.filter((point) => point.value !== null && !point.provisional);
    const value = ok.length ? ok.reduce((sum, point) => sum + point.value!, 0) / ok.length : null;
    return { date: monday, value, provisional: ok.length < points.length && ok.length > 0, legacy: points.some((point) => point.legacy), coverage: ok.length / points.length,
      tip: [weekTitle(monday), value === null ? '—' : `śr. ${nf(value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ''}`, `${ok.length} z ${points.length} dób z wartością`] };
  });
}
export function heartTrend(summaries: readonly HeartRateSummary[], from: string, to: string, agg: 'day' | 'week'): HrTrendPt[] {
  const byDate = new Map(summaries.map((item) => [item.date, item]));
  const days: HrTrendPt[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const value = hrOf(byDate.get(date));
    days.push({ date, avg: value?.avg ?? null, min: value?.min ?? null, max: value?.max ?? null, tip: [fmtDL(date), value ? `śr. ${nf(value.avg)} bpm` : '—', value ? `${nf(value.min)}–${nf(value.max)} bpm` : ''] });
  }
  if (agg === 'day') return days;
  const weeks = new Map<string, HrTrendPt[]>();
  for (const point of days) { const monday = mondayOf(point.date); weeks.set(monday, [...(weeks.get(monday) ?? []), point]); }
  return [...weeks].map(([monday, points]) => {
    const ok = points.filter((point) => point.avg !== null);
    if (!ok.length) return { date: monday, avg: null, min: null, max: null, tip: [weekTitle(monday), '—'] };
    const avg = ok.reduce((sum, point) => sum + point.avg!, 0) / ok.length, min = Math.min(...ok.map((point) => point.min!)), max = Math.max(...ok.map((point) => point.max!));
    return { date: monday, avg, min, max, tip: [weekTitle(monday), `śr. ${nf(avg)} bpm`, `${nf(min)}–${nf(max)} bpm`] };
  });
}

/**
 * Events on the time axis derived from the data, not hard-coded: days before the first result are unimported history, runs of
 * basal-only calories are incomparable periods, and (with `firsts`, only when the rows cover the history since 2026)
 * the first day of the full calorie model and the first weighing.
 */
export function axisEvents(rows: readonly DayRow[], key: MetricKey | 'hr', firsts: boolean): AxisEvent[] {
  const events: AxisEvent[] = [];
  // days before the first day with any result: history not imported (or the producer has none)
  const first = rows[0]?.date, firstData = rows.find((row) => row.snapshot)?.date;
  if (first && firstData && first < firstData) events.push({ from: first, to: addDays(firstData, -1), label: 'przed pierwszymi danymi: historia niezaimportowana' });
  const energy = key === 'total_energy' || key === 'active_energy';
  if (energy) {
    let run: string[] = [];
    const flush = () => { if (run.length) events.push({ from: run[0]!, to: run.at(-1)!, label: 'tylko energia bazowa' }); run = []; };
    for (const row of rows) { if (row.snapshot?.energy?.model === 'basal_only') run.push(row.date); else flush(); }
    flush();
  }
  if (firsts) {
    if (energy || key === 'steps' || key === 'distance') {
      const index = rows.findIndex((row) => row.snapshot?.energy?.model === 'current');
      if (index > 0 && rows.slice(0, index).some((row) => row.snapshot?.energy && row.snapshot.energy.model !== 'current')) events.push({ at: rows[index]!.date, label: 'pełny model kalorii' });
    }
    if (key === 'weight' || key === 'body_fat') {
      const index = rows.findIndex((row) => row.snapshot?.metrics[key].value);
      if (index > 0 && rows.slice(0, index).some((row) => row.snapshot)) events.push({ at: rows[index]!.date, label: 'pierwsze ważenie' });
    }
  }
  return events;
}
