import { useMemo, useState } from 'react';
import { bandRangeSchema, daySourcesSchema, groups, metricOf, quality, rangeSchema, sourceName, useJson, type DayRow, type DaySources, type Group, type MetricKey } from './api.ts';
import { meanValid } from './derive.ts';
import { StatusChip, type DrawerState } from './details.tsx';
import { addDays, dow, fmtD, formatRational, isoWeek, maxDate, mondayOf, nf, warsawToday, WDS } from './format.ts';
import { compareDailyRows } from './sort-days.ts';
import { Segmented } from './zoom.tsx';

type Columns = Record<Group | 'food' | 'ctx', boolean>;
const storeKey = 'trivimo-table';
/** A preset (days back to today, follows the date) or, with range 0, explicit bounds chosen in the date fields. */
interface TablePrefs { range: number; from: string; to: string; cols: Columns }
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
function loadPrefs(): TablePrefs {
  const fallback: TablePrefs = { range: 30, from: '', to: '', cols: { body: true, activity: true, energy: true, food: true, ctx: true } };
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Partial<TablePrefs>;
    const custom = Number(saved.range) === 0 && isDate(saved.from) && isDate(saved.to) && saved.from <= saved.to && saved.to <= warsawToday();
    return { range: custom ? 0 : [7, 30, 90, 365].includes(Number(saved.range)) ? Number(saved.range) : 30, from: custom ? saved.from! : '', to: custom ? saved.to! : '', cols: { ...fallback.cols, ...saved.cols } };
  } catch { return fallback; }
}
function savePrefs(prefs: TablePrefs) { try { localStorage.setItem(storeKey, JSON.stringify(prefs)); } catch { /* per-browser convenience only */ } }
export const tableRanges: [number, string][] = [[7, '7 dni'], [30, '30 dni'], [90, '90 dni'], [365, 'Rok']];
/** Bounds of the table: a preset ends today; custom bounds are kept as chosen. */
export function tableBounds(prefs: Pick<TablePrefs, 'range' | 'from' | 'to'>): { from: string; to: string } {
  const today = warsawToday();
  return prefs.range > 0 ? { from: addDays(today, -(prefs.range - 1)), to: today } : { from: prefs.from, to: prefs.to };
}
export function useTablePrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (next: Partial<TablePrefs>) => setPrefs((current) => { const value = { ...current, ...next, cols: { ...current.cols, ...next.cols } }; savePrefs(value); return value; });
  return [prefs, update] as const;
}
const maxSpan = 366;
/**
 * Preset buttons and "od – do" date fields kept in sync: a preset fills the fields, and fields that match a preset
 * (ending today with its length) select that button. A range is at most 366 days; moving one bound past the other or
 * beyond the limit moves the other bound with it.
 */
export function TableRange({ prefs, onChange }: { prefs: TablePrefs; onChange: (next: Partial<TablePrefs>) => void }) {
  const today = warsawToday(), { from, to } = tableBounds(prefs);
  const set = (nextFrom: string, nextTo: string) => {
    const preset = nextTo === today ? tableRanges.find(([days]) => addDays(today, -(days - 1)) === nextFrom)?.[0] : undefined;
    onChange(preset ? { range: preset, from: '', to: '' } : { range: 0, from: nextFrom, to: nextTo });
  };
  const changeFrom = (value: string) => {
    if (!isDate(value)) return;
    const start = value > today ? today : value;
    let end = to < start ? start : to;
    if (Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 > maxSpan) end = addDays(start, maxSpan - 1) > today ? today : addDays(start, maxSpan - 1);
    set(start, end);
  };
  const changeTo = (value: string) => {
    if (!isDate(value)) return;
    const end = value > today ? today : value;
    let start = from > end ? end : from;
    if (Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 > maxSpan) start = addDays(end, -(maxSpan - 1));
    set(start, end);
  };
  return <div className="rangectl">
    <Segmented label="Zakres" items={tableRanges} value={prefs.range} onChange={(range) => onChange({ range, from: '', to: '' })} />
    <label className="check">od <input type="date" value={from} max={today} aria-label="Początek zakresu" onChange={(event) => changeFrom(event.target.value)} /></label>
    <label className="check">do <input type="date" value={to} max={today} aria-label="Koniec zakresu" onChange={(event) => changeTo(event.target.value)} /></label>
  </div>;
}

