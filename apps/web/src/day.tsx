import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { bodyReviewSchema } from '../../../packages/contracts/source-records.ts';
import { bandShareSchema, dailyReviewSchema, dayResponseSchema, daySourcesSchema, forecastSchema, groups, heartRateDaySchema, heartRateRangeSchema, metricOf, metrics, post, rangeSchema, ruleOf, seriesSchema, sourceName, useJson, userNoteSchema, type DayRow, type Forecast, type MetricKey, type Snapshot, type SyncStatus } from './api.ts';
import { DayMini, EnergyLegend, HourChart, HR_LEGEND, HrDayChart, HrDayMini, HrSpark, HrTrendChart, InfoButton, Sparkline, TrendChart, Zoomable, type HourKey } from './charts.tsx';
import { axisEvents, dayHours, dayTip, dayTotal, heartTrend, hrOf, lastMeasured, meanValid, metricTrend, valueOf, type DayHours } from './derive.ts';
import { StatusChip, hourMetricLabel, type DrawerState } from './details.tsx';
import { addDays, fmtD, fmtDL, formatRational, maxDate, nf, timeOf, warsawToday, whenOf , firstDay } from './format.ts';
import { Placeholder } from './placeholders.tsx';
import { DateControl, Segmented, ZoomDialog, zoomSize } from './zoom.tsx';
import { z } from 'zod';
import { Loading } from './logo.tsx';

export type DayTab = 'podsumowanie' | 'przebieg' | 'pochodzenie' | 'jedzenie' | 'treningi';
type Zoom = { type: 'day'; key: MetricKey; len: number } | { type: 'hrdays'; len: number } | { type: 'hour'; key: HourKey; name: string } | { type: 'hrday' };
const lengths: [number, string][] = [[7, '7 dni'], [14, '14 dni'], [30, '30 dni'], [90, '90 dni']];
/** Days of the loaded window: the 90 days of the view plus 60 to move through before the next request. */
const windowDays = 150;
const windowEnd = (date: string, today: string) => { const later = addDays(date, 30); return later < today ? later : today; };

