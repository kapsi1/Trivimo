import type { Snapshot } from './api.ts';

type Item = NonNullable<Snapshot['summaries']>['items'][number];
type Values = Record<string, string>;
/** Display rounding only; the snapshot keeps the producer's number text. */
const num = (text: string | undefined, digits: number) => text === undefined ? null : Number(text).toLocaleString('pl-PL', { maximumFractionDigits: digits });
const join = (parts: (string | null)[]) => parts.filter((part): part is string => !!part).join(' · ') || '—';

const rows: { type: Item['type']; key: string; label: string; main: (v: Values) => string; detail: (v: Values) => string }[] = [
  { type: 'daily-resting-heart-rate', key: 'beatsPerMinute', label: 'Tętno spoczynkowe', main: (v) => `${num(v.beatsPerMinute, 0) ?? '—'} bpm`, detail: () => '' },
  { type: 'daily-heart-rate-variability', key: 'averageHeartRateVariabilityMilliseconds', label: 'HRV w nocy (RMSSD)', main: (v) => v.averageHeartRateVariabilityMilliseconds ? `${num(v.averageHeartRateVariabilityMilliseconds, 1)} ms` : '—',
    detail: (v) => join([v.nonRemHeartRateBeatsPerMinute ? `tętno non-REM ${num(v.nonRemHeartRateBeatsPerMinute, 0)} bpm` : null, v.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds ? `głęboki sen ${num(v.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds, 1)} ms` : null, v.entropy ? `entropia ${num(v.entropy, 2)}` : null]) },
  { type: 'daily-oxygen-saturation', key: 'averagePercentage', label: 'SpO₂ w nocy', main: (v) => `${num(v.averagePercentage, 1) ?? '—'} %`, detail: (v) => join([v.lowerBoundPercentage && v.upperBoundPercentage ? `granice ${num(v.lowerBoundPercentage, 1)}–${num(v.upperBoundPercentage, 1)} %` : null, v.standardDeviationPercentage ? `odch. std. ${num(v.standardDeviationPercentage, 1)}` : null]) },
  { type: 'daily-respiratory-rate', key: 'breathsPerMinute', label: 'Oddechy w nocy', main: (v) => `${num(v.breathsPerMinute, 1) ?? '—'} /min`, detail: () => '' },
  { type: 'daily-sleep-temperature-derivations', key: 'nightlyTemperatureCelsius', label: 'Temperatura skóry w nocy', main: (v) => `${num(v.nightlyTemperatureCelsius, 1) ?? '—'} °C`, detail: (v) => join([v.baselineTemperatureCelsius ? `punkt odniesienia ${num(v.baselineTemperatureCelsius, 1)} °C` : null, v.relativeNightlyStddev30dCelsius ? `odch. 30 d ${num(v.relativeNightlyStddev30dCelsius, 2)} °C` : null]) },
  { type: 'daily-vo2-max', key: 'vo2Max', label: 'VO₂max', main: (v) => `${num(v.vo2Max, 1) ?? '—'} ml/kg/min`, detail: (v) => join([v.estimated === 'true' ? 'oszacowanie' : null, v.cardioFitnessLevel ? `poziom ${v.cardioFitnessLevel.toLowerCase().replace(/_/g, ' ')}` : null]) },
];

/** Different points of one day shown as a range of the main value (lowest–highest, same unit), nothing chosen; "—" if a candidate lacks it. */
function range(row: (typeof rows)[number], candidates: Values[]): string {
  const numbers = candidates.map((values) => Number(values[row.key]));
  if (numbers.some((n) => !Number.isFinite(n))) return '—';
  const [lo, hi] = [Math.min(...numbers), Math.max(...numbers)];
  const high = row.main({ [row.key]: String(hi) }), low = row.main({ [row.key]: String(lo) });
  return low === high ? high : `${low.split(' ')[0]}–${high}`;
}

/** Producer daily summaries from the day's snapshot. Absent is shown as an empty cell and an unread type as unread, never as zero. */
export function DaySummaries({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return null;
  const byType = new Map((snapshot.summaries?.items ?? []).map((item) => [item.type, item]));
  return <section className="panel"><h3>Inne wskaźniki</h3>
    <div className="tw"><table className="simple"><thead><tr><th>Wskaźnik</th><th>Wartość</th><th>Szczegóły</th></tr></thead>
      <tbody>{rows.map((row) => {
        const item = byType.get(row.type);
        if (item?.status === 'value' && item.values) return <tr key={row.type}><td>{row.label}</td><td className="mono">{row.main(item.values)}</td><td>{row.detail(item.values) || '—'}</td></tr>;
        if (item?.status === 'agreed' && item.values) return <tr key={row.type}><td>{row.label}</td><td className="mono">{row.main(item.values)}</td><td>—</td></tr>;
        if (item?.status === 'conflict' && item.candidates) return <tr key={row.type}><td>{row.label}</td><td className="mono">{range(row, item.candidates)}</td><td>—</td></tr>;
        return <tr key={row.type}><td>{row.label}</td><td>—</td><td>{item?.status === 'absent' ? '—' : 'doba jeszcze nieodczytana'}</td></tr>;
      })}</tbody></table></div></section>;
}
