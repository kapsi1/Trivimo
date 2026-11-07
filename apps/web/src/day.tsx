import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { dayResponseSchema, forecastSchema, groups, heartRateDaySchema, heartRateRangeSchema, metricOf, post, rangeSchema, seriesSchema, useJson, userNoteSchema, type DayRow, type Forecast, type MetricKey, type Snapshot, type SyncStatus } from './api.ts';
import { aggregateSpans, DayMini, EnergyLegend, HourChart, HR_LEGEND, HrDayChart, HrDayMini, type HourKey } from './charts.tsx';
import { dayHours, dayTotal, forecastHint, hrOf, meanValid, valueOf, type DayHours } from './derive.ts';
import { StatusChip, hourMetricLabel } from './details.tsx';
import { addDays, fmtD, formatRational, nf, appToday, firstDay } from './format.ts';
import { Placeholder } from './placeholders.tsx';
import { Segmented, ZoomDialog, zoomSize } from './zoom.tsx';
import { z } from 'zod';
import { Loading } from './logo.tsx';
import { StatTable, SummaryCard, summaryCells, summaryRowOf, type StatRow } from './summaries.tsx';
import { loadLayout, saveLayout, TileBoard } from './day-tiles.tsx';
import { removeFromTable, setPlace, type DayLayout, type Placed, type StatId } from './day-layout.ts';
import type { SummaryType } from './summary-number.ts';


export type DayTab = 'przebieg' | 'godzinowe' | 'jedzenie' | 'treningi';
type Zoom = { type: 'hour'; key: HourKey } | { type: 'hrday' };
/** Days of the loaded window: the 90 days of the view plus 60 to move through before the next request. */
const windowDays = 150;
const windowEnd = (date: string, today: string) => { const later = addDays(date, 30); return later < today ? later : today; };

/** Page offset to put back once the next day has loaded: while it loads the page is shorter and the browser clamps the scroll. */
let keepScroll: number | null = null;
export const rememberDayScroll = () => {
  keepScroll = window.scrollY;
  // hold the page height while the next day loads, so the browser has nothing to clamp the offset to
  document.documentElement.style.minHeight = `${document.documentElement.scrollHeight}px`;
};