export function DayView({ metric, date, tab, onTab, onDate, sync, onDirty, onDrawer }: { metric: MetricKey | null; date: string; tab: DayTab; onTab: (tab: DayTab) => void; onDate: (date: string) => void; sync: SyncStatus | undefined; onDirty: (dirty: boolean) => void; onDrawer: (state: DrawerState) => void }) {
  const today = warsawToday(), isToday = date === today, read = date >= firstDay;
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [refresh, setRefresh] = useState(0);
  const day = useJson(`/api/day?date=${date}`, dayResponseSchema, refresh);
  // the 90 days up to the shown day come from a wider window that stays while moving day by day (no request, no flicker)
  const [anchor, setAnchor] = useState(() => windowEnd(date, today));
  let end = anchor;
  if (!(date <= anchor && addDays(date, -89) >= addDays(anchor, -(windowDays - 1)))) { end = windowEnd(date, today); if (end !== anchor) setAnchor(end); }
  const range = useJson(`/api/day-range?from=${addDays(end, -(windowDays - 1))}&to=${end}`, rangeSchema, refresh);
  const hrRange = useJson(read ? `/api/google/heart-rate-range?from=${maxDate(firstDay, addDays(end, -(windowDays - 1)))}&to=${end}` : null, heartRateRangeSchema, refresh);
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
  const hrSummaries = useMemo(() => (hrRange.data ?? []).filter((item) => item.date >= first && item.date <= date), [hrRange.data, first, date]);
  const hrToday = hrOf(hrSummaries.find((item) => item.date === date));
  const len = Math.round(hours.slots / 6);
  const asOf = sync?.last?.result === 'ok' ? sync.last.at : sync?.kinds.map((kind) => kind.lastReadAt).filter((at): at is string => !!at).sort().at(-1);
  const tabs: [DayTab, string, string?][] = [['przebieg', 'Przebieg doby'], ['podsumowanie', 'Podsumowanie'], ['pochodzenie', 'Pochodzenie danych'], ['jedzenie', 'Jedzenie', 'M3'], ['treningi', 'Treningi', 'M2']];
  // the date itself is the page title (topbar); here only what qualifies the day
  const head = <>{len !== 24 && <div className="daytitle">{len !== 24 && <span className="tag">doba {len} h · zmiana czasu</span>}</div>}
    <div className="tabs" role="tablist" aria-label="Widok dnia">{tabs.map(([key, label, stage]) => <button type="button" role="tab" key={key} aria-selected={tab === key} onClick={() => onTab(key)}>{label}{stage && <span className={`tag ${key === 'jedzenie' ? 'food' : ''}`}>{stage}</span>}</button>)}</div></>;
  const legacy = snapshot?.energy?.model === 'legacy';
  const hourly = { windows: hours.slots, legacy, read: total.data !== null && total.data !== undefined, forecast: fc };
  const openHourInfo = (key: HourKey) => onDrawer({ type: 'hourly', date, key, ...hourly });
  const openHrInfo = () => onDrawer({ type: 'hr', date, summary: hrToday, dayWindows: hours.slots });
  const loading = (read && total.data === undefined && !total.error) || !day.data;
  const zoomed = zoom && <DayZoom zoom={zoom} setZoom={setZoom} date={date} onDate={tab === 'przebieg' ? onDate : undefined} rows={rows} snapshot={snapshot} hours={hours} legacy={legacy} seriesRead={!!total.data} loading={loading} forecast={fc} hrSummaries={hrSummaries} hrToday={hrToday}
    onInfo={() => zoom.type === 'day' ? onDrawer({ type: 'cell', date, key: zoom.key }) : zoom.type === 'hour' ? openHourInfo(zoom.key) : openHrInfo()} />;
  if (day.error || range.error) return <>{head}<p role="alert">Nie udało się odczytać wyniku dnia. Sprawdź, czy serwer działa.</p>{zoomed}</>;
  if (!day.data) return <>{head}<Loading />{zoomed}</>;
  if (day.data.state === 'not_ready') return <>{head}<p>Wyniki dzienne nie są jeszcze przygotowane. Oryginalne dane znajdziesz w „Źródła danych”.</p>{zoomed}</>;

  let body;
  if (tab === 'przebieg') body = <DayFlow date={date} rows={rows} hours={hours} snapshot={snapshot} legacy={legacy} seriesRead={!!total.data} loading={loading} forecast={fc} hrSummaries={hrSummaries} hrToday={hrToday} onZoom={setZoom} onDrawer={onDrawer} onInfo={openHourInfo} onHrInfo={openHrInfo} />;
  else if (tab === 'pochodzenie') body = <DayProvenance key={`${date}-${metric}`} date={date} snapshot={snapshot} focus={metric} />;
  else if (tab === 'jedzenie') body = <Placeholder title="Dziennik jedzenia dnia" stage="M3" text="Tu pojawią się posiłki tego dnia, ich suma i pokrycie składników, a obok bilans z wydatkiem energii. Szczegóły zaprojektujemy razem z etapem M3." list={['Lista posiłków chronologicznie', 'Suma kcal i makr z oznaczeniem wpisów niepełnych', 'Bilans tylko dla dni z porównywalnym wydatkiem']} />;
  else if (tab === 'treningi') body = <Placeholder title="Treningi dnia" stage="M2" text="Sesje z czasem, tętnem, strefami i mapą trasy pojawią się w etapie M2. Kolumna „Treningi” w tabeli będzie ich zwięzłą projekcją." list={['Lista sesji dnia, np. „2 × spacer, 1 × rower”', 'Czas w strefach tętna i AZM osobno', 'Mapa trasy z TCX']} />;
  else body = <DaySummary date={date} rows={rows} snapshot={snapshot} hours={hours} legacy={legacy} seriesRead={!!total.data} forecast={fc} hrSummaries={hrSummaries} hrToday={hrToday}
    notesAvailable={day.data.notesAvailable} userNote={day.data.userNote} onDirty={onDirty} onZoom={setZoom} onDrawer={onDrawer} onHourInfo={openHourInfo} onHrInfo={openHrInfo} />;

  return <>{head}{body}{zoomed}</>;
}

