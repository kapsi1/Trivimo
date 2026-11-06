import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { z } from 'zod';
import { bandRangeSchema, groups, metricOf, quality, rangeSchema, useChunkedJson, type DayRow, type Group, type MetricKey } from './api.ts';
import { StatusChip } from './details.tsx';
import { addDays, dow, fmtD, formatRational, isoWeek, maxDate, mondayOf, nf, toNumber, warsawToday, WDS , firstDay } from './format.ts';
import { compareDailyRows } from './sort-days.ts';
import { Loading } from './logo.tsx';

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
    return { range: custom ? 0 : tableRanges.some(([days]) => days === Number(saved.range)) ? Number(saved.range) : 30, from: custom ? saved.from! : '', to: custom ? saved.to! : '', cols: { ...fallback.cols, ...saved.cols } };
  } catch { return fallback; }
}
function savePrefs(prefs: TablePrefs) { try { localStorage.setItem(storeKey, JSON.stringify(prefs)); } catch { /* per-browser convenience only */ } }
export const tableRanges: [number, string][] = [[7, 'Tydzień'], [30, 'Miesiąc'], [90, '3 miesiące'], [180, '6 miesięcy'], [365, 'Rok'], [730, '2 lata'], [1825, '5 lat'], [-1, 'Od początku']];
/** Bounds of the table: a preset ends today; custom bounds are kept as chosen. "Od początku" (range -1) starts at `earliest`, the first day with data in the chosen scope (today while unknown or when there is none). */
export function tableBounds(prefs: Pick<TablePrefs, 'range' | 'from' | 'to'>, earliest?: string | null): { from: string; to: string } {
  const today = warsawToday();
  if (prefs.range < 0) return { from: earliest && earliest <= today ? earliest : today, to: today };
  return prefs.range > 0 ? { from: addDays(today, -(prefs.range - 1)), to: today } : { from: prefs.from, to: prefs.to };
}
export type RangePrefs = Pick<TablePrefs, 'range' | 'from' | 'to'>;
export function useTablePrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (next: Partial<TablePrefs>) => setPrefs((current) => { const value = { ...current, ...next, cols: { ...current.cols, ...next.cols } }; savePrefs(value); return value; });
  return [prefs, update] as const;
}
/**
 * Preset buttons and "od – do" date fields kept in sync: a preset fills the fields, and fields that match a preset
 * (ending today with its length) select that button. The range may span several years (fetched in chunks of at most
 * 366 days, the server limit); moving one bound past the other moves the other bound with it.
 */
