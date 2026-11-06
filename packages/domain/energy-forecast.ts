import { minutesOfDay } from './day-zone.ts';

/** Rule of the own derived forecast; changing the method means a new version, never a silent change of meaning. */
export const forecastRule = 'prognoza-spoczynek-v0';
/** Fewer resting windows than one hour give no forecast: the rate would rest on too little of today. */
export const minRestWindows = 6;
const windowMs = 600000;

export type ForecastWindow = { start: number; value: string | null };
export interface RestingForecast {
  rule: typeof forecastRule;
  /** Sum of today's total-calorie windows up to `asOf` (kcal). */
  burnedKcal: number;
  /** Mean total kcal per resting window × 6. */
  restRateKcalPerHour: number;
  restWindows: number;
  /** End of the newest total-calorie window: the forecast extends from here to the end of the day. */
  asOf: string;
  remainingWindows: number;
  forecastKcal: number;
}

const zero = (value: string | null | undefined) => value === undefined || value === null || Number(value) === 0;

/**
 * Pure: burned so far plus a resting rate × the rest of the day (23 or 25 h across DST follow from the bounds).
 * The rate is the mean total kcal of today's windows with no steps and no active kcal. It assumes no further activity, so
 * the real value is usually higher. Unknown steps or active reads, or fewer than `minRestWindows` resting windows, give
 * null: a missing input is never treated as zero activity. Not a producer value and not BMR; never stored or averaged.
 */
export function forecastRestingEnergy(input: { dayStart: number; dayEnd: number; total: ForecastWindow[] | null; steps: ForecastWindow[] | null; active: ForecastWindow[] | null }): RestingForecast | null {
  const { dayStart, dayEnd, total, steps, active } = input;
  if (!total || !steps || !active) return null;
  const inDay = (window: ForecastWindow) => window.start >= dayStart && window.start < dayEnd && window.value !== null;
  const totals = total.filter(inDay);
  if (totals.length === 0) return null;
  const stepsAt = new Map(steps.filter(inDay).map((window) => [window.start, window.value]));
  const activeAt = new Map(active.filter(inDay).map((window) => [window.start, window.value]));
  const rest = totals.filter((window) => zero(stepsAt.get(window.start)) && zero(activeAt.get(window.start)));
  if (rest.length < minRestWindows) return null;
  const rate = rest.reduce((sum, window) => sum + Number(window.value), 0) / rest.length;
  const asOf = Math.max(...totals.map((window) => window.start)) + windowMs;
  const remainingWindows = Math.max(0, Math.round((dayEnd - asOf) / windowMs));
  const burnedKcal = totals.reduce((sum, window) => sum + Number(window.value), 0);
  return { rule: forecastRule, burnedKcal, restRateKcalPerHour: rate * 6, restWindows: rest.length, asOf: new Date(asOf).toISOString(), remainingWindows, forecastKcal: burnedKcal + rate * remainingWindows };
}

/** Rule of the everyday forecast: no significant exercise, at the pace of the same clock hour on recent days. */
export const profileRule = 'prognoza-bez-wysilku-v2';
/** Fewer complete days of history than this give no profile; the forecast falls back to v0. */
export const minHistoryDays = 7;
export const maxHistoryDays = 14;
/** A window of history counts as everyday (not exercise) when its active kcal are at most this. */
export const calmActiveKcal = 3;
/** An hour of the clock needs this many everyday windows in the history, or the profile is unknown there. */
const minHourSamples = 10;

/** A past day: its total windows and its active-energy windows (null when the active read is missing: the day is then unusable). */
export interface HistoryDay { windows: ForecastWindow[]; dayWindows: number; active: ForecastWindow[] | null }
/**
 * `prognoza-bez-wysilku-v2` (own derivation, never a producer value) or, without enough history, `prognoza-spoczynek-v0`.
 * Kcal of each remaining window are in `windowKcal` (from `asOf`), so charts need no rate of their own.
 */
export interface EnergyForecast {
  rule: typeof forecastRule | typeof profileRule;
  /** Sum of today's total-calorie windows up to `asOf` (kcal). */
  burnedKcal: number;
  asOf: string;
  remainingWindows: number;
  /** Burned calories of the whole day, never below the floor. */
  forecastKcal: number;
  /** v0: burned so far plus the resting rate for the rest of the day; null when its inputs are missing. */
  floorKcal: number | null;
  restRateKcalPerHour: number | null;
  restWindows: number | null;
  /** Complete days the profile rests on (v2 only). */
  historyDays: number | null;
  /** Kcal of each remaining ten-minute window, from `asOf`. */
  windowKcal: number[];
}