/** `mini` replaces the 14-day sparkline (the day view puts today's ten-minute chart there; null: no chart); without `onZoom` the card is not clickable. */
function KpiCard({ date, rows, snapshot, metricKey, forecast, onZoom, onInfo, mini, quiet }: { date: string; rows: DayRow[]; snapshot: Snapshot | null; metricKey: MetricKey; forecast: Forecast; onZoom?: () => void; onInfo: () => void; mini?: ReactNode; quiet?: boolean }) {
  const metric = metricOf(metricKey), value = snapshot?.metrics[metricKey];
  const avg = meanValid(rows, metricKey, addDays(date, -7), addDays(date, -1));
  const week = `${fmtD(addDays(date, -7))}–${fmtD(addDays(date, -1))}`; // the 7 days before the shown day, without it
  let cmp: string;
  if (metric.group === 'body' && !value?.value) { const last = lastMeasured(rows, metricKey, addDays(date, -1)); cmp = last ? `ostatni pomiar ${nf(last.value, metric.decimals)} ${metric.unit} · ${fmtD(last.date)}` : 'brak pomiaru w ostatnich 90 dniach'; }
  else cmp = avg.mean !== null ? `śr. ${week}: ${nf(avg.mean, metric.decimals)} · ${avg.n} z 7 dób` : metric.group === 'body' ? 'brak pomiarów w 7 dniach' : 'brak potwierdzonych dób w 7 dniach';
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const spark = Array.from({ length: 14 }, (_, i) => { const at = addDays(date, i - 13), row = byDate.get(at); return { value: valueOf(row?.snapshot, metricKey), provisional: row?.snapshot?.metrics[metricKey].status === 'provisional', tip: dayTip(row, at, metricKey, at === date && metricKey === 'total_energy' ? forecast : undefined) }; });
  const fc = metricKey === 'total_energy' && forecast && value?.value ? { now: valueOf(snapshot, metricKey) ?? 0, total: forecast.forecastKcal } : null;
  return <div className="kcard" data-zoom={onZoom ? '' : undefined} onClick={onZoom}>
    <span className="k-label"><span>{metric.label}</span><span className="k-right">{!(quiet && value?.status === 'provisional') && <StatusChip value={value} compact />}<InfoButton label={metric.label} onClick={onInfo} /></span></span>
    <span className={`k-value ${value?.value ? value.status === 'provisional' ? 'prov' : '' : 'none'}`}>{value?.value ? formatRational(value.value, metric.decimals) : '—'}{value?.value && metric.unit ? <small>{metric.unit}</small> : null}{fc && <span className="k-fc">Prognoza: <b>{nf(fc.total)}</b> kcal</span>}</span>
    <span className="k-cmp">{cmp}</span>
    {onZoom && mini !== null && <button type="button" className="chartbtn" aria-label={`Powiększ wykres: ${metric.label}`} onClick={(event) => { event.stopPropagation(); onZoom(); }}>{mini ?? <Sparkline points={spark} form={metric.form} color={groups[metric.group].color} forecast={fc} />}</button>}</div>;
}

/** Mean of the day means of the 7 days before `date` (days without a measurement do not count) and how many days that was. */
function hrWeek(date: string, summaries: z.infer<typeof heartRateRangeSchema>) {
  const byDate = new Map(summaries.map((item) => [item.date, item]));
  const prev = Array.from({ length: 7 }, (_, i) => hrOf(byDate.get(addDays(date, i - 7)))).filter((item) => item !== null);
  return { byDate, n7: prev.length, avg7: prev.length ? prev.reduce((sum, item) => sum + item.avg, 0) / prev.length : null };
}
function HrCard({ date, hrToday, avg7, n7, onZoom, onInfo, chart, quiet }: { date: string; hrToday: ReturnType<typeof hrOf>; avg7: number | null; n7: number; onZoom: () => void; onInfo: () => void; chart: ReactNode; quiet?: boolean }) {
  return <div className="kcard" data-zoom onClick={onZoom}>
    <span className="k-label"><span>Tętno</span><span className="k-right">{!quiet && date === warsawToday() && hrToday && <span className="chip prov">w toku</span>}<InfoButton label="Tętno" onClick={onInfo} /></span></span>
    <span className={`k-value ${hrToday ? '' : 'none'}`}>{hrToday ? nf(hrToday.avg) : '—'}{hrToday && <><small>bpm</small><span className="k-fc" style={{ color: 'var(--c-band)' }}>{nf(hrToday.min)}–{nf(hrToday.max)} bpm</span></>}</span>
    <span className="k-cmp">{hrToday ? avg7 !== null ? `śr. ${fmtD(addDays(date, -7))}–${fmtD(addDays(date, -1))}: ${nf(avg7)} · ${n7} z 7 dób` : 'brak pomiarów w 7 dniach' : 'Brak pomiarów tętna tej doby'}</span>
    <button type="button" className="chartbtn" aria-label="Powiększ wykres: Tętno" onClick={(event) => { event.stopPropagation(); onZoom(); }}>{chart}</button></div>;
}