export function DayView({ date, tab, onTab, sync, onDirty }: { date: string; tab: DayTab; onTab: (tab: DayTab) => void; sync: SyncStatus | undefined; onDirty: (dirty: boolean) => void }) {
  const today = appToday(), isToday = date === today, read = date >= firstDay;
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [showHr, setShowHr] = useState(true); // heart-rate line in the zoomed hourly chart; kept between zooms
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false); // tile layout edit mode of "Przebieg doby"
  const day = useJson(`/api/day?date=${date}`, dayResponseSchema, refresh);
  // the 90 days up to the shown day come from a wider window that stays while moving day by day (no request, no flicker)
  const [anchor, setAnchor] = useState(() => windowEnd(date, today));
  let end = anchor;
  if (!(date <= anchor && addDays(date, -89) >= addDays(anchor, -(windowDays - 1)))) { end = windowEnd(date, today); if (end !== anchor) setAnchor(end); }
  const range = useJson(`/api/day-range?from=${addDays(end, -(windowDays - 1))}&to=${end}`, rangeSchema, refresh);
  const hrRange = useJson(read ? `/api/google/heart-rate-range?from=${date}&to=${date}` : null, heartRateRangeSchema, refresh);
  const heart = useJson(read ? `/api/google/heart-rate?date=${date}` : null, heartRateDaySchema, refresh);
  const total = useJson(read ? `/api/google/day-series?metric=total-calories&date=${date}` : null, seriesSchema, refresh);
  const active = useJson(read ? `/api/google/day-series?metric=active-energy-burned&date=${date}` : null, seriesSchema, refresh);
  const steps = useJson(read ? `/api/google/day-series?metric=steps&date=${date}` : null, seriesSchema, refresh);
  const distance = useJson(read ? `/api/google/day-series?metric=distance&date=${date}` : null, seriesSchema, refresh);
  const forecast = useJson(isToday ? `/api/google/energy-forecast?date=${date}` : null, forecastSchema, refresh);
  // a new sync result refreshes the day in progress
  useEffect(() => { if (isToday && sync?.last?.at) setRefresh((value) => value + 1); }, [sync?.last?.at]);

  const first = addDays(date, -89);
  const rows = useMemo(() => range.data?.state === 'ready' ? range.data.days.filter((row) => row.date >= first && row.date <= date) : [], [range.data, first, date]);
  const snapshot = day.data?.state === 'ready' ? day.data.snapshot : null;
  const fc = forecast.data ?? null;
  const hours = dayHours(date, { total: total.data, active: active.data, steps: steps.data, distance: distance.data }, heart.data ?? undefined, fc ?? undefined, isToday);
  const hrToday = hrOf((hrRange.data ?? []).find((item) => item.date === date));
  const asOf = sync?.last?.result === 'ok' ? sync.last.at : sync?.kinds.map((kind) => kind.lastReadAt).filter((at): at is string => !!at).sort().at(-1);
  const tabs: [DayTab, string, boolean?][] = [['przebieg', 'Przebieg doby'], ['godzinowe', 'Dane godzinowe'], ['jedzenie', 'Jedzenie', true], ['treningi', 'Treningi', true]];
  // the date itself is the page title (topbar); here only what qualifies the day
  const head = <><div className="tabrow"><div className="tabs" role="tablist" aria-label="Widok dnia">{tabs.map(([key, label, soon]) => <button type="button" role="tab" key={key} className={soon ? 'is-soon' : undefined} aria-selected={tab === key} onClick={() => onTab(key)}>{label}</button>)}</div>
      {tab === 'przebieg' && <button type="button" className="btn ghost tabedit" aria-pressed={editing} onClick={() => setEditing(!editing)} title="Układ, rozmiar i wybór kafelków"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" /></svg><span className="hide-sm">{editing ? 'Edycja układu' : 'Edytuj układ'}</span></button>}</div></>;
  const legacy = snapshot?.energy?.model === 'legacy';
  const loading = (read && total.data === undefined && !total.error) || !day.data;
  const settled = (!!day.data && !!range.data && !loading) || day.error || range.error;
  useLayoutEffect(() => { if (!settled || keepScroll === null) return; window.scrollTo(0, keepScroll); keepScroll = null; document.documentElement.style.minHeight = ''; }, [settled, date]);
  const zoomed = zoom && <DayZoom zoom={zoom} setZoom={setZoom} showHr={showHr} onShowHr={setShowHr} snapshot={snapshot} hours={hours} legacy={legacy} seriesRead={!!total.data} loading={loading} forecast={fc} hrToday={hrToday} />;
  if (day.error || range.error) return <>{head}<p role="alert">Nie udało się odczytać wyniku dnia. Sprawdź, czy serwer działa.</p>{zoomed}</>;
  if (!day.data) return <>{head}<Loading />{zoomed}</>;
  if (day.data.state === 'not_ready') return <>{head}<p>Wyniki dzienne nie są jeszcze przygotowane. Oryginalne dane znajdziesz w „Źródła danych”.</p>{zoomed}</>;

  let body;
  if (tab === 'przebieg') body = <><DayFlow date={date} rows={rows} hours={hours} snapshot={snapshot} legacy={legacy} seriesRead={!!total.data} loading={loading} forecast={fc} onZoom={setZoom} notesAvailable={day.data.notesAvailable} userNote={day.data.userNote} onDirty={onDirty} editing={editing} onEditing={setEditing} /></>;
  else if (tab === 'godzinowe') body = <DayHoursTable hours={hours} />;
  else if (tab === 'jedzenie') body = <Placeholder title="Dziennik jedzenia dnia" stage="M3" text="Tu pojawią się posiłki tego dnia, ich suma i pokrycie składników, a obok bilans z wydatkiem energii. Szczegóły zaprojektujemy razem z etapem M3." list={['Lista posiłków chronologicznie', 'Suma kcal i makr z oznaczeniem wpisów niepełnych', 'Bilans tylko dla dni z porównywalnym wydatkiem']} />;
  else body = <Placeholder title="Treningi dnia" stage="M2" text="Sesje z czasem, tętnem, strefami i mapą trasy pojawią się w etapie M2. Kolumna „Treningi” w tabeli będzie ich zwięzłą projekcją." list={['Lista sesji dnia, np. „2 × spacer, 1 × rower”', 'Czas w strefach tętna i AZM osobno', 'Mapa trasy z TCX']} />;

  return <>{head}{body}{zoomed}</>;
}

