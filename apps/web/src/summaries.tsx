import type { Snapshot } from './api.ts';
import { summaryMainKey } from './summary-number.ts';

export type SummaryItem = NonNullable<Snapshot['summaries']>['items'][number];
type Values = Record<string, string>;
/** Display rounding only; the snapshot keeps the producer's number text. */
const num = (text: string | undefined, digits: number) => text === undefined ? null : Number(text).toLocaleString('pl-PL', { maximumFractionDigits: digits });
const join = (parts: (string | null)[]) => parts.filter((part): part is string => !!part).join(' · ') || '—';

/** `key`: the field shown as the main value; `unit` goes after it in the day view and in the table header; `hint`: tooltip explaining the indicator. */
export const summaryRows: { type: SummaryItem['type']; key: string; label: string; short: string; unit: string; digits: number; hint?: string; detail: (v: Values) => string }[] = [
  { type: 'daily-resting-heart-rate', key: summaryMainKey['daily-resting-heart-rate'], label: 'Tętno spoczynkowe', short: 'Tętno spocz.', unit: 'bpm', digits: 0, detail: () => '' },
  { type: 'daily-heart-rate-variability', key: summaryMainKey['daily-heart-rate-variability'], label: 'HRV podczas snu', short: 'HRV', unit: 'ms', digits: 1,
    hint: 'HRV (zmienność rytmu serca): jak bardzo różnią się odstępy między kolejnymi uderzeniami serca.',
    detail: (v) => join([v.nonRemHeartRateBeatsPerMinute ? `tętno non-REM ${num(v.nonRemHeartRateBeatsPerMinute, 0)} bpm` : null, v.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds ? `głęboki sen ${num(v.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds, 1)} ms` : null, v.entropy ? `entropia ${num(v.entropy, 2)}` : null]) },
  { type: 'daily-oxygen-saturation', key: summaryMainKey['daily-oxygen-saturation'], label: 'SpO₂ podczas snu', short: 'SpO₂', unit: '%', digits: 1, detail: (v) => join([v.lowerBoundPercentage && v.upperBoundPercentage ? `granice ${num(v.lowerBoundPercentage, 1)}–${num(v.upperBoundPercentage, 1)} %` : null, v.standardDeviationPercentage ? `odch. std. ${num(v.standardDeviationPercentage, 1)}` : null]) },
  { type: 'daily-respiratory-rate', key: summaryMainKey['daily-respiratory-rate'], label: 'Oddechy podczas snu', short: 'Oddechy', unit: '/min', digits: 1, detail: () => '' },
  { type: 'daily-sleep-temperature-derivations', key: summaryMainKey['daily-sleep-temperature-derivations'], label: 'Temperatura skóry podczas snu', short: 'Temp. skóry', unit: '°C', digits: 1, detail: (v) => join([v.baselineTemperatureCelsius ? `punkt odniesienia ${num(v.baselineTemperatureCelsius, 1)} °C` : null, v.relativeNightlyStddev30dCelsius ? `odch. 30 d ${num(v.relativeNightlyStddev30dCelsius, 2)} °C` : null]) },
  { type: 'daily-vo2-max', key: summaryMainKey['daily-vo2-max'], label: 'VO₂max', short: 'VO₂max', unit: 'ml/kg/min', digits: 1,
    hint: 'VO₂max: maksymalne tempo zużycia tlenu podczas wysiłku, w mililitrach na kilogram masy ciała na minutę. To miara wydolności tlenowej.', detail: (v) => join([v.estimated === 'true' ? 'oszacowanie' : null, v.cardioFitnessLevel ? `poziom ${v.cardioFitnessLevel.toLowerCase().replace(/_/g, ' ')}` : null]) },
];
export type SummaryRow = (typeof summaryRows)[number];
export const summaryRowOf = (type: SummaryItem['type']) => summaryRows.find((row) => row.type === type)!;

/**
 * Main value of a day without its unit: the point's value, or for different points of one day the range lowest–highest
 * (nothing is chosen; "—" if a point lacks the field). An absent or unread type is "—", never a zero.
 */
export function summaryValue(row: SummaryRow, item: SummaryItem | undefined): string {
  if (!item) return '—';
  if ((item.status === 'value' || item.status === 'agreed') && item.values) return num(item.values[row.key], row.digits) ?? '—';
  if (item.status !== 'conflict' || !item.candidates) return '—';
  const numbers = item.candidates.map((values) => Number(values[row.key]));
  if (numbers.some((n) => !Number.isFinite(n))) return '—';
  const low = num(String(Math.min(...numbers)), row.digits), high = num(String(Math.max(...numbers)), row.digits);
  return low === high ? high ?? '—' : `${low}–${high}`;
}

/** Cells of a producer summary for the day. Absent is "—" and an unread type says so, never a zero. */
export function summaryCells(row: SummaryRow, item: SummaryItem | undefined): { value: string; detail: string } {
  const text = summaryValue(row, item), value = text === '—' ? text : `${text} ${row.unit}`;
  if (item?.status === 'value' && item.values) return { value, detail: row.detail(item.values) || '—' };
  if (item?.status === 'agreed' || item?.status === 'conflict') return { value, detail: '—' };
  return { value: '—', detail: item?.status === 'absent' ? '—' : 'doba jeszcze nieodczytana' };
}

/** A details line that breaks only between its " · " parts (a part wraps inside only if it is wider than the tile). */
export function DotLine({ text }: { text: string }) {
  const parts = text.split(' · ');
  return <>{parts.map((part, index) => <span key={index} className="k-seg">{part}{index < parts.length - 1 ? ' ·' : ''}{index < parts.length - 1 ? ' ' : ''}</span>)}</>;
}

/** One producer summary as its own tile of the day. */
export function SummaryCard({ row, item }: { row: SummaryRow; item: SummaryItem | undefined }) {
  const text = summaryValue(row, item), { detail } = summaryCells(row, item);
  return <div className="kcard"><span className="k-label"><h3 className="th" title={row.hint}><i style={{ background: 'var(--c-body)' }} />{row.label}</h3></span>
    <span className={`k-value ${text === '—' ? 'none' : ''}`}>{text}{text !== '—' && <small>{row.unit}</small>}</span>
    {detail !== '—' && <span className="k-cmp" title={detail}><DotLine text={detail} /></span>}</div>;
}

export interface StatRow { id: string; label: string; hint?: string; value: string; detail: string }
/** "Wskaźniki dobowe": the stats placed in the table (producer summaries and any metric moved here); in edit mode each row can become a tile or be hidden. */
export function StatTable({ rows, editing, onTile, onHide }: { rows: StatRow[]; editing: boolean; onTile: (id: string) => void; onHide: (id: string) => void }) {
  return <section className="panel stattable"><h3>Wskaźniki dobowe</h3>
    {rows.length === 0 ? <p className="sub">Tabela jest pusta. Statystykę przeniesiesz tu w trybie edycji układu (przycisk na kafelku albo „+ Kafelki”).</p>
      : <div className="tw"><table className="simple"><thead><tr><th>Wskaźnik</th><th>Wartość</th><th>Szczegóły</th>{editing && <th aria-label="Akcje" />}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td title={row.hint}>{row.label}</td><td className="mono">{row.value}</td><td>{row.detail}</td>
          {editing && <td className="rowtools"><button type="button" className="btn" onClick={() => onTile(row.id)} title="Pokaż jako osobny kafelek">Kafelek</button><button type="button" className="iconbtn" onClick={() => onHide(row.id)} aria-label={`Ukryj: ${row.label}`} title="Ukryj"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></td>}</tr>)}</tbody></table></div>}
  </section>;
}
