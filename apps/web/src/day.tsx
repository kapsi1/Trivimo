import { useEffect, useState } from 'react';
import { bandShareSchema, dailyReviewSchema, dayResponseSchema, daySourcesSchema, forecastSchema, groups, heartRateDaySchema, heartRateRangeSchema, metricOf, metrics, post, rangeSchema, ruleOf, seriesSchema, sourceName, useJson, userNoteSchema, type DayRow, type Forecast, type MetricKey, type Snapshot, type SyncStatus } from './api.ts';
import { EnergyLegend, HourChart, HR_LEGEND, HrDayChart, HrSpark, HrTrendChart, InfoButton, Sparkline, TrendChart, Zoomable, type HourKey } from './charts.tsx';
import { axisEvents, dayHours, dayTip, dayTotal, heartTrend, hrOf, lastMeasured, meanValid, metricTrend, valueOf, type DayHours } from './derive.ts';
import { StatusChip, hourMetricLabel, type DrawerState } from './details.tsx';
import { addDays, fmtD, fmtDL, formatRational, maxDate, nf, timeOf, warsawToday, whenOf , firstDay } from './format.ts';
import { Placeholder } from './placeholders.tsx';
import { DateControl, Segmented, ZoomDialog, zoomSize } from './zoom.tsx';
import type { z } from 'zod';

export type DayTab = 'podsumowanie' | 'przebieg' | 'pochodzenie' | 'jedzenie' | 'treningi';
type Zoom = { type: 'day'; key: MetricKey; len: number } | { type: 'hrdays'; len: number } | { type: 'hour'; key: HourKey; name: string } | { type: 'hrday' };
const lengths: [number, string][] = [[7, '7 dni'], [14, '14 dni'], [30, '30 dni'], [90, '90 dni']];