function DaySummary(props: { date: string; rows: DayRow[]; snapshot: Snapshot | null; hours: DayHours; legacy: boolean; seriesRead: boolean; forecast: Forecast; hrSummaries: z.infer<typeof heartRateRangeSchema>; hrToday: ReturnType<typeof hrOf>;
  notesAvailable: boolean; userNote: z.infer<typeof userNoteSchema> | null; onDirty: (dirty: boolean) => void; onZoom: (zoom: Zoom) => void; onDrawer: (state: DrawerState) => void; onHourInfo: (key: HourKey) => void; onHrInfo: () => void }) {
  const { date, rows, snapshot, hours, forecast, hrToday } = props;
  const { byDate, avg7, n7 } = hrWeek(date, props.hrSummaries);
  const hrSpark = Array.from({ length: 14 }, (_, i) => { const at = addDays(date, i - 13), item = hrOf(byDate.get(at)); return { avg: item?.avg ?? null, min: item?.min ?? null, max: item?.max ?? null, tip: [fmtDL(at), item ? `śr. ${nf(item.avg)} bpm` : '—', item ? `${nf(item.min)}–${nf(item.max)} bpm` : ''] }; });
  const card = (key: MetricKey) => <KpiCard key={key} date={date} rows={rows} snapshot={snapshot} metricKey={key} forecast={forecast} onZoom={() => props.onZoom({ type: 'day', key, len: 30 })} onInfo={() => props.onDrawer({ type: 'cell', date, key })} />;
  const noHours = !props.seriesRead || props.legacy;
  const hasHr = props.hours.hr.length > 0;
  return <>
    <div className="kpis">
      {(['energy', 'activity', 'body'] as const).map((group) => <section key={group} className="kgroup" style={{ '--gc': groups[group].color } as React.CSSProperties}><h3>{groups[group].label}</h3>
        {metrics.filter((metric) => metric.group === group).map((metric) => card(metric.key))}
        {group === 'body' && <HrCard date={date} hrToday={hrToday} avg7={avg7} n7={n7} onZoom={() => props.onZoom({ type: 'hrdays', len: 30 })} onInfo={props.onHrInfo} chart={<HrSpark points={hrSpark} />} />}
      </section>)}
      <section className="kgroup" style={{ '--gc': 'var(--c-food)' } as React.CSSProperties}><h3>Jedzenie <span className="tag food">M3</span></h3>
        <div className="kcard placeholder"><strong>Spożyte kalorie i makro</strong><p>Pojawi się z dziennikiem posiłków.</p></div>
        <div className="kcard placeholder"><strong>Bilans energii</strong><p>Tylko dla dni z porównywalnym wydatkiem; doba z samym BMR nie pokaże deficytu.</p></div></section>
    </div>
    <div className="cols2">
      <section className="panel"><header><h3>Doba w skrócie</h3><div className="hdr-r"><div className="legend">{!noHours && <EnergyLegend forecast={!!forecast} />}{hasHr && <span><i style={{ background: 'var(--c-band)' }} />tętno</span>}</div><InfoButton label="Doba w skrócie" onClick={() => props.onHourInfo('total')} /></div></header>
        {noHours ? <p className="sub">{!props.seriesRead ? 'Brak zapisanego odczytu okien 10-minutowych dla tej doby.' : 'Starszy model źródła: producent zapisał kalorie w kilku długich przedziałach, więc brak rozkładu godzinowego.'}</p>
          : <Zoomable label="doba w skrócie" onZoom={() => props.onZoom({ type: 'hour', key: 'total', name: 'Doba w skrócie' })}><HourChart windows={hours.windows} hours={hours.hours} metric="total" height={120} /></Zoomable>}
        {hasHr && <Zoomable label="tętno" style={{ marginTop: 10 }} onZoom={() => props.onZoom({ type: 'hrday' })}><HrDayChart windows={hours.hr} slots={hours.slots} hours={hours.hours} height={76} /></Zoomable>}
      </section>
      <section className="panel"><header><h3>Uwagi</h3><span className="sub">automatyczne, z oceny metryk</span></header>
        <ul className="notes">{snapshot?.notes.length ? snapshot.notes.map((note) => <li key={note}>{note}</li>) : <li className="ok">{snapshot ? 'Brak uwag dla tego dnia.' : date >= '2026-01-01' && date < warsawToday() ? 'Brak odczytu Google dla tej doby (uzupełnianie historii ją nadrobi).' : 'Brak obliczonego wyniku dla tej doby.'}</li>}</ul>
        {props.notesAvailable && <UserNoteEditor key={date} date={date} initial={props.userNote} onDirty={props.onDirty} />}
      </section>
    </div>
  </>;
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
    <header style={{ marginTop: 16 }}><h3><label htmlFor="usernote">Moja notatka</label></h3><span className="sub">nie zmienia się przy przeliczeniu</span></header>
    <textarea id="usernote" placeholder="Np. trening, choroba, podróż…" value={draft} maxLength={10000} disabled={saving} onChange={(event) => { setDraft(event.target.value); onDirty(event.target.value !== (saved?.content ?? '')); }} />
    <div className="rowend">{error ? <span role="alert" style={{ color: 'var(--bad)' }}>{error}</span> : <span role="status">{dirty ? 'Niezapisane zmiany' : saved ? `Zapisano ${whenOf(saved.createdAt)}` : ''}</span>}<button type="button" className="btn" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Zapisywanie…' : 'Zapisz notatkę'}</button></div>
  </>;
}

