/** Rule of the own derived forecast; changing the method means a new version, never a silent change of meaning. */
export const forecastRule = 'prognoza-spoczynek-v0';
/** Fewer resting windows than one hour give no forecast: the rate would rest on too little of today. */
export const minRestWindows = 6;
const windowMs = 600000;

export type ForecastWindow = { start: number; value: string | null };
export interface EnergyForecast {
  rule: typeof forecastRule;
  /** Sum of today's total-calorie windows up to `asOf` (kcal). */
  burnedKcal: number;
  /** Mean total kcal per resting window × 6. */
  restRateKcalPerHour: number;
  restWindows: number;
  /** End of the newest total-calorie window: the forecast extends from here to the end of the Warsaw day. */
  asOf: string;
  remainingWindows: number;
  forecastKcal: number;
}

const zero = (value: string | null | undefined) => value === undefined || value === null || Number(value) === 0;

/**
 * Pure: burned so far plus a resting rate × the rest of the Warsaw day (23 or 25 h across DST follow from the bounds).
 * The rate is the mean total kcal of today's windows with no steps and no active kcal. It assumes no further activity, so
 * the real value is usually higher. Unknown steps or active reads, or fewer than `minRestWindows` resting windows, give
 * null: a missing input is never treated as zero activity. Not a producer value and not BMR; never stored or averaged.
 */
export function forecastRestingEnergy(input: { dayStart: number; dayEnd: number; total: ForecastWindow[] | null; steps: ForecastWindow[] | null; active: ForecastWindow[] | null }): EnergyForecast | null {
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
