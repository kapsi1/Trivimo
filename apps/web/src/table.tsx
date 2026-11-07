import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { z } from 'zod';
import { bandRangeSchema, groups, metricOf, quality, rangeSchema, useChunkedJson, type DayRow, type Group, type MetricKey } from './api.ts';
import { StatusChip } from './details.tsx';
import { addDays, dow, fmtD, formatRational, isoWeek, maxDate, mondayOf, nf, toNumber, appToday, WDS , firstDay } from './format.ts';
import { compareDailyRows, type SortKey } from './sort-days.ts';
import { summaryNumber } from './summary-number.ts';
import { Loading } from './logo.tsx';
import { summaryRowOf, summaryRows, summaryValue, type SummaryItem } from './summaries.tsx';

/**
 * Columns of the table after the date, in display order. `summary:<type>` columns are the producer's daily summaries
 * ("Inne wskaźniki"): shown for reading only, not metrics (no sorting, no weekly mean, not in trends or comparisons).
 */
export type SummaryColumn = `summary:${SummaryItem['type']}`;
export type ColumnKey = MetricKey | SummaryColumn | 'food' | 'band' | 'notes' | 'userNote';
export type Columns = Record<ColumnKey, boolean>;
/** Column groups: the header row above the columns and the colour marks of the column menu. */
const sections: { id: Group | 'food' | 'ctx' | 'desc'; label: string; color: string; keys: ColumnKey[] }[] = [
  { id: 'body', label: groups.body.label, color: groups.body.color, keys: ['weight', 'body_fat', ...summaryRows.map((row): SummaryColumn => `summary:${row.type}`)] },
  { id: 'activity', label: groups.activity.label, color: groups.activity.color, keys: ['steps', 'distance'] },
  { id: 'energy', label: groups.energy.label, color: groups.energy.color, keys: ['total_energy', 'active_energy'] },
  { id: 'food', label: 'Jedzenie · M3', color: groups.food.color, keys: ['food'] },
  { id: 'ctx', label: 'Kontekst', color: 'var(--c-band)', keys: ['band'] },
  { id: 'desc', label: 'Opis dnia', color: 'var(--line-strong)', keys: ['userNote', 'notes'] },
];
const allColumns = sections.flatMap((section) => section.keys);
const isSummary = (key: ColumnKey): key is SummaryColumn => key.startsWith('summary:');
const isMetric = (key: ColumnKey): key is MetricKey => key !== 'food' && key !== 'band' && key !== 'notes' && key !== 'userNote' && !isSummary(key);
const summaryOfColumn = (key: SummaryColumn) => summaryRowOf(key.slice('summary:'.length) as SummaryItem['type']);
const columnLabels: Record<'food' | 'band' | 'notes' | 'userNote', string> = { food: 'Spożyte kcal', band: 'Opaska', notes: 'Uwagi', userNote: 'Notatka' };
const columnLabel = (key: ColumnKey) => isMetric(key) ? metricOf(key).label : isSummary(key) ? summaryOfColumn(key).label : columnLabels[key];
/** Main value of a summary column in a day row ("—" when the snapshot has none for the day or type). */
const summaryText = (row: DayRow, key: SummaryColumn) => summaryValue(summaryOfColumn(key), row.snapshot?.summaries?.items.find((item) => `summary:${item.type}` === key));
/** Saved visibility per column; earlier versions saved whole groups (body, activity, energy, food, ctx), which still apply to their columns. */
function loadColumns(saved: unknown): Columns {
  const cols = Object.fromEntries(allColumns.map((key) => [key, true])) as Columns;
  if (!saved || typeof saved !== 'object') return cols;
  const values = saved as Record<string, unknown>;
  const legacy: Record<string, ColumnKey[]> = { ...Object.fromEntries(sections.filter((section) => section.id !== 'desc').map((section) => [section.id, section.keys])) };
  for (const [old, keys] of Object.entries(legacy)) if (typeof values[old] === 'boolean') for (const key of keys) cols[key] = values[old] as boolean;
  for (const key of allColumns) if (typeof values[key] === 'boolean') cols[key] = values[key] as boolean;
  return cols;
}
const storeKey = 'trivimo-table';
/** A preset (days back to today, follows the date) or, with range 0, explicit bounds chosen in the date fields. */
interface TablePrefs { range: number; from: string; to: string; cols: Columns }
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
function loadPrefs(): TablePrefs {
  const fallback: TablePrefs = { range: 30, from: '', to: '', cols: loadColumns(null) };
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Partial<TablePrefs>;
    const custom = Number(saved.range) === 0 && isDate(saved.from) && isDate(saved.to) && saved.from <= saved.to && saved.to <= appToday();
    return { range: custom ? 0 : tableRanges.some(([days]) => days === Number(saved.range)) ? Number(saved.range) : 30, from: custom ? saved.from! : '', to: custom ? saved.to! : '', cols: loadColumns(saved.cols) };
  } catch { return fallback; }
}
/** Folded sections of the column menu: all folded at first, then the user's choice from localStorage (per-browser convenience; kept in a variable too so remounting the menu on a tab switch is cheap). */
const foldedKey = 'trivimo-table-folded';
function loadFolded(): ReadonlySet<string> {
  const all = sections.map((section) => section.id);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(foldedKey) ?? 'null');
    if (Array.isArray(saved)) return new Set(all.filter((id) => saved.includes(id)));
  } catch { /* unreadable storage: start folded */ }
  return new Set(all);
}
function saveFolded(folded: ReadonlySet<string>) { try { localStorage.setItem(foldedKey, JSON.stringify([...folded])); } catch { /* per-browser convenience only */ } }
let foldedSections: ReadonlySet<string> = loadFolded();
/** "Kolumny" dropdown in the header: one checkbox per column; each group has one colour bar, a header and can be folded (the header stays). */
export function ColumnsMenu({ cols, onChange }: { cols: Columns; onChange: (next: Partial<Columns>) => void }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(foldedSections);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (event: MouseEvent) => { if (!(event.target instanceof Node && wrap.current?.contains(event.target))) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('click', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
  }, [open]);
  const count = allColumns.filter((key) => cols[key]).length;
  return <div className="menuwrap colmenu hide-sm" ref={wrap}>
    <label className="check">Kolumny <button type="button" className="selectbtn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>{count === allColumns.length ? 'Wszystkie' : `${count} z ${allColumns.length}`}</button></label>
    {open && <div className="menu" aria-label="Kolumny tabeli">{sections.map((section) => {
      const folded = collapsed.has(section.id);
      const on = section.keys.filter((key) => cols[key]).length;
      return <div key={section.id} className="colgroup" style={{ '--gc': section.color } as React.CSSProperties}>
        <i className="colbar" aria-hidden="true" />
        <div className="colbody">
          <div className="colhead">
            <input type="checkbox" aria-label={`Wszystkie kolumny: ${section.label}`} checked={on === section.keys.length} ref={(element) => { if (element) element.indeterminate = on > 0 && on < section.keys.length; }} onChange={() => onChange(Object.fromEntries(section.keys.map((key) => [key, on < section.keys.length])))} />
            <button type="button" aria-expanded={!folded} onClick={() => setCollapsed((current) => { const next = new Set(current); if (!next.delete(section.id)) next.add(section.id); foldedSections = next; saveFolded(next); return next; })}><span className="colchev" aria-hidden="true" />{section.label}<span className="faint">{on}/{section.keys.length}</span></button>
          </div>
          {!folded && section.keys.map((key) => <label key={key} className="colitem"><input type="checkbox" checked={cols[key]} onChange={(event) => onChange({ [key]: event.target.checked })} /><span>{columnLabel(key)}</span></label>)}
        </div>
      </div>;
    })}</div>}
  </div>;
}
function savePrefs(prefs: TablePrefs) { try { localStorage.setItem(storeKey, JSON.stringify(prefs)); } catch { /* per-browser convenience only */ } }
export const tableRanges: [number, string][] = [[7, 'Tydzień'], [30, 'Miesiąc'], [90, '3 miesiące'], [180, '6 miesięcy'], [365, 'Rok'], [730, '2 lata'], [1825, '5 lat'], [-1, 'Od początku']];
/** Bounds of the table: a preset ends today; custom bounds are kept as chosen. "Od początku" (range -1) starts at `earliest`, the first day with data in the chosen scope (today while unknown or when there is none). */
export function tableBounds(prefs: Pick<TablePrefs, 'range' | 'from' | 'to'>, earliest?: string | null): { from: string; to: string } {
  const today = appToday();
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
  const today = appToday(), { from, to } = tableBounds(prefs, earliest);
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
const metricColumns = allColumns.filter(isMetric);
const summaryColumns = allColumns.filter(isSummary);
/** Metrics of the visible columns: the scope of "Od początku" in the table (all metrics when none is shown). */
export function tableMetricKeys(cols: Columns): MetricKey[] {
  const keys = metricColumns.filter((key) => cols[key]);
  return keys.length ? keys : metricColumns;
}
/** Distinct texts of a column, longest first (at most `limit`): proportional fonts make text length only a hint of width. */
function distinctTexts(texts: Iterable<string>, limit = 1000): string[] {
  return [...new Set(texts)].filter(Boolean).sort((a, b) => b.length - a.length).slice(0, limit);
}
const metricText = (row: DayRow, key: MetricKey) => { const value = row.snapshot?.metrics[key]; return value?.value ? formatRational(value.value, metricOf(key).decimals) : '—'; };
const weekLabel = (monday: string) => `Tydz. ${isoWeek(monday)} · ${fmtD(monday)}–${fmtD(addDays(monday, 6))}`;
const bandText = (share: { heartRate?: { windows: number } | null; totalWindows: number }) => share.heartRate ? `${nf(share.heartRate.windows / share.totalWindows * 100)} %` : '';
/** The `count` items with the longest text (ties keep the earlier ones). */
function longest<T>(items: readonly T[], length: (item: T) => number, count = 3): T[] {
  return items.map((item) => [item, length(item)] as const).sort((a, b) => b[1] - a[1]).slice(0, count).map(([item]) => item);
}
export function TableView({ from, to, cols, onOpenDay, onOpenMetric }: { from: string; to: string; cols: Columns; onOpenDay: (date: string) => void; onOpenMetric: (date: string, key: MetricKey) => void }) {
  const today = appToday(), read = maxDate(firstDay, from), readable = to >= firstDay;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });
  const result = useChunkedJson('/api/day-range', from, to, rangeSchema, (parts): z.infer<typeof rangeSchema> => parts.every((part) => part.state === 'ready') ? { state: 'ready', days: parts.flatMap((part) => part.state === 'ready' ? part.days : []) } : { state: 'not_ready' });
  const band = useChunkedJson(readable ? '/api/google/band-share-range' : null, read, to, bandRangeSchema, (parts) => parts.flat());
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600, width: 0 });
  const [heights, setHeights] = useState({ day: 35, week: 31 });
  const bandBy = useMemo(() => new Map((band.data ?? []).map((item) => [item.date, item])), [band.data]);
  const ready = result.data?.state === 'ready';
  const readyDays = result.data?.state === 'ready' ? result.data.days : null;
  /** Daily means of confirmed days per ISO week, in one pass over the range (week rows and the sizer both read it). */
  const weekMeans = useMemo(() => {
    const sums = new Map<string, Map<MetricKey | SummaryColumn, { sum: number; n: number }>>();
    for (const row of readyDays ?? []) {
      const monday = mondayOf(row.date), week = sums.get(monday) ?? new Map<MetricKey | SummaryColumn, { sum: number; n: number }>(); sums.set(monday, week);
      for (const key of metricColumns) {
        const item = row.snapshot?.metrics[key];
        if (item?.status !== 'valid' || !item.value) continue;
        const acc = week.get(key) ?? { sum: 0, n: 0 }; acc.sum += toNumber(item.value); acc.n++; week.set(key, acc);
      }
      // producer summaries: days with a value only; days with different points (conflict), absent or unread days are skipped, never zeros
      for (const key of summaryColumns) {
        const value = summaryNumber(row.snapshot, summaryOfColumn(key).type);
        if (value === null) continue;
        const acc = week.get(key) ?? { sum: 0, n: 0 }; acc.sum += value; acc.n++; week.set(key, acc);
      }
    }
    return sums;
  }, [readyDays]);
  const weekMean = (monday: string, key: MetricKey | SummaryColumn) => { const acc = weekMeans.get(monday)?.get(key); return acc ? nf(acc.sum / acc.n, isSummary(key) ? summaryOfColumn(key).digits : metricOf(key).decimals) : '—'; };
  /**
   * Widest candidates of every column over the whole range, rendered in hidden zero-height rows so the table keeps the
   * width it would have with every row rendered: the horizontal scrollbar and scroll position survive virtualization.
   * Metric cells (tabular digits) take the longest values per chip kind; text columns take every distinct text.
   */
  const sizer = useMemo(() => {
    if (!readyDays) return null;
    const metrics = new Map<MetricKey, DayRow[]>();
    for (const key of metricColumns) {
      const byKind = new Map<string, DayRow[]>();
      for (const row of readyDays) {
        const value = row.snapshot?.metrics[key], kind = !value || value.status === 'valid' || value.status === 'provisional' || value.status === 'missing' ? '' : value.status;
        const list = byKind.get(kind); if (list) list.push(row); else byKind.set(kind, [row]);
      }
      metrics.set(key, [...byKind.values()].flatMap((list) => longest(list, (row) => metricText(row, key).length, 2)));
    }
    const mondays = [...weekMeans.keys()];
    return {
      metrics, summaries: new Map(summaryColumns.map((key) => [key, distinctTexts(readyDays.map((row) => summaryText(row, key)), 3)])), weekLabels: distinctTexts(mondays.map(weekLabel)),
      weekValues: new Map<MetricKey | SummaryColumn, string[]>([...metricColumns, ...summaryColumns].map((key) => [key, longest(mondays, (monday) => weekMean(monday, key).length)])),
      notes: distinctTexts(readyDays.map((row) => rowNotes(row, today).join('; '))), userNotes: distinctTexts(readyDays.map((row) => row.userNote?.content ?? '')),
      band: longest(readyDays.filter((row) => bandBy.get(row.date)?.heartRate), (row) => bandText(bandBy.get(row.date)!).length, 1),
    };
  }, [readyDays, weekMeans, bandBy, today]);
  /**
   * Column widths measured once with the sizer rows in place and then fixed (rounded up) for this data and column set:
   * auto table layout still moves columns by fractions of a pixel depending on which rows are rendered. Measured again
   * when the visible width changes (a narrow table is stretched to it).
   */
  const layoutKey = `${sort.key === 'date'}|${allColumns.filter((key) => cols[key]).join(',')}|${view.width}`;
  const [locked, setLocked] = useState<{ sizer: unknown; key: string; widths: number[] } | null>(null);
  const lockedWidths = locked && sizer && locked.sizer === sizer && locked.key === layoutKey ? locked.widths : null;
  useLayoutEffect(() => {
    if (lockedWidths || !sizer || !readyDays?.length) return;
    const element = scroller.current, heads = element?.querySelectorAll<HTMLElement>('thead tr.c th');
    if (!element || !heads?.length) return;
    // A table wider than the view rounds up (never narrower than its content); one stretched to the view rounds down (no needless scrollbar).
    const overflows = element.scrollWidth > element.clientWidth;
    setLocked({ sizer, key: layoutKey, widths: [...heads].map((th) => { const width = th.getBoundingClientRect().width; return overflows ? Math.ceil(width) + 1 : Math.floor(width); }) });
  });
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const sync = () => setView({ top: element.scrollTop, height: element.clientHeight, width: element.clientWidth });
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
  const shownSections = sections.map((section) => ({ ...section, keys: section.keys.filter((key) => cols[key]) })).filter((section) => section.keys.length);
  const shown = shownSections.flatMap((section) => section.keys);
  // metric and summary columns come first (body, activity, energy); the rest (food, band, notes) share one cell in week rows
  const valueColumns = shown.filter((key): key is MetricKey | SummaryColumn => isMetric(key) || isSummary(key)), colCount = 1 + shown.length, restCount = shown.length - valueColumns.length;
  const sortOn = (key: SortKey) => setSort((current) => current.key === key ? { key, desc: !current.desc } : { key, desc: true });
  const sortButton = (key: SortKey, label: React.ReactNode, aria: string) => <button type="button" onClick={() => sortOn(key)} aria-label={`Sortuj: ${aria}`}>{label}{sort.key === key ? sort.desc ? ' ↓' : ' ↑' : ''}</button>;
  const ariaSort = (key: SortKey) => sort.key === key ? sort.desc ? 'descending' as const : 'ascending' as const : undefined;

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
        {valueColumns.map((key) => <td key={key} className="num" title={isSummary(key) ? 'średnia dzienna z dób bez konfliktu' : 'średnia dzienna'}>{weekMean(monday, key)}</td>)}
        {restCount > 0 && <td colSpan={restCount} className="l">średnie dzienne</td>}</tr>;
  }
  const dateCell = (row: DayRow) => <button type="button" className="datebtn" aria-label={`Otwórz dzień ${row.date}`} onClick={() => onOpenDay(row.date)}><span className="wd">{WDS[dow(row.date)]}</span>{row.date}</button>;
  const metricCell = (row: DayRow, key: MetricKey) => { const metric = metricOf(key), value = row.snapshot?.metrics[key];
    return <button type="button" className={`cellbtn ${value?.value ? value.status === 'provisional' ? 'v-prov' : '' : 'v-none'}`} aria-label={`${metric.label}, ${row.date}: ${value ? quality[value.status] : 'brak obliczonego wyniku'}`} onClick={(event) => { event.stopPropagation(); onOpenMetric(row.date, key); }}>{value?.status !== 'provisional' && <StatusChip value={value} compact />}{metricText(row, key)}</button>; };
  const summaryCell = (text: string) => <span className={text === '—' ? 'v-none' : ''}>{text}</span>;
  const bandCell = (row: DayRow) => { const share = bandBy.get(row.date);
    return share?.heartRate ? <span className="bandbar" title={`${share.heartRate.windows} z ${share.totalWindows} okien 10-minutowych z tętnem`}>{bandText(share)}<i><b style={{ width: `${share.heartRate.windows / share.totalWindows * 100}%` }} /></i></span> : <span className="v-none">—</span>; };
  function dayRow(row: DayRow) {
    const notes = rowNotes(row, today);
    return <tr key={row.date} data-kind="day" className="rowlink" onClick={() => onOpenDay(row.date)}>
      <td className="date">{dateCell(row)}</td>
      {shown.map((key) => {
        if (isMetric(key)) return <td key={key}>{metricCell(row, key)}</td>;
        if (isSummary(key)) return <td key={key} aria-label={`${columnLabel(key)}, ${row.date}`}>{summaryCell(summaryText(row, key))}</td>;
        if (key === 'food') return <td key={key} className="food-c" aria-label="M3">·</td>;
        if (key === 'band') return <td key={key}>{bandCell(row)}</td>;
        const text = key === 'notes' ? notes.join('; ') : row.userNote?.content ?? '';
        return <td key={key} className="notes-c" title={text}>{text}</td>;
      })}
    </tr>;
  }
  /** Hidden zero-height rows holding the widest content of each column (see `sizer`), styled like the rows they stand for. */
  const stack = (items: React.ReactNode[]) => <div className="sz">{items.map((item, index) => <div key={index}>{item}</div>)}</div>;
  const sizerRows = sizer && rows.length ? [
    <tr aria-hidden="true" className="sizer" key="sizer-day"><td className="date">{stack([dateCell(rows[0])])}</td>
      {shown.map((key) => {
        if (isMetric(key)) return <td key={key}>{stack(sizer.metrics.get(key)!.map((row) => metricCell(row, key)))}</td>;
        if (isSummary(key)) return <td key={key}>{stack(sizer.summaries.get(key)!.map(summaryCell))}</td>;
        if (key === 'food') return <td key={key} className="food-c">{stack(['·'])}</td>;
        if (key === 'band') return <td key={key}>{stack(sizer.band.map(bandCell))}</td>;
        return <td key={key} className="notes-c">{stack(key === 'notes' ? sizer.notes : sizer.userNotes)}</td>;
      })}</tr>,
    ...byWeek ? [<tr aria-hidden="true" className="week sizer" key="sizer-week"><td className="date">{stack(sizer.weekLabels)}</td>
      {valueColumns.map((key) => <td key={key} className="num">{stack(sizer.weekValues.get(key)!.map((monday) => weekMean(monday, key)))}</td>)}
      {restCount > 0 && <td colSpan={restCount} className="l">{stack(['średnie dzienne'])}</td>}</tr>] : [],
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
  const cardMetrics: MetricKey[] = ['total_energy', 'steps', 'weight', 'active_energy', 'distance', 'body_fat'];
  const widthAt = (index: number): React.CSSProperties | undefined => lockedWidths?.[index] ? { width: lockedWidths[index], minWidth: lockedWidths[index] } : undefined;
  const headCell = (key: ColumnKey, index: number) => {
    const style = widthAt(index + 1);
    if (isMetric(key)) { const metric = metricOf(key); return <th key={key} scope="col" style={style} aria-sort={ariaSort(key)}>{sortButton(key, <>{metric.short}{metric.unit && <span className="faint"> {metric.unit}</span>}</>, metric.label)}</th>; }
    if (isSummary(key)) { const row = summaryOfColumn(key); return <th key={key} scope="col" style={style} aria-sort={ariaSort(key)} title={row.label}>{sortButton(key, <>{row.short}<span className="faint"> {row.unit}</span></>, row.label)}</th>; }
    if (key === 'food') return <th key={key} scope="col" style={style} className="faint">Spożyte kcal</th>;
    if (key === 'band') return <th key={key} scope="col" style={style} title="Część doby, w której urządzenie mierzyło tętno (okna 10-minutowe). Dowód pomiaru, nie noszenia przez całe okno.">Opaska</th>;
    return <th key={key} scope="col" style={style} className="l">{columnLabels[key]}</th>;
  };
  return <>
    {!all.some((row) => row.snapshot) && <div role="status" className="empty"><p>W tym zakresie nie ma jeszcze obliczonych wyników dziennych. Uzupełnianie historii w „Źródła danych” odczyta brakujące doby.</p></div>}
    <div className="twrap" ref={scroller}><table className="days"><thead>
      <tr className="g"><th className="date" />{shownSections.map((section) => <th key={section.id} colSpan={section.keys.length} style={{ '--gc': section.color } as React.CSSProperties}><span>{section.label}</span></th>)}</tr>
      <tr className="c"><th className="date l" scope="col" style={widthAt(0)} aria-sort={ariaSort('date')}>{sortButton('date', 'Data', 'Data')}</th>{shown.map(headCell)}</tr>
    </thead><tbody>{rows.length ? body : <tr><td className="l" colSpan={colCount}>Brak dni w tym zakresie.</td></tr>}</tbody></table></div>
    <div className="daycards">{rows.slice(0, 90).map((row) => { const share = bandBy.get(row.date)?.heartRate, total = bandBy.get(row.date)?.totalWindows ?? 144, notes = rowNotes(row, today);
      return <button type="button" key={row.date} className="daycard" onClick={() => onOpenDay(row.date)}><span className="dc-head"><span>{WDS[dow(row.date)]} {row.date}{row.date === today ? ' · w toku' : ''}</span><span>{share ? `opaska ${nf(share.windows / total * 100)} %` : ''}</span></span>
        <span className="dc-grid">{cardMetrics.map((key) => { const metric = metricOf(key), value = row.snapshot?.metrics[key]; return <span key={key}>{metric.short}<b className={value?.value ? '' : 'v-none'}>{value?.value ? `${formatRational(value.value, metric.decimals)} ${metric.unit}` : '—'}</b></span>; })}</span>
        {notes.length > 0 && <span className="dc-notes">{notes.join('; ')}</span>}</button>; })}</div>
  </>;
}