const hourOptions: [HourKey, string][] = [['active', 'Aktywne kcal'], ['total', 'Spalone kcal'], ['steps', 'Kroki'], ['distance', 'Dystans']];
const hourKeyOf: Partial<Record<MetricKey, HourKey>> = { total_energy: 'total', active_energy: 'active', steps: 'steps', distance: 'distance' };
/** "Przebieg doby": the cards of the summary, but each chart is today's ten-minute course instead of the last 14 days. */
function DayFlow({ date, rows, hours, snapshot, legacy, seriesRead, loading, forecast, hrSummaries, hrToday, onZoom, onDrawer, onInfo, onHrInfo }: { date: string; rows: DayRow[]; hours: DayHours; snapshot: Snapshot | null; legacy: boolean; seriesRead: boolean; loading: boolean; forecast: Forecast; hrSummaries: z.infer<typeof heartRateRangeSchema>; hrToday: ReturnType<typeof hrOf>; onZoom: (zoom: Zoom) => void; onDrawer: (state: DrawerState) => void; onInfo: (key: HourKey) => void; onHrInfo: () => void }) {
  const { avg7, n7 } = hrWeek(date, hrSummaries);
  // no saved read (or the old calorie model with a few long intervals) has no honest ten-minute course: an empty chart, never zeros
  const empty = (key: HourKey) => !seriesRead || (legacy && (key === 'total' || key === 'active'));
  const card = (key: MetricKey) => {
    const hk = hourKeyOf[key];
    return <KpiCard key={key} date={date} rows={rows} snapshot={snapshot} metricKey={key} forecast={forecast} quiet
      onZoom={hk ? () => onZoom({ type: 'hour', key: hk, name: 'Przebieg doby' }) : undefined} onInfo={() => hk ? onInfo(hk) : onDrawer({ type: 'cell', date, key })}
      mini={hk ? <DayMini hours={loading || empty(hk) ? [] : hours.hours} metric={hk} /> : undefined} />;
  };
  return <>
    <div className="kpis kpis-3">
      {(['energy', 'activity', 'body'] as const).map((group) => <section key={group} className="kgroup" style={{ '--gc': groups[group].color } as React.CSSProperties}><h3>{groups[group].label}</h3>
        {metrics.filter((metric) => metric.group === group).map((metric) => card(metric.key))}
        {group === 'body' && <HrCard quiet date={date} hrToday={hrToday} avg7={avg7} n7={n7} onZoom={() => onZoom({ type: 'hrday' })} onInfo={onHrInfo} chart={<HrDayMini windows={hours.hr} hours={hours.hours.length} />} />}
      </section>)}
    </div>
    <section className="panel"><header><h3>Dane godzinowe</h3><span className="sub">{hours.slots} okien 10-min w {Math.round(hours.slots / 6)} godzinach</span></header>
      <details className="diag"><summary>Tabela danych godzinowych</summary><div className="tw"><table className="simple"><thead><tr><th>Godzina</th><th>Spalone kcal</th><th>Aktywne kcal</th><th>Kroki</th><th>Dystans km</th><th>Okna z tętnem</th>{forecast && <th>Prognoza kcal</th>}</tr></thead>
        <tbody>{hours.hours.map((hour) => <tr key={hour.start}><td className="mono">{hour.range}</td><td>{hour.total === null ? '—' : nf(hour.total)}</td><td>{hour.active === null ? '—' : nf(hour.active)}</td><td>{hour.steps === null ? '—' : nf(hour.steps)}</td><td>{hour.distance === null ? '—' : nf(hour.distance, 2)}</td><td>{hour.future || hour.hrWindows === null ? '—' : `${hour.hrWindows} z 6`}</td>{forecast && <td>{hour.fc === null ? '—' : nf(hour.fc)}</td>}</tr>)}</tbody></table></div></details>
    </section>
  </>;
}