/** Ten-minute slot of the wall clock in the day zone (0–143): day profiles line up by clock time, also across a 23 or 25 hour day. */
export function clockSlot(ms: number, zone: string): number {
  return Math.floor(minutesOfDay(ms, zone) / 10);
}

/**
 * Pure. v2 = burned so far + for each remaining window the mean total kcal of history windows of the same clock hour
 * that had no significant activity (active kcal ≤ `calmActiveKcal`; an absent active window is none), from the newest
 * complete days of `history` (at most 14, at least 7). So it forecasts the rest of the day without exercise, at the
 * everyday pace of waking hours rather than the pace of sleep. A day needs all its total windows and a read active
 * series. An hour with fewer than 10 everyday windows leaves the profile unknown: v0. Never below v0.
 */
export function forecastEnergy(input: { dayStart: number; dayEnd: number; total: ForecastWindow[] | null; steps: ForecastWindow[] | null; active: ForecastWindow[] | null; history: HistoryDay[]; zone: string }): EnergyForecast | null {
  const floor = forecastRestingEnergy(input);
  const legacy = (): EnergyForecast | null => floor && { rule: floor.rule, burnedKcal: floor.burnedKcal, asOf: floor.asOf, remainingWindows: floor.remainingWindows, forecastKcal: floor.forecastKcal, floorKcal: floor.forecastKcal, restRateKcalPerHour: floor.restRateKcalPerHour, restWindows: floor.restWindows, historyDays: null, windowKcal: Array.from({ length: floor.remainingWindows }, () => floor.restRateKcalPerHour / 6) };
  const { dayStart, dayEnd, total } = input;
  if (!total) return legacy();
  const today = total.filter((window) => window.start >= dayStart && window.start < dayEnd && window.value !== null);
  if (today.length === 0) return legacy();
  const days = input.history.filter((day) => day.active !== null && day.dayWindows > 0 && day.windows.filter((window) => window.value !== null).length === day.dayWindows).slice(-maxHistoryDays);
  if (days.length < minHistoryDays) return legacy();
  const sums = new Float64Array(24), counts = new Uint16Array(24);
  for (const day of days) {
    const active = new Map(day.active!.filter((window) => window.value !== null).map((window) => [window.start, Number(window.value)]));
    for (const window of day.windows) {
      if ((active.get(window.start) ?? 0) > calmActiveKcal) continue;
      const hour = Math.floor(clockSlot(window.start, input.zone) / 6);
      sums[hour]! += Number(window.value); counts[hour]!++;
    }
  }
  const asOfMs = Math.max(...today.map((window) => window.start)) + windowMs;
  const remainingWindows = Math.max(0, Math.round((dayEnd - asOfMs) / windowMs));
  const hours = Array.from({ length: remainingWindows }, (_, index) => Math.floor(clockSlot(asOfMs + index * windowMs, input.zone) / 6));
  if (hours.some((hour) => counts[hour]! < minHourSamples)) return legacy();
  let windowKcal = hours.map((hour) => sums[hour]! / counts[hour]!);
  const burnedKcal = today.reduce((sum, window) => sum + Number(window.value), 0);
  let remaining = windowKcal.reduce((sum, value) => sum + value, 0);
  // the result cannot be below the no-further-activity floor of v0: stretch the remaining windows up to it
  if (floor && burnedKcal + remaining < floor.forecastKcal && remaining > 0) { const factor = (floor.forecastKcal - burnedKcal) / remaining; windowKcal = windowKcal.map((value) => value * factor); remaining = floor.forecastKcal - burnedKcal; }
  return { rule: profileRule, burnedKcal, asOf: new Date(asOfMs).toISOString(), remainingWindows, forecastKcal: burnedKcal + remaining, floorKcal: floor?.forecastKcal ?? null, restRateKcalPerHour: floor?.restRateKcalPerHour ?? null, restWindows: floor?.restWindows ?? null, historyDays: days.length, windowKcal };
}