export function DayView({ date, tab, onTab, onDate, sync, onDirty, onDrawer }: { date: string; tab: DayTab; onTab: (tab: DayTab) => void; onDate: (date: string) => void; sync: SyncStatus | undefined; onDirty: (dirty: boolean) => void; onDrawer: (state: DrawerState) => void }) {
  const today = warsawToday(), isToday = date === today, read = date >= firstDay;
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [refresh, setRefresh] = useState(0);
  const day = useJson(`/api/day?date=${date}`, dayResponseSchema, refresh);
  const range = useJson(`/api/day-range?from=${addDays(date, -89)}&to=${date}`, rangeSchema, refresh);
  const hrRange = useJson(read ? `/api/google/heart-rate-range?from=${maxDate(firstDay, addDays(date, -89))}&to=${date}` : null, heartRateRangeSchema, refresh);
  const heart = useJson(read ? `/api/google/heart-rate?date=${date}` : null, heartRateDaySchema, refresh);
  const total = useJson(read ? `/api/google/day-series?metric=total-calories&date=${date}` : null, seriesSchema, refresh);
  const active = useJson(read ? `/api/google/day-series?metric=active-energy-burned&date=${date}` : null, seriesSchema, refresh);
  const steps = useJson(read ? `/api/google/day-series?metric=steps&date=${date}` : null, seriesSchema, refresh);
  const distance = useJson(read ? `/api/google/day-series?metric=distance&date=${date}` : null, seriesSchema, refresh);
  const forecast = useJson(isToday ? `/api/google/energy-forecast?date=${date}` : null, forecastSchema, refresh);
  // a new sync result refreshes the day in progress
  useEffect(() => { if (isToday && sync?.last?.at) setRefresh((value) => value + 1); }, [sync?.last?.at]);

  const rows = range.data?.state === 'ready' ? range.data.days : [];
  const snapshot = day.data?.state === 'ready' ? day.data.snapshot : null;
  const fc = forecast.data ?? null;
  const hours = dayHours(date, { total: total.data, active: active.data, steps: steps.data, distance: distance.data }, heart.data ?? undefined, fc ?? undefined, isToday);
  const hrSummaries = hrRange.data ?? [];
  const hrToday = hrOf(hrSummaries.find((item) => item.date === date));
  const len = Math.round(hours.slots / 6);
  const asOf = sync?.last?.result === 'ok' ? sync.last.at : sync?.kinds.map((kind) => kind.lastReadAt).filter((at): at is string => !!at).sort().at(-1);
  const tabs: [DayTab, string, string?][] = [['przebieg', 'Przebieg doby'], ['podsumowanie', 'Podsumowanie'], ['pochodzenie', 'Pochodzenie danych'], ['jedzenie', 'Jedzenie', 'M3'], ['treningi', 'Treningi', 'M2']];
  const head = <><div className="daytitle"><h2>{fmtDL(date)}</h2>{isToday && <span className="live">w toku{asOf ? ` · stan na ${timeOf(asOf)}` : ''}</span>}{len !== 24 && <span className="tag">doba {len} h · zmiana czasu</span>}</div>
    <div className="tabs" role="tablist" aria-label="Widok dnia">{tabs.map(([key, label, stage]) => <button type="button" role="tab" key={key} aria-selected={tab === key} onClick={() => onTab(key)}>{label}{stage && <span className={`tag ${key === 'jedzenie' ? 'food' : ''}`}>{stage}</span>}</button>)}</div></>;
  const legacy = snapshot?.energy?.model === 'legacy';
  const hourly = { windows: hours.slots, legacy, read: total.data !== null && total.data !== undefined, forecast: fc };
  const openHourInfo = (key: HourKey) => onDrawer({ type: 'hourly', date, key, ...hourly });
  const openHrInfo = () => onDrawer({ type: 'hr', date, summary: hrToday, dayWindows: hours.slots });
  const loading = (read && total.data === undefined && !total.error) || !day.data;
  const zoomed = zoom && <DayZoom zoom={zoom} setZoom={setZoom} date={date} onDate={tab === 'przebieg' ? onDate : undefined} rows={rows} snapshot={snapshot} hours={hours} legacy={legacy} seriesRead={!!total.data} loading={loading} forecast={fc} hrSummaries={hrSummaries} hrToday={hrToday}
    onInfo={() => zoom.type === 'day' ? onDrawer({ type: 'cell', date, key: zoom.key }) : zoom.type === 'hour' ? openHourInfo(zoom.key) : openHrInfo()} />;
  if (day.error || range.error) return <>{head}<p role="alert">Nie udało się odczytać wyniku dnia. Sprawdź, czy serwer działa.</p>{zoomed}</>;
  if (!day.data) return <>{head}<p>Ładowanie…</p>{zoomed}</>;
  if (day.data.state === 'not_ready') return <>{head}<p>Wyniki dzienne nie są jeszcze przygotowane. Oryginalne dane znajdziesz w „Źródła danych”.</p>{zoomed}</>;

  let body;
  if (tab === 'przebieg') body = <DayHourly date={date} hours={hours} snapshot={snapshot} legacy={legacy} seriesRead={!!total.data} loading={loading} forecast={fc} hrToday={hrToday} onZoom={setZoom} onInfo={openHourInfo} onHrInfo={openHrInfo} />;
  else if (tab === 'pochodzenie') body = <DayProvenance date={date} snapshot={snapshot} slots={hours.slots} />;
  else if (tab === 'jedzenie') body = <Placeholder title="Dziennik jedzenia dnia" stage="M3" text="Tu pojawią się posiłki tego dnia, ich suma i pokrycie składników, a obok bilans z wydatkiem energii. Szczegóły zaprojektujemy razem z etapem M3." list={['Lista posiłków chronologicznie', 'Suma kcal i makr z oznaczeniem wpisów niepełnych', 'Bilans tylko dla dni z porównywalnym wydatkiem']} />;
  else if (tab === 'treningi') body = <Placeholder title="Treningi dnia" stage="M2" text="Sesje z czasem, tętnem, strefami i mapą trasy pojawią się w etapie M2. Kolumna „Treningi” w tabeli będzie ich zwięzłą projekcją." list={['Lista sesji dnia, np. „2 × spacer, 1 × rower”', 'Czas w strefach tętna i AZM osobno', 'Mapa trasy z TCX']} />;
  else body = <DaySummary date={date} rows={rows} snapshot={snapshot} hours={hours} legacy={legacy} seriesRead={!!total.data} forecast={fc} hrSummaries={hrSummaries} hrToday={hrToday}
    notesAvailable={day.data.notesAvailable} userNote={day.data.userNote} onDirty={onDirty} onZoom={setZoom} onDrawer={onDrawer} onHourInfo={openHourInfo} onHrInfo={openHrInfo} />;

  return <>{head}{body}{zoomed}</>;
}