const dailyReadKind: Partial<Record<MetricKey, string>> = { steps: 'steps', distance: 'distance', total_energy: 'total-calories', active_energy: 'active-energy-burned' };
const shortList = 5;
/** One metric's saved records of the day: the day's value, then each record with its Warsaw time (body: time of the measurement and its source; others: time of each read). */
function MetricRecords({ date, metricKey, snapshot, open }: { date: string; metricKey: MetricKey; snapshot: Snapshot | null; open: boolean }) {
  const metric = metricOf(metricKey), read = date >= firstDay, body = metricKey === 'weight' || metricKey === 'body_fat';
  const [all, setAll] = useState(open);
  const reads = useJson(read && !body ? `/api/google/daily-candidates?kind=${dailyReadKind[metricKey]}&date=${date}` : null, dailyReviewSchema);
  const measurements = useJson(read && body ? `/api/google/body-candidates?kind=${metricKey}&date=${date}` : null, bodyReviewSchema);
  const value = snapshot?.metrics[metricKey];
  const unit = metric.unit ? ` ${metric.unit}` : '';
  const items: { time: string; value: string; note: string }[] = body
    ? (measurements.data?.rows ?? []).map((row) => ({ time: whenOf(row.timestamp), value: row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : '—', note: row.origin || 'źródło nieznane' }))
    : (reads.data?.rows ?? []).map((row, index, list) => ({ time: whenOf(row.jobStartedAt ?? row.receivedAt), value: row.converted ? `${nf(Number(row.converted.value), metric.decimals)} ${row.converted.unit}` : row.originalValue, note: row.state === 'running' ? 'pobieranie w toku, jeszcze nieużyte' : index === list.findIndex((other) => other.state !== 'running') ? 'użyty w wyniku dnia (ostatnio rozpoczęte pobranie)' : 'starsze pobranie, zachowane' }));
  const failed = reads.error || measurements.error, loading = read && !failed && !(body ? measurements.data : reads.data);
  const shown = all ? items : items.slice(0, shortList);
  return <tbody className={open ? 'focus' : undefined}>
    <tr className="mrow"><th scope="row" className="l">{metric.label}</th><td className="num">{value?.value ? <b>{formatRational(value.value, metric.decimals)}{unit}</b> : <span className="v-none">—</span>} <StatusChip value={value} compact /></td><td className="l faint" colSpan={2}>wartość dnia</td></tr>
    {!read ? <tr><td /><td className="l faint" colSpan={3}>Doba sprzed zakresu odczytów.</td></tr>
      : failed ? <tr><td /><td className="l" colSpan={3} role="alert">Nie udało się odczytać zapisów.</td></tr>
      : loading ? <tr><td /><td colSpan={3}><Loading /></td></tr>
      : items.length === 0 ? <tr><td /><td className="l faint" colSpan={3}>{body ? 'Brak zapisanego pomiaru tej doby.' : 'Brak zapisanego odczytu tej doby.'}</td></tr>
      : shown.map((item, index) => <tr key={index}><td /><td className="num">{item.value}</td><td className="l">{item.time}</td><td className="l faint">{item.note}</td></tr>)}
    {items.length > shortList && <tr><td /><td className="l" colSpan={3}><button type="button" className="btn ghost" onClick={() => setAll(!all)}>{all ? 'Pokaż mniej' : `Pokaż wszystkie (${items.length})`}</button></td></tr>}
  </tbody>;
}

