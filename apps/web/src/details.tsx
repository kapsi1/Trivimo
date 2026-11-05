import { useEffect, useRef, type ReactNode } from 'react';
import { bodyReviewSchema } from '../../../packages/contracts/source-records.ts';
import { bandShareSchema, dailyReviewSchema, dayResponseSchema, energyModels, energySource, forecastSchema, metricOf, quality, reasonsOf, ruleOf, useJson, type Forecast, type MetricKey, type MetricValue } from './api.ts';
import type { AxisEvent, HourKey } from './charts.tsx';
import { fmtD, fmtDL, fmtRange, formatRational, nf, plural, warsawToday, whenOf , firstDay } from './format.ts';
import { Loading } from './logo.tsx';

export type DrawerState =
  | { type: 'cell'; date: string; key: MetricKey }
  | { type: 'hourly'; date: string; key: HourKey; windows: number; legacy: boolean; read: boolean; forecast: Forecast }
  | { type: 'trend'; key: MetricKey; from: string; to: string; agg: 'day' | 'week'; mean: number | null; n: number; total: number; events: AxisEvent[] }
  | { type: 'hr'; date?: string; from?: string; to?: string; summary?: { avg: number; min: number; max: number; n: number } | null; dayWindows?: number };

const CloseIcon = () => <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>;
/** Modal dialog shell shared by the details panel and the zoom: focus moves in, Esc closes, focus returns. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const element = ref.current; element?.addEventListener('keydown', key);
    return () => { element?.removeEventListener('keydown', key); previous?.focus?.(); };
  }, []);
  return ref;
}

export function StatusChip({ value, compact = false }: { value: MetricValue | undefined; compact?: boolean }) {
  if (!value || value.status === 'valid') return null;
  if (value.status === 'provisional') return <span className="chip prov">{compact ? 'w toku' : 'w toku · częściowy'}</span>;
  if (value.status === 'incomparable') return <span className="chip inc">{compact ? 'nieporówn.' : 'nieporównywalne'}</span>;
  if (value.status === 'conflict') return <span className="chip conf">konflikt</span>;
  if (value.status === 'missing') return compact ? null : <span className="chip miss">brak danych</span>;
  return <span className="chip bad">{quality[value.status]}</span>;
}

const dailyKind: Partial<Record<MetricKey, string>> = { steps: 'steps', distance: 'distance', total_energy: 'total-calories', active_energy: 'active-energy-burned' };
export function forecastText(forecast: NonNullable<Forecast>): string {
  const hoursLeft = forecast.remainingWindows / 6;
  return `≈ ${nf(forecast.forecastKcal)} kcal o 24:00: ${nf(forecast.burnedKcal)} do ${whenOf(forecast.asOf).replace('dziś ', '')} + ${nf(forecast.forecastKcal - forecast.burnedKcal)} w pozostałych ${nf(hoursLeft, 1)} h (≈ ${nf(forecast.restRateKcalPerHour)} kcal/h).`;
}
function ForecastSection({ forecast, intro }: { forecast: NonNullable<Forecast>; intro: string }) {
  return <div className="dsec"><h4>Prognoza do końca doby</h4><p className="num">{intro}</p>
    <p style={{ marginTop: 6 }}>Zakłada brak dalszej aktywności, więc rzeczywista wartość będzie zwykle wyższa. Własna pochodna <span className="mono">{forecast.rule}</span>: stawka ze średniej {forecast.restWindows} dzisiejszych okien 10-minutowych bez kroków i bez aktywnych kcal. Nie jest wartością producenta ani BMR i nie trafia do tabeli, średnich ani eksportu.</p></div>;
}

function CellBody({ date, metricKey, onOpenDay }: { date: string; metricKey: MetricKey; onOpenDay: (date: string, tab?: 'podsumowanie' | 'pochodzenie') => void }) {
  const metric = metricOf(metricKey), group = metric.group;
  const day = useJson(`/api/day?date=${date}`, dayResponseSchema);
  const today = date === warsawToday();
  const forecast = useJson(metricKey === 'total_energy' && today ? `/api/google/energy-forecast?date=${date}` : null, forecastSchema);
  const band = useJson(group === 'energy' && date >= firstDay ? `/api/google/band-share?date=${date}` : null, bandShareSchema);
  const kind = dailyKind[metricKey];
  const reads = useJson(kind && date >= firstDay ? `/api/google/daily-candidates?kind=${kind}&date=${date}` : null, dailyReviewSchema);
  const bodyKind = metricKey === 'weight' || metricKey === 'body_fat' ? metricKey : null;
  const googleBody = useJson(bodyKind && date >= firstDay ? `/api/google/body-candidates?kind=${bodyKind}&date=${date}` : null, bodyReviewSchema);
  const takeoutBody = useJson(bodyKind ? `/api/body-candidates?kind=${bodyKind}&date=${date}` : null, bodyReviewSchema);
  if (day.error) return <p role="alert">Nie udało się odczytać wyniku dnia.</p>;
  if (!day.data) return <Loading />;
  if (day.data.state === 'not_ready') return <p>Wyniki dzienne nie są jeszcze przygotowane.</p>;
  const snapshot = day.data.snapshot, value = snapshot?.metrics[metricKey], reasons = reasonsOf(snapshot, metricKey);
  const chip = value ? ({ valid: 'prov', provisional: 'prov', incomparable: 'inc', conflict: 'conf', missing: 'miss' } as Record<string, string>)[value.status] ?? 'bad' : 'miss';
  let specific: ReactNode = null;
  if (group === 'energy' && snapshot?.energy) {
    const energy = snapshot.energy, split = band.data?.activeEnergy;
    const bandKcal = split ? Number(split.bandKcal) : null, otherKcal = split ? Number(split.otherKcal) : null, sum = (bandKcal ?? 0) + (otherKcal ?? 0);
    specific = <><div className="dsec"><h4>Model producenta</h4><p>{energyModels[energy.model]}</p></div>
      <div className="dsec"><h4>Źródło szacunku</h4><p>{energySource(energy.heartRateWindows, energy.dayWindows)}{energy.heartRateWindows !== null ? ` · tętno w ${energy.heartRateWindows} z ${energy.dayWindows} okien (${nf(energy.heartRateWindows / energy.dayWindows * 100)} % doby)` : ''}</p>
        {bandKcal !== null && otherKcal !== null && sum > 0 && <><div className="split"><b style={{ width: `${bandKcal / sum * 100}%`, background: 'var(--c-band)' }} /><b style={{ width: `${otherKcal / sum * 100}%`, background: 'var(--c-energy)', opacity: 0.6 }} /></div>
          <p className="num">Aktywne kcal: {nf(bandKcal)} w oknach z tętnem · {nf(otherKcal)} bez tętna. Opaska liczy wysiłek z tętna, telefon z kroków, więc obie części nie są wprost porównywalne.</p></>}</div></>;
  } else if (group === 'activity' && snapshot?.activity) {
    const match = metricKey === 'steps' ? snapshot.activity.stepsMatchWindows : snapshot.activity.distanceMatchWindows;
    specific = <div className="dsec"><h4>Uzgodnienie źródeł</h4><p>Producent uzgadnia kopie z różnych źródeł i bierze opaskę albo jedno źródło telefonu, bez sumowania. Suma okien 10-minutowych doby: {match === null ? (value?.value == null ? 'brak wartości dobowej do porównania.' : 'nie odczytano okien.') : match ? 'zgodna z wartością dobową.' : 'niezgodna — inna granica doby producenta.'}</p></div>;
  } else if (group === 'body' && snapshot?.body) {
    const records = metricKey === 'weight' ? snapshot.body.weightRecords : snapshot.body.bodyFatRecords;
    const replicas = metricKey === 'weight' ? snapshot.body.weightReplicas : snapshot.body.bodyFatReplicas;
    specific = <div className="dsec"><h4>Pomiary dnia</h4><p>{records === null ? 'Doby nie odczytano.' : records === 0 ? 'Brak pomiaru tego dnia. Ostatni znany pomiar nie jest przenoszony na ten dzień.' : `${records} ${plural(records, 'wpis', 'wpisy', 'wpisów')} · średnia unikalnych${replicas ? ` · ${replicas} ${plural(replicas, 'kopia', 'kopie', 'kopii')} tego samego pomiaru z innej aplikacji liczona raz` : ''}`}</p>
      {googleBody.data && googleBody.data.rows.length > 0 && <div className="tw"><table className="simple"><thead><tr><th>Czas źródła</th><th>Wartość</th><th>Źródło</th></tr></thead><tbody>{googleBody.data.rows.map((row, index) => <tr key={index}><td className="mono">{row.timestamp}</td><td>{row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : '—'}</td><td>{row.origin || 'nieznane'}</td></tr>)}</tbody></table></div>}</div>;
  }
  const readsLoading = (kind && date >= firstDay && !reads.data && !reads.error) || (bodyKind && date >= firstDay && !googleBody.data && !googleBody.error);
  const readList = reads.data ? reads.data.rows.map((row, index) => <li key={index}><span>{whenOf(row.receivedAt)}</span><span>{row.converted ? `${nf(Number(row.converted.value), metric.decimals)} ${row.converted.unit}` : row.originalValue}{index === 0 ? ' · najnowszy' : ''}</span></li>)
    : googleBody.data?.jobs ? googleBody.data.jobs.map((job, index) => <li key={index}><span>{job.state === 'complete' ? 'zakończony' : 'w toku'}</span><span className="mono">{job.start} – {job.end}</span></li>) : [];
  return <>
    <div><div className={`bigval ${value?.value == null ? 'v-none' : ''}`}>{value?.value ? formatRational(value.value, metric.decimals) : '—'}{value?.value && metric.unit ? <small>{metric.unit}</small> : null}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className={`chip ${chip}`}>{value ? quality[value.status] : 'Brak obliczonego wyniku'}</span>{reasons.length > 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{reasons.join('; ')}</span>}{today && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Doba w toku: wartość rośnie po kolejnych odczytach.</span>}</div></div>
    {forecast.data && <ForecastSection forecast={forecast.data} intro={forecastText(forecast.data)} />}
    <div className="dsec"><h4>Skąd ta wartość</h4>{snapshot?.csv?.metrics.includes(metricKey)
      ? <p>Z importu CSV ({snapshot.csv.imports.length} {plural(snapshot.csv.imports.length, 'plik', 'pliki', 'plików')}), bo dane Google tej doby nie mają wartości tej metryki. {group === 'body' ? 'Średnia unikalnych pomiarów doby z pliku.' : 'Wartość dobowa z pliku według wybranego mapowania.'} Reguła <span className="mono">{snapshot.csv.rule}</span>; import można wykluczyć w „Źródła danych” → „Importy plików”.</p>
      : <p>{group === 'body' ? 'Średnia unikalnych pomiarów doby warszawskiej z Google Health API.' : 'Suma dobowa producenta z Google Health API, wszystkie źródła.'} Reguła <span className="mono">{ruleOf(snapshot, group)}</span>.</p>}</div>
    {specific}
    <div className="dsec"><h4>Odczyty</h4>{reads.error || googleBody.error ? <p>Nie udało się odczytać historii odczytów.</p> : readsLoading ? <Loading /> : readList.length ? <ul className="timeline">{readList}</ul> : <p>Brak zapisanego odczytu tej doby.</p>}
      {reads.data && reads.data.rows.length > 1 && <p style={{ marginTop: 6 }}>Każde pobranie zachowuje swój oryginał; odczyty nie są sumowane, najnowszy jest pierwszy.</p>}</div>
    <div className="dsec"><h4>Porównanie z Takeout</h4>{bodyKind ? (takeoutBody.error ? <p>Brak zaimportowanego Takeout albo nie udało się go odczytać.</p> : !takeoutBody.data ? <Loading /> : takeoutBody.data.rows.length === 0 ? <p>Takeout nie ma pomiarów tej doby (kompletność eksportu jest nieznana).</p>
      : <><p>Takeout jest punktem odniesienia i nie jest łączony z API.</p><div className="tw"><table className="simple"><thead><tr><th>Czas źródła</th><th>Wartość</th><th>Źródło</th></tr></thead><tbody>{takeoutBody.data.rows.map((row, index) => <tr key={index}><td className="mono">{row.timestamp}</td><td>{row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : '—'}</td><td>{row.origin || 'nieznane'}</td></tr>)}</tbody></table></div></>)
      : <p>Porównanie sum dobowych z Takeout nie jest jeszcze wyliczane. Oryginalne wiersze eksportu są w „Źródła danych” → „Importy plików”.</p>}</div>
    {snapshot && snapshot.notes.length > 0 && <div className="dsec"><h4>Uwagi dnia</h4><ul className="notes">{snapshot.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}
    <div className="dsec"><h4>Rewizja</h4><p className="mono">{snapshot ? `r-${snapshot.revision}` : 'brak'}</p></div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" className="btn" onClick={() => onOpenDay(date)}>Otwórz dzień</button><button type="button" className="btn ghost" onClick={() => onOpenDay(date, 'pochodzenie')}>Pochodzenie danych</button></div>
  </>;
}

const hourLabels: Record<HourKey, string> = { active: 'Aktywne kcal', total: 'Spalone kcal', steps: 'Kroki', distance: 'Dystans' };
export const hourMetricLabel = (key: HourKey) => hourLabels[key];

export function Drawer({ state, onClose, onOpenDay }: { state: DrawerState; onClose: () => void; onOpenDay: (date: string, tab?: 'podsumowanie' | 'pochodzenie') => void }) {
  const ref = useDialog(onClose);
  let title: string, sub: string, body: ReactNode;
  if (state.type === 'cell') { title = metricOf(state.key).label; sub = fmtDL(state.date); body = <CellBody date={state.date} metricKey={state.key} onOpenDay={onOpenDay} />; }
  else if (state.type === 'hourly') {
    title = `Przebieg doby · ${hourLabels[state.key]}`; sub = fmtDL(state.date);
    const none = !state.read || (state.legacy && (state.key === 'total' || state.key === 'active'));
    body = <>
      <div className="dsec"><h4>Skąd te dane</h4><p>Okna 10-minutowe z Google Health API (rollUp, czas UTC), zsumowane do godzin doby: {state.windows} okien{state.windows !== 144 ? ' (zmiana czasu)' : ''}. Godzina bez okien to brak odczytu, nie zero.</p></div>
      <div className="dsec"><h4>Zgodność z wartością dobową</h4><p>{none ? (!state.read ? 'Brak zapisanego odczytu okien tej doby.' : 'Starszy model źródła nie ma rozkładu godzinowego; dostępna jest tylko wartość dobowa.') : state.date === warsawToday() ? 'Doba w toku: suma godzin rośnie z kolejnymi odczytami.' : 'Sumy godzin pochodzą z okien doby warszawskiej; wartość dobowa producenta może różnić się granicą doby (zob. szczegóły komórki).'}</p></div>
      {state.key === 'total' && <div className="dsec"><h4>Podział słupka</h4><p>Jasna część to kalorie aktywne producenta, ciemniejsza to spalone poza aktywnymi w tej godzinie. To podział do prezentacji, nie pomiar BMR: producent nie udostępnia BMR dla tego konta.</p></div>}
      <div className="dsec"><h4>Linia tętna</h4><p>W powiększeniu na tym samym wykresie jest linia tętna (średnia okna 10-min) ze skalą po prawej. Przerwy to okna bez pomiaru. Udział opaski w kaloriach pokazuje tooltip i kolumna „Opaska” w tabeli.</p></div>
      {state.forecast && state.key === 'total' && <ForecastSection forecast={state.forecast} intro={`Przerywane słupki wypełniają resztę bieżącej godziny i przyszłe godziny stawką ≈ ${nf(state.forecast.restRateKcalPerHour)} kcal/h. Razem ≈ ${nf(state.forecast.forecastKcal)} kcal o 24:00.`} />}
    </>;
  } else if (state.type === 'trend') {
    const metric = metricOf(state.key);
    title = metric.label; sub = `${fmtRange(state.from, state.to)} · ${state.agg === 'week' ? 'średnie tygodniowe' : 'wartości dzienne'}`;
    body = <>
      <div className="dsec"><h4>Definicja</h4><p>{metric.definition[1]}</p><p className="mono" style={{ marginTop: 6 }}>{metric.definition[0]}</p></div>
      <div className="dsec"><h4>Skąd te dane</h4><p>{metric.group === 'body' ? 'Pomiary z Google Health API.' : 'Sumy dobowe producenta z Google Health API, wszystkie źródła.'} Reguła <span className="mono">{ruleOf(null, metric.group)}</span>. Te same wyniki dnia co w tabeli.</p></div>
      <div className="dsec"><h4>W tym okresie</h4><dl className="kv"><dt>Średnia{metric.group === 'body' ? '' : ' dzienna'}</dt><dd>{state.mean === null ? '—' : `${nf(state.mean, metric.decimals)} ${metric.unit}`}</dd><dt>Doby potwierdzone</dt><dd>{state.n} z {state.total}</dd><dt>Bez potwierdzonej wartości</dt><dd>{state.total - state.n}</dd></dl></div>
      <div className="dsec"><h4>Zdarzenia na osi</h4>{state.events.length ? <ul className="timeline">{state.events.map((event, index) => <li key={index}><span>{event.at ? fmtD(event.at) : `${fmtD(event.from!)}–${fmtD(event.to!)}`}</span><span>{event.label}</span></li>)}</ul> : <p>Brak w tym okresie.</p>}</div>
      <div className="dsec"><h4>Jak czytać</h4><p>Średnie liczą tylko doby potwierdzone. Linia łączy dni z pomiarem, a kropka oznacza dzień z pomiarem; pusta kolumna to brak, nie zero. Półprzezroczysty słupek: doba częściowa{state.agg === 'week' ? ' albo tydzień z brakami' : ''}. Kreskowanie: starszy model kalorii lub okres nieporównywalny.{state.key === 'total_energy' ? ' Przerywany obrys nad dzisiejszym słupkiem: prognoza do 24:00 bez aktywności.' : ''}</p></div>
      <div className="dsec"><h4>Jednostka</h4><p>{metric.unit || 'kroki'} · wyświetlane z dokładnością do {metric.decimals ? `${metric.decimals} ${metric.decimals === 1 ? 'miejsca' : 'miejsc'} po przecinku` : 'całości'}; przechowywane dokładnie.</p></div>
    </>;
  } else {
    title = 'Tętno'; sub = state.date ? fmtDL(state.date) : state.from && state.to ? fmtRange(state.from, state.to) : '';
    const s = state.summary;
    body = <>
      {state.date && <div className="dsec"><h4>Ten dzień</h4>{s ? <dl className="kv"><dt>Średnia okien</dt><dd>{nf(s.avg)} bpm</dd><dt>Minimum</dt><dd>{nf(s.min)} bpm</dd><dt>Maksimum</dt><dd>{nf(s.max)} bpm</dd><dt>Okna z pomiarem</dt><dd>{s.n}{state.dayWindows ? ` z ${state.dayWindows}` : ''}</dd></dl> : <p>Brak pomiarów tętna tej doby.</p>}</div>}
      <div className="dsec"><h4>Skąd te dane</h4><p>Okna 10-minutowe tętna z Google Health API (rollUp 600 s): średnia, minimum i maksimum w oknie, bez liczby próbek. Okna bez pomiaru producent pomija, więc na wykresie doby są przerwami.</p></div>
      <div className="dsec"><h4>Wartości dnia</h4><p>Minimum i maksimum ze wszystkich okien oraz średnia średnich okien, nieważona liczbą próbek. To własna agregacja do prezentacji, nie tętno spoczynkowe, które będzie osobnym typem z API.</p></div>
      <div className="dsec"><h4>Źródło pomiaru</h4><p>Głównie opaska. Obejmuje też pojedyncze pomiary aparatem telefonu, więc tętno dowodzi pomiaru, a nie noszenia opaski przez całe okno.</p></div>
      {!state.date && <div className="dsec"><h4>Jak czytać</h4><p>Pionowa kreska to zakres min–maks. dnia albo tygodnia, a linia z kropkami to średnia okien. Linia łączy dni z pomiarem.</p></div>}
    </>;
  }
  return <><div className="scrim" onClick={onClose} /><aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="dtitle">
    <header><div><h2 id="dtitle">{title}</h2><p>{sub}</p></div><button type="button" className="iconbtn" onClick={onClose} aria-label="Zamknij"><CloseIcon /></button></header>
    <div className="body">{body}</div></aside></>;
}
export { CloseIcon };