export function TableRange({ prefs, earliest, onChange }: { prefs: RangePrefs; earliest?: string | null; onChange: (next: Partial<RangePrefs>) => void }) {
  const today = warsawToday(), { from, to } = tableBounds(prefs, earliest);
  const set = (nextFrom: string, nextTo: string) => {
    const preset = nextTo === today ? tableRanges.find(([days]) => days > 0 && addDays(today, -(days - 1)) === nextFrom)?.[0] : undefined;
    onChange(preset ? { range: preset, from: '', to: '' } : earliest && nextTo === today && nextFrom === earliest ? { range: -1, from: '', to: '' } : { range: 0, from: nextFrom, to: nextTo });
  };
  const changeFrom = (value: string) => {
    if (!isDate(value)) return;
    const start = value > today ? today : value;
    set(start, to < start ? start : to);
  };
  const changeTo = (value: string) => {
    if (!isDate(value)) return;
    const end = value > today ? today : value;
    set(from > end ? end : from, end);
  };
  return <div className="rangectl">
    <label className="check">Zakres <select value={prefs.range} aria-label="Zakres" onChange={(event) => onChange({ range: Number(event.target.value), from: '', to: '' })}>
      {prefs.range === 0 && <option value={0} disabled>Własny zakres</option>}
      {tableRanges.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>
    <label className="check">od <input type="date" value={from} max={today} aria-label="Początek zakresu" onChange={(event) => changeFrom(event.target.value)} /></label>
    <label className="check">do <input type="date" value={to} max={today} aria-label="Koniec zakresu" onChange={(event) => changeTo(event.target.value)} /></label>
  </div>;
}

/** Notes of a row: the snapshot's notes, or for a past 2026 day with no read at all a gap in the Google reads. */
function rowNotes(row: DayRow, today: string): string[] {
  if (row.snapshot) return row.snapshot.notes;
  return row.date >= '2026-01-01' && row.date < today ? ['Brak odczytu Google dla tej doby (przerwa w odczytach; uzupełnianie historii ją nadrobi)'] : [];
}
/** Metrics behind the visible column groups: the scope of "Od początku" in the table (all metrics when none is shown). */
export function tableMetricKeys(cols: Columns): MetricKey[] {
  const keys = columnGroups.filter(([group]) => cols[group]).flatMap(([, list]) => list);
  return keys.length ? keys : columnGroups.flatMap(([, list]) => list);
}
const metricText = (row: DayRow, key: MetricKey) => { const value = row.snapshot?.metrics[key]; return value?.value ? formatRational(value.value, metricOf(key).decimals) : '—'; };
const weekLabel = (monday: string) => `Tydz. ${isoWeek(monday)} · ${fmtD(monday)}–${fmtD(addDays(monday, 6))}`;
const bandText = (share: { heartRate?: { windows: number } | null; totalWindows: number }) => share.heartRate ? `${nf(share.heartRate.windows / share.totalWindows * 100)} %` : '';
/** The `count` items with the longest text (ties keep the earlier ones). */
function longest<T>(items: readonly T[], length: (item: T) => number, count = 3): T[] {
  return items.map((item) => [item, length(item)] as const).sort((a, b) => b[1] - a[1]).slice(0, count).map(([item]) => item);
}
const columnGroups: [Group, MetricKey[]][] = [['body', ['weight', 'body_fat']], ['activity', ['steps', 'distance']], ['energy', ['total_energy', 'active_energy']]];
export function TableView({ from, to, cols, onCols, onOpenDay, onOpenMetric }: { from: string; to: string; cols: Columns; onCols: (cols: Partial<Columns>) => void; onOpenDay: (date: string) => void; onOpenMetric: (date: string, key: MetricKey) => void }) {
  const today = warsawToday(), read = maxDate(firstDay, from), readable = to >= firstDay;
  const [sort, setSort] = useState<{ key: 'date' | MetricKey; desc: boolean }>({ key: 'date', desc: true });
  const result = useChunkedJson('/api/day-range', from, to, rangeSchema, (parts): z.infer<typeof rangeSchema> => parts.every((part) => part.state === 'ready') ? { state: 'ready', days: parts.flatMap((part) => part.state === 'ready' ? part.days : []) } : { state: 'not_ready' });
  const band = useChunkedJson(readable ? '/api/google/band-share-range' : null, read, to, bandRangeSchema, (parts) => parts.flat());
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [heights, setHeights] = useState({ day: 35, week: 31 });
  const bandBy = useMemo(() => new Map((band.data ?? []).map((item) => [item.date, item])), [band.data]);
  const ready = result.data?.state === 'ready';
  const readyDays = result.data?.state === 'ready' ? result.data.days : null;
  /** Daily means of confirmed days per ISO week, in one pass over the range (week rows and the sizer both read it). */
  const weekMeans = useMemo(() => {
    const sums = new Map<string, Map<MetricKey, { sum: number; n: number }>>();
    for (const row of readyDays ?? []) {
      const monday = mondayOf(row.date), week = sums.get(monday) ?? new Map<MetricKey, { sum: number; n: number }>(); sums.set(monday, week);
      for (const [, keys] of columnGroups) for (const key of keys) {
        const item = row.snapshot?.metrics[key];
        if (item?.status !== 'valid' || !item.value) continue;
        const acc = week.get(key) ?? { sum: 0, n: 0 }; acc.sum += toNumber(item.value); acc.n++; week.set(key, acc);
      }
    }
    return sums;
  }, [readyDays]);
  const weekMean = (monday: string, key: MetricKey) => { const acc = weekMeans.get(monday)?.get(key); return acc ? nf(acc.sum / acc.n, metricOf(key).decimals) : '—'; };
  /**
   * Widest candidates of every column over the whole range, rendered in hidden zero-height rows so the table keeps the
   * width it would have with every row rendered: the horizontal scrollbar and scroll position survive virtualization.
   * Candidates are picked by text length (per chip kind for metric cells).
   */
  const sizer = useMemo(() => {
    if (!readyDays) return null;
    const metrics = new Map<MetricKey, DayRow[]>();
    for (const [, keys] of columnGroups) for (const key of keys) {
      const byKind = new Map<string, DayRow[]>();
      for (const row of readyDays) {
        const value = row.snapshot?.metrics[key], kind = !value || value.status === 'valid' || value.status === 'provisional' || value.status === 'missing' ? '' : value.status;
        const list = byKind.get(kind); if (list) list.push(row); else byKind.set(kind, [row]);
      }
      metrics.set(key, [...byKind.values()].flatMap((list) => longest(list, (row) => metricText(row, key).length, 2)));
    }
    const mondays = [...weekMeans.keys()];
    return {
      metrics, mondays: longest(mondays, (monday) => weekLabel(monday).length),
      weekValues: new Map(columnGroups.flatMap(([, keys]) => keys).map((key) => [key, longest(mondays, (monday) => weekMean(monday, key).length)])),
      notes: longest(readyDays, (row) => rowNotes(row, today).join('; ').length), userNotes: longest(readyDays, (row) => row.userNote?.content.length ?? 0),
      band: longest(readyDays.filter((row) => bandBy.get(row.date)?.heartRate), (row) => bandText(bandBy.get(row.date)!).length, 1),
    };
  }, [readyDays, weekMeans, bandBy, today]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const sync = () => setView({ top: element.scrollTop, height: element.clientHeight });
    sync();
    element.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync); observer.observe(element);
    const measure = () => {
      const day = element.querySelector<HTMLElement>('tbody tr[data-kind="day"]'), week = element.querySelector<HTMLElement>('tbody tr[data-kind="week"]');
      if (day || week) setHeights((current) => ({ day: day?.offsetHeight || current.day, week: week?.offsetHeight || current.week }));
    };
    measure();
    return () => { element.removeEventListener('scroll', sync); observer.disconnect(); };
  }, [ready]);
  if (result.error) return <p role="alert">Nie udało się odczytać tabeli. Sprawdź, czy serwer działa.</p>;
  if (!result.data) return <Loading />;
  if (result.data.state === 'not_ready') return <p>Wyniki dzienne nie są jeszcze przygotowane.</p>;
  const all = result.data.days;
  const rows = [...all].sort((a, b) => compareDailyRows(a, b, sort.key, sort.desc));
  const byWeek = sort.key === 'date';
  const shown = columnGroups.filter(([group]) => cols[group]);
  const metricCount = shown.reduce((sum, [, keys]) => sum + keys.length, 0);
  const colCount = 1 + metricCount + (cols.food ? 1 : 0) + (cols.ctx ? 1 : 0) + 2;
  const sortOn = (key: 'date' | MetricKey) => setSort((current) => current.key === key ? { key, desc: !current.desc } : { key, desc: true });
  const sortButton = (key: 'date' | MetricKey, label: React.ReactNode, aria: string) => <button type="button" onClick={() => sortOn(key)} aria-label={`Sortuj: ${aria}`}>{label}{sort.key === key ? sort.desc ? ' ↓' : ' ↑' : ''}</button>;
  const ariaSort = (key: 'date' | MetricKey) => sort.key === key ? sort.desc ? 'descending' as const : 'ascending' as const : undefined;

  /** Virtualized body: entries are cheap descriptors; only the rows near the scroll position are rendered, the rest are spacers. */
  const entries: { key: string; week: boolean; render: () => React.ReactNode }[] = []; let week: string | null = null;
  for (const row of rows) {
    if (byWeek && mondayOf(row.date) !== week) {
      week = mondayOf(row.date); const monday = week;
      entries.push({ key: `w${monday}`, week: true, render: () => weekRow(monday) });
    }
    entries.push({ key: row.date, week: false, render: () => dayRow(row) });
  }
  function weekRow(monday: string) {
    return <tr className="week" data-kind="week" key={`w${monday}`}><td className="date">{weekLabel(monday)}</td>
        {shown.flatMap(([, keys]) => keys.map((key) => <td key={key} className="num" title="średnia dzienna">{weekMean(monday, key)}</td>))}
        <td colSpan={colCount - 1 - metricCount} className="l">średnie dzienne</td></tr>;
  }
  const dateCell = (row: DayRow) => <button type="button" className="datebtn" aria-label={`Otwórz dzień ${row.date}`} onClick={() => onOpenDay(row.date)}><span className="wd">{WDS[dow(row.date)]}</span>{row.date}</button>;
  const metricCell = (row: DayRow, key: MetricKey) => { const metric = metricOf(key), value = row.snapshot?.metrics[key];
    return <button type="button" className={`cellbtn ${value?.value ? value.status === 'provisional' ? 'v-prov' : '' : 'v-none'}`} aria-label={`${metric.label}, ${row.date}: ${value ? quality[value.status] : 'brak obliczonego wyniku'}`} onClick={(event) => { event.stopPropagation(); onOpenMetric(row.date, key); }}>{value?.status !== 'provisional' && <StatusChip value={value} compact />}{metricText(row, key)}</button>; };
  const bandCell = (row: DayRow) => { const share = bandBy.get(row.date);
    return share?.heartRate ? <span className="bandbar" title={`${share.heartRate.windows} z ${share.totalWindows} okien 10-minutowych z tętnem`}>{bandText(share)}<i><b style={{ width: `${share.heartRate.windows / share.totalWindows * 100}%` }} /></i></span> : <span className="v-none">—</span>; };
  function dayRow(row: DayRow) {
    const notes = rowNotes(row, today), weekend = dow(row.date) === 0 || dow(row.date) === 6;
    return <tr key={row.date} data-kind="day" className={`rowlink ${weekend ? 'we' : ''}`} onClick={() => onOpenDay(row.date)}>
      <td className="date">{dateCell(row)}</td>
      {shown.flatMap(([, keys]) => keys.map((key) => <td key={key}>{metricCell(row, key)}</td>))}
      {cols.food && <td className="food-c" aria-label="M3">·</td>}
      {cols.ctx && <td>{bandCell(row)}</td>}
      <td className="notes-c" title={notes.join('; ')}>{notes.join('; ')}</td><td className="notes-c" title={row.userNote?.content ?? ''}>{row.userNote?.content ?? ''}</td>
    </tr>;
  }
  /** Hidden zero-height rows holding the widest content of each column (see `sizer`), styled like the rows they stand for. */
  const stack = (items: React.ReactNode[]) => <div className="sz">{items.map((item, index) => <div key={index}>{item}</div>)}</div>;
  const sizerRows = sizer && rows.length ? [
    <tr aria-hidden="true" className="sizer" key="sizer-day"><td className="date">{stack([dateCell(rows[0])])}</td>
      {shown.flatMap(([, keys]) => keys.map((key) => <td key={key}>{stack(sizer.metrics.get(key)!.map((row) => metricCell(row, key)))}</td>))}
      {cols.food && <td className="food-c">{stack(['·'])}</td>}
      {cols.ctx && <td>{stack(sizer.band.map(bandCell))}</td>}
      <td className="notes-c">{stack(sizer.notes.map((row) => rowNotes(row, today).join('; ')))}</td><td className="notes-c">{stack(sizer.userNotes.map((row) => row.userNote?.content ?? ''))}</td></tr>,
    ...byWeek ? [<tr aria-hidden="true" className="week sizer" key="sizer-week"><td className="date">{stack(sizer.mondays.map(weekLabel))}</td>
      {shown.flatMap(([, keys]) => keys.map((key) => <td key={key} className="num">{stack(sizer.weekValues.get(key)!.map((monday) => weekMean(monday, key)))}</td>))}
      <td colSpan={colCount - 1 - metricCount} className="l">{stack(['średnie dzienne'])}</td></tr>] : [],
  ] : [];
  const offsets: number[] = []; let total = 0;
  for (const entry of entries) { offsets.push(total); total += entry.week ? heights.week : heights.day; }
  // Binary search for the first entry that ends below the viewport top; render a screen of overscan on both sides.
  const overscan = 400, headerHeight = 62, startAt = Math.max(0, view.top - headerHeight - overscan), endAt = view.top + view.height + overscan;
  let lo = 0, hi = entries.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid] + (entries[mid].week ? heights.week : heights.day) <= startAt) lo = mid + 1; else hi = mid; }
  let first = lo, last = first; while (last < entries.length && offsets[last] < endAt) last++;
  // Keep the week header of the first rendered day so measuring and sticky context stay stable.
  const topSpace = first < entries.length ? offsets[first] : total, bottomSpace = last < entries.length ? total - offsets[last] : 0;
  const body: React.ReactNode[] = entries.slice(first, last).map((entry) => entry.render());
  if (topSpace > 0) body.unshift(<tr aria-hidden="true" key="top-space" style={{ height: topSpace }}><td colSpan={colCount} style={{ height: topSpace, padding: 0, border: 0 }} /></tr>);
  body.unshift(...sizerRows);
  if (bottomSpace > 0) body.push(<tr aria-hidden="true" key="bottom-space" style={{ height: bottomSpace }}><td colSpan={colCount} style={{ height: bottomSpace, padding: 0, border: 0 }} /></tr>);
  const toggle = (key: keyof Columns, label: string) => <label className="check" key={key}><input type="checkbox" checked={cols[key]} onChange={(event) => onCols({ [key]: event.target.checked })} /> {label}</label>;
  const cardMetrics: MetricKey[] = ['total_energy', 'steps', 'weight', 'active_energy', 'distance', 'body_fat'];
  return <>
    <div className="toolbar hide-sm">{toggle('body', 'Ciało')}{toggle('activity', 'Aktywność')}{toggle('energy', 'Energia')}{toggle('food', 'Jedzenie')}{toggle('ctx', 'Kontekst')}</div>
    {!all.some((row) => row.snapshot) && <div role="status" className="empty"><p>W tym zakresie nie ma jeszcze obliczonych wyników dziennych. Uzupełnianie historii w „Źródła danych” odczyta brakujące doby.</p></div>}
    <div className="twrap" ref={scroller}><table className="days"><thead>
      <tr className="g"><th className="date" />{shown.map(([group, keys]) => <th key={group} colSpan={keys.length} style={{ '--gc': groups[group].color } as React.CSSProperties}><span>{groups[group].label}</span></th>)}{cols.food && <th style={{ '--gc': 'var(--c-food)' } as React.CSSProperties}><span>Jedzenie · M3</span></th>}{cols.ctx && <th><span>Kontekst</span></th>}<th colSpan={2}><span>Opis dnia</span></th></tr>
      <tr className="c"><th className="date l" scope="col" aria-sort={ariaSort('date')}>{sortButton('date', 'Data', 'Data')}</th>
        {shown.flatMap(([, keys]) => keys.map((key) => { const metric = metricOf(key); return <th key={key} scope="col" aria-sort={ariaSort(key)}>{sortButton(key, <>{metric.short}{metric.unit && <span className="faint"> {metric.unit}</span>}</>, metric.label)}</th>; }))}
        {cols.food && <th scope="col" className="faint">Spożyte kcal</th>}
        {cols.ctx && <><th scope="col" title="Część doby warszawskiej, w której urządzenie mierzyło tętno (okna 10-minutowe). Dowód pomiaru, nie noszenia przez całe okno.">Opaska</th></>}
        <th scope="col" className="l">Uwagi</th><th scope="col" className="l">Notatka</th></tr>
    </thead><tbody>{rows.length ? body : <tr><td className="l" colSpan={colCount}>Brak dni w tym zakresie.</td></tr>}</tbody></table></div>
    <div className="daycards">{rows.slice(0, 90).map((row) => { const share = bandBy.get(row.date)?.heartRate, total = bandBy.get(row.date)?.totalWindows ?? 144, notes = rowNotes(row, today);
      return <button type="button" key={row.date} className="daycard" onClick={() => onOpenDay(row.date)}><span className="dc-head"><span>{WDS[dow(row.date)]} {row.date}{row.date === today ? ' · w toku' : ''}</span><span>{share ? `opaska ${nf(share.windows / total * 100)} %` : ''}</span></span>
        <span className="dc-grid">{cardMetrics.map((key) => { const metric = metricOf(key), value = row.snapshot?.metrics[key]; return <span key={key}>{metric.short}<b className={value?.value ? '' : 'v-none'}>{value?.value ? `${formatRational(value.value, metric.decimals)} ${metric.unit}` : '—'}</b></span>; })}</span>
        {notes.length > 0 && <span className="dc-notes">{notes.join('; ')}</span>}</button>; })}</div>
  </>;
}