/** Comparison line of a metric: the mean of the 7 days before the shown day. Body metrics have none in the day view (a day without a measurement shows only "—"). */
function metricCompare(date: string, rows: DayRow[], metricKey: MetricKey): string {
  const metric = metricOf(metricKey);
  const avg = meanValid(rows, metricKey, addDays(date, -7), addDays(date, -1));
  const week = `${fmtD(addDays(date, -7))}–${fmtD(addDays(date, -1))}`; // the 7 days before the shown day, without it
  return avg.mean !== null ? `śr. ${week}: ${nf(avg.mean, metric.decimals)} · ${avg.n} z 7 dób` : metric.group === 'body' ? 'brak pomiarów w 7 dniach' : 'brak potwierdzonych dób w 7 dniach';
}

/** `narrow`: a tile under 4 grid steps wide shows the forecast as "→ X" (full wording in the tooltip): beside the unit (3 steps) or above it ('stack', 2 steps). `mini` replaces the 14-day sparkline (the day view puts today's ten-minute chart there; null: no chart); without `onZoom` the card is not clickable. */
function KpiCard({ date, rows, snapshot, metricKey, forecast, onZoom, mini, quiet, bare, narrow, className }: { date: string; rows: DayRow[]; snapshot: Snapshot | null; metricKey: MetricKey; forecast: Forecast; onZoom?: () => void; mini?: ReactNode; quiet?: boolean; bare?: boolean; narrow?: boolean | 'stack'; className?: string }) {
  const metric = metricOf(metricKey), value = snapshot?.metrics[metricKey];
  const cmp = metricCompare(date, rows, metricKey);
  const fc = metricKey === 'total_energy' && forecast && value?.value ? { now: valueOf(snapshot, metricKey) ?? 0, total: forecast.forecastKcal } : null;
  return <div className={`kcard ${className ?? ''}`} data-zoom={onZoom ? '' : undefined} onClick={onZoom}>
    <span className="k-label"><h3 className="th"><i style={{ background: groups[metric.group].color }} />{metric.label}</h3><span className="k-right">{!(quiet && value?.status === 'provisional') && <StatusChip value={value} compact />}</span></span>
    {(() => {
      const unit = value?.value && metric.unit ? <small>{metric.unit}</small> : null;
      const short = fc && forecast && narrow && <span className="k-fc narrow" title={`Prognoza do końca doby: ${nf(fc.total)} kcal. ${forecastHint(forecast)}`}><span aria-hidden="true">→ </span><span className="sr-only">Prognoza: </span><b>{nf(fc.total)}</b></span>;
      const tail = short && narrow === 'stack' ? <span className="k-stack">{short}{unit}</span> : <>{unit}{short || (fc && forecast && <span className="k-fc" title={forecastHint(forecast)}>Prognoza: <b>{nf(fc.total)}</b> kcal</span>)}</>;
      return <span className={`k-value ${value?.value ? value.status === 'provisional' ? 'prov' : '' : 'none'}${short && narrow === 'stack' ? ' stack' : ''}`}>{value?.value ? formatRational(value.value, metric.decimals) : '—'}{tail}</span>;
    })()}
    {!(bare && (value?.value || metric.group === 'body')) && <span className="k-cmp" title={cmp}>{cmp}</span>}
    {onZoom && mini !== null && <button type="button" className="chartbtn" aria-label={`Powiększ wykres: ${metric.label}`} onClick={(event) => { event.stopPropagation(); onZoom(); }}>{mini}</button>}</div>;
}

function HrCard({ onZoom, chart }: { onZoom: () => void; chart: ReactNode }) {
  return <div className="kcard chartonly" data-zoom onClick={onZoom}><span className="k-label"><h3 className="th"><i style={{ background: 'var(--c-band)' }} />Tętno</h3></span><button type="button" className="chartbtn" aria-label="Powiększ wykres: Tętno" onClick={(event) => { event.stopPropagation(); onZoom(); }}>{chart}</button></div>;
}