/** Notes of a row: the snapshot's notes, or for a past 2026 day with no read at all a gap in the Google reads. */
function rowNotes(row: DayRow, today: string): string[] {
  if (row.snapshot) return row.snapshot.notes;
  return row.date >= '2026-01-01' && row.date < today ? ['Brak odczytu Google dla tej doby (przerwa w odczytach; uzupełnianie historii ją nadrobi)'] : [];
}
function sourcesText(day: DaySources | undefined): { short: string; detail: string } {
  if (!day || (day.steps === null && day.activeEnergy === null)) return { short: '—', detail: 'Brak odczytu listy źródeł' };
  const names = new Map<string, number>();
  for (const item of [...(day.steps ?? []), ...(day.activeEnergy ?? [])]) names.set(sourceName(item.source), (names.get(sourceName(item.source)) ?? 0) + item.records);
  const detail = ([['Kroki', day.steps], ['Kalorie aktywne', day.activeEnergy]] as const).map(([label, items]) => `${label}: ${items === null ? 'nie odczytano' : items.length === 0 ? 'brak wpisów' : items.map((item) => `${sourceName(item.source)} (${item.records} wpisów)`).join(', ')}`).join('\n');
  return { short: names.size === 0 ? 'brak wpisów' : [...names].sort((a, b) => b[1] - a[1]).map(([name]) => name).join(', '), detail };
}

