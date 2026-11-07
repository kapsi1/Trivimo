/** Main field of each producer daily summary (the value shown in the table and used to sort and average). */
export const summaryMainKey = {
  'daily-resting-heart-rate': 'beatsPerMinute',
  'daily-heart-rate-variability': 'averageHeartRateVariabilityMilliseconds',
  'daily-oxygen-saturation': 'averagePercentage',
  'daily-respiratory-rate': 'breathsPerMinute',
  'daily-sleep-temperature-derivations': 'nightlyTemperatureCelsius',
  'daily-vo2-max': 'vo2Max',
} as const;
export type SummaryType = keyof typeof summaryMainKey;
type WithSummaries = { summaries?: { items: { type: string; status: string; values?: Record<string, string> }[] } } | null | undefined;

/**
 * The day's main value as a number, or null: a day with several different points (conflict), without a value (absent),
 * unread, or without that field is skipped by sorting and averages, never counted as zero.
 */
export function summaryNumber(snapshot: WithSummaries, type: SummaryType): number | null {
  const item = snapshot?.summaries?.items.find((candidate) => candidate.type === type);
  if (!item || (item.status !== 'value' && item.status !== 'agreed')) return null;
  const text = item.values?.[summaryMainKey[type]];
  const value = text === undefined ? NaN : Number(text);
  return Number.isFinite(value) ? value : null;
}