function KpiCard({ date, rows, snapshot, metricKey, forecast, onZoom, onInfo }: { date: string; rows: DayRow[]; snapshot: Snapshot | null; metricKey: MetricKey; forecast: Forecast; onZoom: () => void; onInfo: () => void }) {
  const metric = metricOf(metricKey), value = snapshot?.metrics[metricKey];
  const avg = meanValid(rows, metricKey, addDays(date, -7), addDays(date, -1));
  let cmp: string;
  if (metric.group === 'body' && !value?.value) { const last = lastMeasured(rows, metricKey, addDays(date, -1)); cmp = last ? `ostatni pomiar ${nf(last.value, metric.decimals)} ${metric.unit} · ${fmtD(last.date)}` : 'brak pomiaru w ostatnich 90 dniach'; }
  else cmp = avg.mean !== null ? `śr. 7 dni ${nf(avg.mean, metric.decimals)} · ${avg.n} z 7 dób` : metric.group === 'body' ? 'brak pomiarów w 7 dniach' : 'brak potwierdzonych dób w 7 dniach';
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const spark = Array.from({ length: 14 }, (_, i) => { const at = addDays(date, i - 13), row = byDate.get(at); return { value: valueOf(row?.snapshot, metricKey), provisional: row?.snapshot?.metrics[metricKey].status === 'provisional', tip: dayTip(row, at, metricKey, at === date && metricKey === 'total_energy' ? forecast : undefined) }; });
  const fc = metricKey === 'total_energy' && forecast && value?.value ? { now: valueOf(snapshot, metricKey) ?? 0, total: forecast.forecastKcal } : null;
  return <div className="kcard" data-zoom onClick={onZoom}>
    <span className="k-label"><span>{metric.label}</span><span className="k-right"><StatusChip value={value} compact /><InfoButton label={metric.label} onClick={onInfo} /></span></span>
    <span className={`k-value ${value?.value ? value.status === 'provisional' ? 'prov' : '' : 'none'}`}>{value?.value ? formatRational(value.value, metric.decimals) : '—'}{value?.value && metric.unit ? <small>{metric.unit}</small> : null}{fc && <span className="k-fc">Prognoza: <b>{nf(fc.total)}</b> kcal</span>}</span>
    <span className="k-cmp">{cmp}</span>
    <button type="button" className="chartbtn" aria-label={`Powiększ wykres: ${metric.label}`} onClick={(event) => { event.stopPropagation(); onZoom(); }}><Sparkline points={spark} form={metric.form} color={groups[metric.group].color} forecast={fc} /></button></div>;
}