function UserNoteEditor({ date, initial, onDirty }: { date: string; initial: z.infer<typeof userNoteSchema> | null; onDirty: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(initial?.content ?? '');
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = draft !== (saved?.content ?? '');
  useEffect(() => () => onDirty(false), []);
  async function save() {
    setSaving(true); setError('');
    try {
      const response = await post('/api/day/note', { date, content: draft, expectedRevision: saved?.revision ?? null });
      if (response.status === 409) throw new Error('Notatka zmieniła się w innym oknie. Skopiuj swój tekst przed odświeżeniem.');
      if (!response.ok) throw new Error('Nie udało się zapisać notatki.');
      setSaved(userNoteSchema.parse(await response.json())); onDirty(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się zapisać notatki.'); }
    finally { setSaving(false); }
  }
  return <>
    <span className="k-label"><h3 className="th"><label htmlFor="usernote">Moja notatka</label></h3>
      <span className="note-state">{error ? <span role="alert" style={{ color: 'var(--bad)' }}>{error}</span> : <span role="status">{dirty ? 'Niezapisane zmiany' : ''}</span>}<button type="button" className="btn" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button></span></span>
    <textarea id="usernote" placeholder="Np. trening, choroba, podróż…" value={draft} maxLength={10000} disabled={saving} onChange={(event) => { setDraft(event.target.value); onDirty(event.target.value !== (saved?.content ?? '')); }} />
  </>;
}

const hourOptions: [HourKey, string][] = [['active', 'Aktywne kcal'], ['total', 'Spalone kcal'], ['steps', 'Kroki'], ['distance', 'Dystans']];
const hourKeyOf: Partial<Record<MetricKey, HourKey>> = { total_energy: 'total', active_energy: 'active', steps: 'steps', distance: 'distance' };
/** "Przebieg doby": the day's tiles in the user's layout; each chart is today's ten-minute course. A one-row tile shows the value without its chart. */
function DayFlow({ date, rows, hours, snapshot, legacy, seriesRead, loading, forecast, onZoom, notesAvailable, userNote, onDirty, editing, onEditing }: { date: string; rows: DayRow[]; hours: DayHours; snapshot: Snapshot | null; legacy: boolean; seriesRead: boolean; loading: boolean; forecast: Forecast; onZoom: (zoom: Zoom) => void; notesAvailable: boolean; userNote: z.infer<typeof userNoteSchema> | null; onDirty: (dirty: boolean) => void; editing: boolean; onEditing: (editing: boolean) => void }) {
  const [layout, setLayout] = useState(loadLayout);
  const change = (next: DayLayout) => { setLayout(next); saveLayout(next); };
  // no saved read (or the old calorie model with a few long intervals) has no honest ten-minute course: an empty chart, never zeros
  const empty = (key: HourKey) => !seriesRead || (legacy && (key === 'total' || key === 'active'));
  const summaryOf = (type: SummaryType) => snapshot?.summaries?.items.find((item) => item.type === type);
  const statRow = (id: StatId): StatRow => {
    if (id.startsWith('summary:')) { const row = summaryRowOf(id.slice(8) as SummaryType); return { id, label: row.label, hint: row.hint, ...summaryCells(row, summaryOf(row.type)) }; }
    const key = id.slice(7) as MetricKey, metric = metricOf(key), value = snapshot?.metrics[key];
    return { id, label: metric.label, value: value?.value ? `${formatRational(value.value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ''}` : '—', detail: '—' }; // no 7-day mean and no last measurement in the table
  };
  const render = ({ id, w, h }: Placed) => {
    if (id === 'hr') return <HrCard onZoom={() => onZoom({ type: 'hrday' })} chart={<HrDayMini windows={hours.hr} hours={hours.hours.length} />} />;
    if (id === 'note') return <div className="kcard notecard">{notesAvailable ? <UserNoteEditor key={date} date={date} initial={userNote} onDirty={onDirty} /> : <><span className="k-label"><h3 className="th">Moja notatka</h3></span><p className="sub">Notatki wymagają nowszej wersji bazy.</p></>}</div>;
    if (id === 'summaries') return <StatTable rows={layout.table.map(statRow)} editing={editing} onTile={(stat) => change(setPlace(layout, stat as StatId, 'tile'))} onHide={(stat) => change(removeFromTable(layout, stat as StatId))} />;
    if (id.startsWith('summary:')) { const row = summaryRowOf(id.slice(8) as SummaryType); return <SummaryCard row={row} item={summaryOf(row.type)} />; }
    const key = id.slice(7) as MetricKey, hk = hourKeyOf[key], chart = !!hk && h >= 2;
    return <KpiCard date={date} rows={rows} snapshot={snapshot} metricKey={key} forecast={forecast} quiet bare narrow={w < 3 ? 'stack' : w < 4} className={chart ? 'tall' : ''}
      onZoom={hk ? () => onZoom({ type: 'hour', key: hk }) : undefined}
      mini={hk && chart ? <DayMini hours={loading || empty(hk) ? [] : hours.hours} windows={hours.windows} metric={hk} /> : null} />;
  };
  return <TileBoard layout={layout} onLayout={change} editing={editing} onDone={() => onEditing(false)} render={render} />;
}

/** "Dane godzinowe": the hours of the day; values are the ten-minute windows summed per hour, heart rate is the min–max over the hour's windows. */
function DayHoursTable({ hours }: { hours: DayHours }) {
  return <section className="panel"><div className="tw hourtable"><table className="simple"><thead><tr><th>Godzina</th><th>Spalone kcal</th><th>Aktywne kcal</th><th>Kroki</th><th>Dystans km</th><th>Zakres tętna</th></tr></thead>
    <tbody>{hours.hours.map((hour) => <tr key={hour.start}><td className="mono">{hour.range}</td><td>{hour.total === null ? '—' : nf(hour.total)}</td><td>{hour.active === null ? '—' : nf(hour.active)}</td><td>{hour.steps === null ? '—' : nf(hour.steps)}</td><td>{hour.distance === null ? '—' : nf(hour.distance, 2)}</td><td>{hour.hrMin === null ? '—' : `${nf(hour.hrMin)}–${nf(hour.hrMax!)} bpm`}</td></tr>)}</tbody></table></div>
  </section>;
}

function DayZoom({ zoom, setZoom, showHr, onShowHr, snapshot, hours, legacy, seriesRead, loading, forecast, hrToday }: { zoom: Zoom; setZoom: (zoom: Zoom | null) => void; showHr: boolean; onShowHr: (show: boolean) => void; snapshot: Snapshot | null; hours: DayHours; legacy: boolean; seriesRead: boolean; loading: boolean; forecast: Forecast; hrToday: ReturnType<typeof hrOf> }) {
  const { W, H } = zoomSize(), close = () => setZoom(null);
  if (zoom.type === 'hour') {
    const none = !seriesRead || (legacy && (zoom.key === 'total' || zoom.key === 'active')) || hours.hours.every((hour) => hour[zoom.key] === null);
    const total = dayTotal(snapshot, zoom.key, hours.hours);
    const title = <>{hourMetricLabel(zoom.key)}{total ? `: ${total.text}${total.computed ? ' (suma godzin)' : ''}` : ''}{zoom.key === 'total' && forecast && <> · <span title={forecastHint(forecast)} style={{ cursor: 'help' }}>prognoza {nf(forecast.forecastKcal)} kcal</span></>}</>;
    return <ZoomDialog title={title} onClose={close}
      controls={<><Segmented label="Metryka" items={hourOptions} value={zoom.key} onChange={(key) => setZoom({ ...zoom, key })} />{hours.hr.length > 0 && <div className="seg" role="group" aria-label="Wykres tętna"><button type="button" aria-pressed={showHr} onClick={() => onShowHr(!showHr)}>Tętno</button></div>}</>}
      legend={none ? null : <>{zoom.key === 'total' && <EnergyLegend forecast={forecast ? forecastHint(forecast) : null} aggregate={aggregateSpans(hours.windows).size > 0} />}{showHr && hours.hr.length > 0 && <span><i style={{ background: 'var(--c-band)' }} />tętno, prawa oś (bpm)</span>}</>}>
      {loading ? <Loading /> : none ? <p className="sub">Brak rozkładu godzinowego dla tej doby.</p> : <HourChart windows={hours.windows} hours={hours.hours} metric={zoom.key} height={H} width={W} hr={showHr ? hours.hr : undefined} />}</ZoomDialog>;
  }
  return <ZoomDialog title={`Tętno${hrToday ? `: śr. ${nf(hrToday.avg)} · ${nf(hrToday.min)}–${nf(hrToday.max)} bpm` : ''}`} legend={HR_LEGEND} onClose={close}>
    {loading ? <Loading /> : <HrDayChart windows={hours.hr} slots={hours.slots} hours={hours.hours} height={H} width={W} />}</ZoomDialog>;}