function DayProvenance({ date, snapshot, focus }: { date: string; snapshot: Snapshot | null; focus: MetricKey | null }) {
  const read = date >= firstDay;
  const sources = useJson(read ? `/api/google/day-sources?from=${date}&to=${date}` : null, daySourcesSchema);
  const band = useJson(read ? `/api/google/band-share?date=${date}` : null, bandShareSchema);
  const day = sources.data?.[0];
  const names = new Map<string, { name: string; steps: number | null; active: number | null }>();
  for (const [field, items] of [['steps', day?.steps], ['active', day?.activeEnergy]] as const) for (const item of items ?? []) {
    const name = sourceName(item.source), current = names.get(name) ?? { name, steps: null, active: null };
    current[field] = (current[field] ?? 0) + item.records; names.set(name, current);
  }
  const role = (name: string) => name.startsWith('Opaska') ? 'urządzenie; producent wybiera je dla kroków, gdy mierzyło' : name.startsWith('Health Connect') || name.includes('(Health Connect)') ? 'kopia przez Health Connect, uzgadniana przez producenta' : 'źródło telefonu, uzgadniane przez producenta';
  return <div className="cols2">
    <section className="panel"><header><h3>Zapisy dnia</h3><span className="sub">czasy w strefie Europe/Warsaw</span></header>
      <div className="tw"><table className="simple"><thead><tr><th className="l">Metryka</th><th>Wartość</th><th className="l">Czas</th><th className="l">Uwaga</th></tr></thead>
        {metrics.map((item) => <MetricRecords key={item.key} date={date} metricKey={item.key} snapshot={snapshot} open={focus === item.key} />)}
      </table></div>
      <p className="sub" style={{ margin: '10px 0 0' }}>Wartość dnia to uzgodnienie producenta, nigdy suma odczytów ani kopii z kilku źródeł. Przy masie i tkance czas to chwila pomiaru, przy pozostałych metrykach czas rozpoczęcia pobrania danych z Google.</p>
    </section>
    <section className="panel"><header><h3>Kto zapisał dane tego dnia</h3><span className="sub">liczba wpisów z najnowszego pełnego odczytu</span></header>
      {sources.error ? <p role="alert">Nie udało się odczytać źródeł.</p> : !read ? <p className="sub">Doba sprzed zakresu odczytów.</p> : !sources.data ? <Loading /> : <div className="tw"><table className="simple"><thead><tr><th>Źródło</th><th>Kroki</th><th>Kalorie aktywne</th><th>Rola</th></tr></thead><tbody>
        {day?.steps === null && day?.activeEnergy === null ? <tr><td colSpan={4}>Brak odczytu listy źródeł dla tej doby.</td></tr> : names.size === 0 ? <tr><td colSpan={4}>Odczyt nie zawiera wpisów.</td></tr>
          : [...names.values()].sort((a, b) => (b.steps ?? 0) + (b.active ?? 0) - (a.steps ?? 0) - (a.active ?? 0)).map((item) => <tr key={item.name}><td>{item.name}{item.name.startsWith('Opaska') && <> <span className="tag">urządzenie</span></>}</td><td className="num">{day?.steps === null ? 'nie odczytano' : item.steps ?? '—'}</td><td className="num">{day?.activeEnergy === null ? 'nie odczytano' : item.active ?? '—'}</td><td>{role(item.name)}</td></tr>)}
      </tbody></table></div>}
      <p className="sub" style={{ margin: '10px 0 0' }}>Ten sam ruch bywa zapisany przez kilka źródeł. Wartość dnia to uzgodnienie producenta, nigdy suma kopii.</p>
      {band.data?.heartRate && <p className="sub" style={{ margin: '10px 0 0' }}>Tętno z urządzenia w {band.data.heartRate.windows} z {band.data.totalWindows} okien ({nf(band.data.heartRate.windows / band.data.totalWindows * 100)} % doby). To dowód pomiaru, nie noszenia przez całe okno.</p>}
      <CsvDayOrigin date={date} snapshot={snapshot} />
    </section>
  </div>;
}

const csvOriginSchema = z.array(z.object({ id: z.string(), fileName: z.string(), createdAt: z.string(), state: z.enum(['included', 'excluded']), metrics: z.array(z.string()), note: z.object({ action: z.enum(['apply', 'withdraw']), revision: z.number() }).nullable() }));
/** Which CSV imports hold data of this day; origin is shown here, not in the table or the day's summary. */
function CsvDayOrigin({ date, snapshot }: { date: string; snapshot: Snapshot | null }) {
  const imports = useJson(`/api/csv/day?date=${date}`, csvOriginSchema);
  if (imports.error || !imports.data || imports.data.length === 0) return null;
  const used = new Set(snapshot?.csv?.metrics ?? []);
  return <>
    <header style={{ marginTop: 16 }}><h3>Importy CSV</h3><span className="sub">dane tej doby z plików</span></header>
    <ul className="timeline">{imports.data.map((item) => {
      const metrics = item.metrics.map((key) => `${metricOf(key as MetricKey).label}${item.state === 'included' ? used.has(key as MetricKey) ? ' (w wyniku)' : ' (wartość Google ma pierwszeństwo)' : ''}`);
      const note = item.note ? item.note.action === 'apply' ? `notatka r-${item.note.revision}: dopisane uwagi` : `notatka r-${item.note.revision}: uwagi wycofane` : null;
      return <li key={item.id}><span>{whenOf(item.createdAt)}</span><span>{item.fileName}{item.state === 'excluded' ? ' · wycofany' : ''}{metrics.length ? ` · ${metrics.join(', ')}` : ''}{note ? ` · ${note}` : ''}</span></li>;
    })}</ul>
  </>;
}