function DaySummary(props: { date: string; rows: DayRow[]; snapshot: Snapshot | null; hours: DayHours; legacy: boolean; seriesRead: boolean; forecast: Forecast; hrSummaries: z.infer<typeof heartRateRangeSchema>; hrToday: ReturnType<typeof hrOf>;
  notesAvailable: boolean; userNote: z.infer<typeof userNoteSchema> | null; onDirty: (dirty: boolean) => void; onZoom: (zoom: Zoom) => void; onDrawer: (state: DrawerState) => void; onHourInfo: (key: HourKey) => void; onHrInfo: () => void }) {
  const { date, rows, snapshot, hours, forecast, hrToday } = props;
  const byDate = new Map(props.hrSummaries.map((item) => [item.date, item]));
  const prev = Array.from({ length: 7 }, (_, i) => hrOf(byDate.get(addDays(date, i - 7)))).filter((item) => item !== null);
  const avg7 = prev.length ? prev.reduce((sum, item) => sum + item.avg, 0) / prev.length : null;
  const hrSpark = Array.from({ length: 14 }, (_, i) => { const at = addDays(date, i - 13), item = hrOf(byDate.get(at)); return { avg: item?.avg ?? null, min: item?.min ?? null, max: item?.max ?? null, tip: [fmtDL(at), item ? `śr. ${nf(item.avg)} bpm` : '—', item ? `${nf(item.min)}–${nf(item.max)} bpm` : ''] }; });
  const card = (key: MetricKey) => <KpiCard key={key} date={date} rows={rows} snapshot={snapshot} metricKey={key} forecast={forecast} onZoom={() => props.onZoom({ type: 'day', key, len: 30 })} onInfo={() => props.onDrawer({ type: 'cell', date, key })} />;
  const noHours = !props.seriesRead || props.legacy;
  const hasHr = props.hours.hr.length > 0;
  return <>
    <div className="kpis">
      {(['energy', 'activity', 'body'] as const).map((group) => <section key={group} className="kgroup" style={{ '--gc': groups[group].color } as React.CSSProperties}><h3>{groups[group].label}</h3>
        {metrics.filter((metric) => metric.group === group).map((metric) => card(metric.key))}
        {group === 'body' && <div className="kcard" data-zoom onClick={() => props.onZoom({ type: 'hrdays', len: 30 })}>
          <span className="k-label"><span>Tętno</span><span className="k-right">{date === warsawToday() && hrToday && <span className="chip prov">w toku</span>}<InfoButton label="Tętno" onClick={props.onHrInfo} /></span></span>
          <span className={`k-value ${hrToday ? '' : 'none'}`}>{hrToday ? nf(hrToday.avg) : '—'}{hrToday && <><small>bpm</small><span className="k-fc" style={{ color: 'var(--c-band)' }}>{nf(hrToday.min)}–{nf(hrToday.max)} bpm</span></>}</span>
          <span className="k-cmp">{hrToday ? avg7 !== null ? `śr. 7 dni ${nf(avg7)} · ${prev.length} z 7 dób` : 'brak pomiarów w 7 dniach' : 'Brak pomiarów tętna tej doby'}</span>
          <button type="button" className="chartbtn" aria-label="Powiększ wykres: Tętno" onClick={(event) => { event.stopPropagation(); props.onZoom({ type: 'hrdays', len: 30 }); }}><HrSpark points={hrSpark} /></button></div>}
      </section>)}
      <section className="kgroup" style={{ '--gc': 'var(--c-food)' } as React.CSSProperties}><h3>Jedzenie <span className="tag food">M3</span></h3>
        <div className="kcard placeholder"><strong>Spożyte kalorie i makro</strong><p>Pojawi się z dziennikiem posiłków.</p></div>
        <div className="kcard placeholder"><strong>Bilans energii</strong><p>Tylko dla dni z porównywalnym wydatkiem; doba z samym BMR nie pokaże deficytu.</p></div></section>
    </div>
    <div className="cols2">
      <section className="panel"><header><h3>Doba w skrócie</h3><div className="hdr-r"><div className="legend">{!noHours && <EnergyLegend forecast={!!forecast} />}{hasHr && <span><i style={{ background: 'var(--c-band)' }} />tętno</span>}</div><InfoButton label="Doba w skrócie" onClick={() => props.onHourInfo('total')} /></div></header>
        {noHours ? <p className="sub">{!props.seriesRead ? 'Brak zapisanego odczytu okien 10-minutowych dla tej doby.' : 'Starszy model źródła: producent zapisał kalorie w kilku długich przedziałach, więc brak rozkładu godzinowego.'}</p>
          : <Zoomable label="doba w skrócie" onZoom={() => props.onZoom({ type: 'hour', key: 'total', name: 'Doba w skrócie' })}><HourChart hours={hours.hours} metric="total" height={120} /></Zoomable>}
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
function DayHourly({ date, hours, snapshot, legacy, seriesRead, loading, forecast, hrToday, onZoom, onInfo, onHrInfo }: { date: string; hours: DayHours; snapshot: Snapshot | null; legacy: boolean; seriesRead: boolean; loading: boolean; forecast: Forecast; hrToday: ReturnType<typeof hrOf>; onZoom: (zoom: Zoom) => void; onInfo: (key: HourKey) => void; onHrInfo: () => void }) {
  const [key, setKey] = useState<HourKey>('active');
  const none = !seriesRead || (legacy && (key === 'total' || key === 'active')) || hours.hours.every((hour) => hour[key] === null);
  const total = dayTotal(snapshot, key, hours.hours);
  return <>
    <section className="panel"><header><h3 className="num">{hourMetricLabel(key)}{total && <>: {total.text} {total.computed && <span className="sub">(suma godzin, brak wartości producenta)</span>}</>}{key === 'total' && forecast && <span className="k-fc">Prognoza: <b>{nf(forecast.forecastKcal)}</b> kcal</span>}</h3>
      <div className="hdr-r"><Segmented label="Metryka" items={hourOptions} value={key} onChange={setKey} /><InfoButton label="Przebieg doby" onClick={() => onInfo(key)} /></div></header>
      {key === 'total' && !none && <div className="legend" style={{ marginBottom: 6 }}><EnergyLegend forecast={!!forecast} /></div>}
      {loading ? <p>Ładowanie…</p> : none ? <div className="empty" style={{ padding: 22 }}><h3>Brak rozkładu godzinowego</h3><p>{!seriesRead ? 'Brak zapisanego odczytu okien 10-minutowych dla tej doby.' : legacy && (key === 'total' || key === 'active') ? 'W starszym modelu producent zapisywał kalorie w kilku długich przedziałach na dobę. Wartość dobowa jest w tabeli, ale nie da się jej uczciwie rozłożyć na godziny.' : 'Zapisany odczyt okien tej metryki nie ma wartości dla tej doby.'}</p></div>
        : <Zoomable label="przebieg doby" onZoom={() => onZoom({ type: 'hour', key, name: 'Przebieg doby' })}><HourChart hours={hours.hours} metric={key} height={190} /></Zoomable>}
      <details className="diag" style={{ marginTop: 12 }}><summary>Tabela danych godzinowych</summary><div className="tw"><table className="simple"><thead><tr><th>Godzina</th><th>Spalone kcal</th><th>Aktywne kcal</th><th>Kroki</th><th>Dystans km</th><th>Okna z tętnem</th>{forecast && <th>Prognoza kcal</th>}</tr></thead>
        <tbody>{hours.hours.map((hour) => <tr key={hour.start}><td className="mono">{hour.range}</td><td>{hour.total === null ? '—' : nf(hour.total)}</td><td>{hour.active === null ? '—' : nf(hour.active)}</td><td>{hour.steps === null ? '—' : nf(hour.steps)}</td><td>{hour.distance === null ? '—' : nf(hour.distance, 2)}</td><td>{hour.future || hour.hrWindows === null ? '—' : `${hour.hrWindows} z 6`}</td>{forecast && <td>{hour.fc === null ? '—' : nf(hour.fc)}</td>}</tr>)}</tbody></table></div></details>
    </section>
    <section className="panel"><header><h3 className="num">Tętno{hrToday ? `: śr. ${nf(hrToday.avg)} · ${nf(hrToday.min)}–${nf(hrToday.max)} bpm` : ''} <span className="sub">okna 10-min</span></h3><div className="hdr-r"><span className="sub num">{hrToday ? `${hrToday.n} z ${hours.slots} okien z pomiarem` : ''}</span><InfoButton label="Tętno" onClick={onHrInfo} /></div></header>
      {hours.hr.length ? <><div className="legend" style={{ marginBottom: 6 }}>{HR_LEGEND}</div><Zoomable label="tętno" onZoom={() => onZoom({ type: 'hrday' })}><HrDayChart windows={hours.hr} slots={hours.slots} hours={hours.hours} height={170} /></Zoomable></>
        : <p className="sub" style={{ margin: 0 }}>{date < firstDay ? 'Doba sprzed zakresu odczytów.' : 'Brak pomiarów tętna tej doby albo brak odczytu okien tętna.'}</p>}</section>
  </>;
}

function DayProvenance({ date, snapshot, slots }: { date: string; snapshot: Snapshot | null; slots: number }) {
  const read = date >= firstDay;
  const sources = useJson(read ? `/api/google/day-sources?from=${date}&to=${date}` : null, daySourcesSchema);
  const band = useJson(read ? `/api/google/band-share?date=${date}` : null, bandShareSchema);
  const reads = useJson(read ? `/api/google/daily-candidates?kind=total-calories&date=${date}` : null, dailyReviewSchema);
  const day = sources.data?.[0];
  const names = new Map<string, { name: string; steps: number | null; active: number | null }>();
  for (const [field, items] of [['steps', day?.steps], ['active', day?.activeEnergy]] as const) for (const item of items ?? []) {
    const name = sourceName(item.source), current = names.get(name) ?? { name, steps: null, active: null };
    current[field] = (current[field] ?? 0) + item.records; names.set(name, current);
  }
  const role = (name: string) => name.startsWith('Opaska') ? 'urządzenie; producent wybiera je dla kroków, gdy mierzyło' : name.startsWith('Health Connect') || name.includes('(Health Connect)') ? 'kopia przez Health Connect, uzgadniana przez producenta' : 'źródło telefonu, uzgadniane przez producenta';
  return <div className="cols2">
    <section className="panel"><header><h3>Kto zapisał dane tego dnia</h3><span className="sub">liczba wpisów z najnowszego pełnego odczytu</span></header>
      {sources.error ? <p role="alert">Nie udało się odczytać źródeł.</p> : !read ? <p className="sub">Doba sprzed zakresu odczytów.</p> : !sources.data ? <p>Ładowanie…</p> : <div className="tw"><table className="simple"><thead><tr><th>Źródło</th><th>Kroki</th><th>Kalorie aktywne</th><th>Rola</th></tr></thead><tbody>
        {day?.steps === null && day?.activeEnergy === null ? <tr><td colSpan={4}>Brak odczytu listy źródeł dla tej doby.</td></tr> : names.size === 0 ? <tr><td colSpan={4}>Odczyt nie zawiera wpisów.</td></tr>
          : [...names.values()].sort((a, b) => (b.steps ?? 0) + (b.active ?? 0) - (a.steps ?? 0) - (a.active ?? 0)).map((item) => <tr key={item.name}><td>{item.name}{item.name.startsWith('Opaska') && <> <span className="tag">urządzenie</span></>}</td><td className="num">{day?.steps === null ? 'nie odczytano' : item.steps ?? '—'}</td><td className="num">{day?.activeEnergy === null ? 'nie odczytano' : item.active ?? '—'}</td><td>{role(item.name)}</td></tr>)}
      </tbody></table></div>}
      <p className="sub" style={{ margin: '10px 0 0' }}>Ten sam ruch bywa zapisany przez kilka źródeł. Wartość dnia to uzgodnienie producenta, nigdy suma kopii.</p>
      {band.data?.heartRate && <p className="sub" style={{ margin: '10px 0 0' }}>Tętno z urządzenia w {band.data.heartRate.windows} z {band.data.totalWindows} okien ({nf(band.data.heartRate.windows / band.data.totalWindows * 100)} % doby). To dowód pomiaru, nie noszenia przez całe okno.</p>}
    </section>
    <section className="panel"><header><h3>Reguły i rewizja</h3></header><dl className="kv">
      <dt>Energia</dt><dd className="mono">{ruleOf(snapshot, 'energy')}{snapshot?.energy ? ` · ${({ current: 'pełny model', legacy: 'starszy model', basal_only: 'sama energia bazowa', unknown: 'model nieustalony' })[snapshot.energy.model]}` : ''}</dd>
      <dt>Aktywność</dt><dd className="mono">{ruleOf(snapshot, 'activity')}</dd><dt>Ciało</dt><dd className="mono">{ruleOf(snapshot, 'body')}</dd>
      <dt>Rewizja wyniku</dt><dd className="mono">{snapshot ? `r-${snapshot.revision}` : 'brak wyniku'}</dd><dt>Doba</dt><dd>{slots} okien 10-min · {date} 00:00 – następny dzień 00:00</dd></dl>
      <header style={{ marginTop: 16 }}><h3>Historia odczytów doby</h3><span className="sub">kalorie total, suma dobowa</span></header>
      {reads.error ? <p role="alert">Nie udało się odczytać historii.</p> : !read ? <p className="sub">—</p> : !reads.data ? <p>Ładowanie…</p> : reads.data.rows.length === 0 ? <ul className="timeline"><li><span>—</span><span>Brak odczytu. Uzupełnianie historii nadrobi tę dobę.</span></li></ul>
        : <ul className="timeline">{reads.data.rows.map((row, index) => <li key={index}><span>{whenOf(row.receivedAt)}</span><span>{row.converted ? `${nf(Number(row.converted.value))} ${row.converted.unit}` : row.originalValue}{index === 0 ? ' · najnowszy, użyty' : ' · wcześniejszy, zachowany'}</span></li>)}</ul>}
    </section>
  </div>;
}

function DayZoom({ zoom, setZoom, date, onDate, rows, snapshot, hours, legacy, seriesRead, loading, forecast, hrSummaries, hrToday, onInfo }: { zoom: Zoom; setZoom: (zoom: Zoom | null) => void; date: string; onDate?: (date: string) => void; rows: DayRow[]; snapshot: Snapshot | null; hours: DayHours; legacy: boolean; seriesRead: boolean; loading: boolean; forecast: Forecast; hrSummaries: z.infer<typeof heartRateRangeSchema>; hrToday: ReturnType<typeof hrOf>; onInfo: () => void }) {
  const { W, H } = zoomSize(), close = () => setZoom(null);
  const dates = onDate ? <DateControl date={date} onDate={onDate} /> : null;
  if (zoom.type === 'hour') {
    const none = !seriesRead || (legacy && (zoom.key === 'total' || zoom.key === 'active')) || hours.hours.every((hour) => hour[zoom.key] === null);
    const total = dayTotal(snapshot, zoom.key, hours.hours);
    const title = `${zoom.name} · ${hourMetricLabel(zoom.key)}${total ? `: ${total.text}${total.computed ? ' (suma godzin)' : ''}` : ''}${zoom.key === 'total' && forecast ? ` · prognoza ${nf(forecast.forecastKcal)} kcal` : ''}`;
    return <ZoomDialog title={title} sub={fmtDL(date)} onClose={close} onInfo={onInfo}
      controls={<>{dates}<Segmented label="Metryka" items={hourOptions} value={zoom.key} onChange={(key) => setZoom({ ...zoom, key })} /></>}
      legend={none ? null : <>{zoom.key === 'total' && <EnergyLegend forecast={!!forecast} />}{hours.hr.length > 0 && <span><i style={{ background: 'var(--c-band)' }} />tętno, prawa oś (bpm)</span>}</>}>
      {loading ? <p className="sub">Ładowanie…</p> : none ? <p className="sub">Brak rozkładu godzinowego dla tej doby.</p> : <HourChart hours={hours.hours} metric={zoom.key} height={H} width={W} hr={hours.hr} />}</ZoomDialog>;
  }
  if (zoom.type === 'hrday') return <ZoomDialog title={`Tętno${hrToday ? `: śr. ${nf(hrToday.avg)} · ${nf(hrToday.min)}–${nf(hrToday.max)} bpm` : ''}`} sub={fmtDL(date)} controls={dates} legend={HR_LEGEND} onClose={close} onInfo={onInfo}>
    {loading ? <p className="sub">Ładowanie…</p> : <HrDayChart windows={hours.hr} slots={hours.slots} hours={hours.hours} height={H} width={W} />}</ZoomDialog>;
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