const columnGroups: [Group, MetricKey[]][] = [['body', ['weight', 'body_fat']], ['activity', ['steps', 'distance']], ['energy', ['total_energy', 'active_energy']]];
export function TableView({ from, to, cols, onCols, onDrawer, onOpenDay }: { from: string; to: string; cols: Columns; onCols: (cols: Partial<Columns>) => void; onDrawer: (state: DrawerState) => void; onOpenDay: (date: string) => void }) {
  const today = warsawToday(), read = maxDate('2026-01-01', from), readable = to >= '2026-01-01';
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [sort, setSort] = useState<{ key: 'date' | MetricKey; desc: boolean }>({ key: 'date', desc: true });
  const result = useJson(`/api/day-range?from=${from}&to=${to}`, rangeSchema);
  const band = useJson(readable ? `/api/google/band-share-range?from=${read}&to=${to}` : null, bandRangeSchema);
  const sources = useJson(readable ? `/api/google/day-sources?from=${read}&to=${to}` : null, daySourcesSchema);
  const bandBy = useMemo(() => new Map((band.data ?? []).map((item) => [item.date, item])), [band.data]);
  const sourcesBy = useMemo(() => new Map((sources.data ?? []).map((item) => [item.date, item])), [sources.data]);
  if (result.error) return <p role="alert">Nie udało się odczytać tabeli. Sprawdź, czy serwer działa.</p>;
  if (!result.data) return <p>Ładowanie…</p>;
  if (result.data.state === 'not_ready') return <p>Wyniki dzienne nie są jeszcze przygotowane.</p>;
  const all = result.data.days;
  const rows = all.filter((row) => !onlyNotes || rowNotes(row, today).length > 0).sort((a, b) => compareDailyRows(a, b, sort.key, sort.desc));
  const byWeek = sort.key === 'date' && !onlyNotes;
  const shown = columnGroups.filter(([group]) => cols[group]);
  const metricCount = shown.reduce((sum, [, keys]) => sum + keys.length, 0);
  const colCount = 1 + metricCount + (cols.food ? 1 : 0) + (cols.ctx ? 2 : 0) + 2;
  const sortOn = (key: 'date' | MetricKey) => setSort((current) => current.key === key ? { key, desc: !current.desc } : { key, desc: true });
  const sortButton = (key: 'date' | MetricKey, label: React.ReactNode, aria: string) => <button type="button" onClick={() => sortOn(key)} aria-label={`Sortuj: ${aria}`}>{label}{sort.key === key ? sort.desc ? ' ↓' : ' ↑' : ''}</button>;
  const ariaSort = (key: 'date' | MetricKey) => sort.key === key ? sort.desc ? 'descending' as const : 'ascending' as const : undefined;

  const body: React.ReactNode[] = []; let week: string | null = null;
  for (const row of rows) {
    if (byWeek && mondayOf(row.date) !== week) {
      week = mondayOf(row.date); const monday = week, sunday = addDays(monday, 6), last = sunday > to ? to : sunday;
      body.push(<tr className="week" key={`w${monday}`}><td className="date">Tydz. {isoWeek(monday)} · {fmtD(monday)}–{fmtD(sunday)}</td>
        {shown.flatMap(([, keys]) => keys.map((key) => { const avg = meanValid(all, key, monday < from ? from : monday, last); return <td key={key} className="num" title="średnia dzienna z dób potwierdzonych · liczba dób z wartością / w zakresie">{avg.mean === null ? '—' : nf(avg.mean, metricOf(key).decimals)} <span className="faint">{avg.n}/{avg.total}</span></td>; }))}
        <td colSpan={colCount - 1 - metricCount} className="l">śr. dzienna z dób potwierdzonych · doby z wartością / w zakresie</td></tr>);
    }
    const notes = rowNotes(row, today), share = bandBy.get(row.date), src = sourcesText(sourcesBy.get(row.date)), weekend = dow(row.date) === 0 || dow(row.date) === 6;
    body.push(<tr key={row.date} className={weekend ? 'we' : ''}>
      <td className="date"><span className="wd">{WDS[dow(row.date)]}</span>{row.date}{row.date === today && <> <span className="chip prov">w toku</span></>}</td>
      {shown.flatMap(([, keys]) => keys.map((key) => { const metric = metricOf(key), value = row.snapshot?.metrics[key];
        return <td key={key}><button type="button" className={`cellbtn ${value?.value ? value.status === 'provisional' ? 'v-prov' : '' : 'v-none'}`} aria-label={`${metric.label}, ${row.date}: ${value ? quality[value.status] : 'brak obliczonego wyniku'}`} onClick={() => onDrawer({ type: 'cell', date: row.date, key })}>{value?.status !== 'provisional' && <StatusChip value={value} compact />}{value?.value ? formatRational(value.value, metric.decimals) : '—'}</button></td>; }))}
      {cols.food && <td className="food-c" aria-label="M3">·</td>}
      {cols.ctx && <><td>{share?.heartRate ? <span className="bandbar" title={`${share.heartRate.windows} z ${share.totalWindows} okien 10-minutowych z tętnem`}>{nf(share.heartRate.windows / share.totalWindows * 100)} %<i><b style={{ width: `${share.heartRate.windows / share.totalWindows * 100}%` }} /></i></span> : <span className="v-none">—</span>}</td>
        <td className="l src-c" title={src.detail}>{src.short}</td></>}
      <td className="notes-c" title={notes.join('; ')}>{notes.join('; ')}</td><td className="notes-c" title={row.userNote?.content ?? ''}>{row.userNote?.content ?? ''}</td>
    </tr>);
  }
  const toggle = (key: keyof Columns, label: string) => <label className="check" key={key}><input type="checkbox" checked={cols[key]} onChange={(event) => onCols({ [key]: event.target.checked })} /> {label}</label>;
  const cardMetrics: MetricKey[] = ['total_energy', 'steps', 'weight', 'active_energy', 'distance', 'body_fat'];
  return <>
    <div className="toolbar"><label className="check"><input type="checkbox" checked={onlyNotes} onChange={(event) => setOnlyNotes(event.target.checked)} /> Tylko dni z uwagami</label>
      <span className="hide-sm sep">|</span><span className="hide-sm" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{toggle('body', 'Ciało')}{toggle('activity', 'Aktywność')}{toggle('energy', 'Energia')}{toggle('food', 'Jedzenie')}{toggle('ctx', 'Kontekst')}</span>
      <span className="spacer" /><span className="legend hide-sm"><span><span className="chip prov">w toku</span> częściowy</span><span><span className="chip inc">nieporówn.</span> nie wchodzi do porównań</span><span><span className="chip conf">konflikt</span></span><span>— brak, nie zero</span></span>
      <button type="button" className="btn hide-sm" disabled title="Po podstawowym UI">Eksport CSV</button></div>
    {!all.some((row) => row.snapshot) && <div role="status" className="empty"><p>W tym zakresie nie ma jeszcze obliczonych wyników dziennych. Uzupełnianie historii w „Źródła danych” odczyta brakujące doby.</p></div>}
    <div className="twrap"><table className="days"><thead>
      <tr className="g"><th className="date" />{shown.map(([group, keys]) => <th key={group} colSpan={keys.length} style={{ '--gc': groups[group].color } as React.CSSProperties}><span>{groups[group].label}</span></th>)}{cols.food && <th style={{ '--gc': 'var(--c-food)' } as React.CSSProperties}><span>Jedzenie · M3</span></th>}{cols.ctx && <th colSpan={2}><span>Kontekst</span></th>}<th colSpan={2}><span>Opis dnia</span></th></tr>
      <tr className="c"><th className="date l" scope="col" aria-sort={ariaSort('date')}>{sortButton('date', 'Data', 'Data')}</th>
        {shown.flatMap(([, keys]) => keys.map((key) => { const metric = metricOf(key); return <th key={key} scope="col" aria-sort={ariaSort(key)}>{sortButton(key, <>{metric.short}{metric.unit && <span className="faint"> {metric.unit}</span>}</>, metric.label)}</th>; }))}
        {cols.food && <th scope="col" className="faint">Spożyte kcal</th>}
        {cols.ctx && <><th scope="col" title="Część doby warszawskiej, w której urządzenie mierzyło tętno (okna 10-minutowe). Dowód pomiaru, nie noszenia przez całe okno.">Opaska</th><th scope="col" className="l" title="Aplikacje i urządzenia, które zapisały kroki lub kalorie aktywne tego dnia; najedź na komórkę, aby zobaczyć liczbę wpisów.">Źródła</th></>}
        <th scope="col" className="l">Uwagi</th><th scope="col" className="l">Notatka</th></tr>
    </thead><tbody>{body.length ? body : <tr><td className="l" colSpan={colCount}>Brak dni z uwagami w tym zakresie.</td></tr>}</tbody></table></div>
    <div className="daycards">{rows.slice(0, 90).map((row) => { const share = bandBy.get(row.date)?.heartRate, total = bandBy.get(row.date)?.totalWindows ?? 144, notes = rowNotes(row, today);
      return <button type="button" key={row.date} className="daycard" onClick={() => onOpenDay(row.date)}><span className="dc-head"><span>{WDS[dow(row.date)]} {row.date}{row.date === today ? ' · w toku' : ''}</span><span>{share ? `opaska ${nf(share.windows / total * 100)} %` : ''}</span></span>
        <span className="dc-grid">{cardMetrics.map((key) => { const metric = metricOf(key), value = row.snapshot?.metrics[key]; return <span key={key}>{metric.short}<b className={value?.value ? '' : 'v-none'}>{value?.value ? `${formatRational(value.value, metric.decimals)} ${metric.unit}` : '—'}</b></span>; })}</span>
        {notes.length > 0 && <span className="dc-notes">{notes.join('; ')}</span>}</button>; })}</div>
  </>;
}