function DayZoom({ zoom, setZoom, date, onDate, rows, snapshot, hours, legacy, seriesRead, loading, forecast, hrSummaries, hrToday, onInfo }: { zoom: Zoom; setZoom: (zoom: Zoom | null) => void; date: string; onDate?: (date: string) => void; rows: DayRow[]; snapshot: Snapshot | null; hours: DayHours; legacy: boolean; seriesRead: boolean; loading: boolean; forecast: Forecast; hrSummaries: z.infer<typeof heartRateRangeSchema>; hrToday: ReturnType<typeof hrOf>; onInfo: () => void }) {
  const { W, H } = zoomSize(), close = () => setZoom(null);
  const dates = onDate ? <DateControl date={date} onDate={onDate} /> : null;
  if (zoom.type === 'hour') {
    const none = !seriesRead || (legacy && (zoom.key === 'total' || zoom.key === 'active')) || hours.hours.every((hour) => hour[zoom.key] === null);
    const total = dayTotal(snapshot, zoom.key, hours.hours);
    const title = `${zoom.name} · ${hourMetricLabel(zoom.key)}${total ? `: ${total.text}${total.computed ? ' (suma godzin)' : ''}` : ''}${zoom.key === 'total' && forecast ? ` · prognoza ${nf(forecast.forecastKcal)} kcal` : ''}`;
    return <ZoomDialog title={title} onClose={close} onInfo={onInfo}
      controls={<>{dates}<Segmented label="Metryka" items={hourOptions} value={zoom.key} onChange={(key) => setZoom({ ...zoom, key })} /></>}
      legend={none ? null : <>{zoom.key === 'total' && <EnergyLegend forecast={!!forecast} />}{hours.hr.length > 0 && <span><i style={{ background: 'var(--c-band)' }} />tętno, prawa oś (bpm)</span>}</>}>
      {loading ? <Loading /> : none ? <p className="sub">Brak rozkładu godzinowego dla tej doby.</p> : <HourChart windows={hours.windows} hours={hours.hours} metric={zoom.key} height={H} width={W} hr={hours.hr} />}</ZoomDialog>;
  }
  if (zoom.type === 'hrday') return <ZoomDialog title={`Tętno${hrToday ? `: śr. ${nf(hrToday.avg)} · ${nf(hrToday.min)}–${nf(hrToday.max)} bpm` : ''}`} controls={dates} legend={HR_LEGEND} onClose={close} onInfo={onInfo}>
    {loading ? <Loading /> : <HrDayChart windows={hours.hr} slots={hours.slots} hours={hours.hours} height={H} width={W} />}</ZoomDialog>;
  const from = addDays(date, -(zoom.len - 1)), sub = `${fmtD(from)} – ${fmtD(date)} · wyróżniony wybrany dzień`;
  const controls = <>{dates}<Segmented label="Zakres" items={lengths} value={zoom.len} onChange={(len) => setZoom({ ...zoom, len })} /></>;
  if (zoom.type === 'hrdays') {
    const start = maxDate(firstDay, from);
    return <ZoomDialog title="Tętno" sub={sub} controls={controls} legend={HR_LEGEND} onClose={close} onInfo={onInfo}><HrTrendChart points={heartTrend(hrSummaries, start, date, 'day')} highlight={date} width={W} height={H} /></ZoomDialog>;
  }
  const metric = metricOf(zoom.key), slice = rows.filter((row) => row.date >= from && row.date <= date);
  const fc = zoom.key === 'total_energy' && forecast ? { now: valueOf(rows.at(-1)?.snapshot, 'total_energy') ?? 0, total: forecast.forecastKcal } : null;
  return <ZoomDialog title={metric.label} sub={sub} controls={controls} onClose={close} onInfo={onInfo}>
    <TrendChart points={metricTrend(slice, zoom.key, 'day', forecast)} form={metric.form} color={groups[metric.group].color} decimals={metric.decimals} label={metric.label} events={axisEvents(slice, zoom.key, false)} highlight={date} forecast={fc} width={W} height={H} /></ZoomDialog>;
}
