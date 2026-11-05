import { useState } from 'react';
import type { z } from 'zod';
import { forecastSchema, groups, heartRateRangeSchema, metricOf, metrics, rangeSchema, useChunkedJson, useJson, earliestOf, type Earliest, type Loaded, type MetricKey } from './api.ts';
import { HR_LEGEND, HrTrendChart, InfoButton, TrendChart, Zoomable } from './charts.tsx';
import { axisEvents, heartTrend, lastMeasured, meanValid, metricTrend, valueOf } from './derive.ts';
import type { DrawerState } from './details.tsx';
import { addDays, fmtD, fmtRange, maxDate, nf, warsawToday , firstDay } from './format.ts';
import { TableRange, tableBounds, type RangePrefs } from './table.tsx';
import { Segmented, ZoomDialog, zoomSize } from './zoom.tsx';
import { Loading } from './logo.tsx';

export const aggregations: ['day' | 'week', string][] = [['day', 'Dni'], ['week', 'Tygodnie']];
/** Trends of the six M1 metrics and heart rate, from the same day snapshots as the table, with events on the axis. */
export function TrendsView({ earliest, prefs, agg, onPrefs, onAgg, onDrawer }: { earliest: Loaded<Earliest>; prefs: RangePrefs; agg: 'day' | 'week'; onPrefs: (next: Partial<RangePrefs>) => void; onAgg: (agg: 'day' | 'week') => void; onDrawer: (state: DrawerState) => void }) {
  const [zoom, setZoom] = useState<MetricKey | 'hr' | null>(null);
  // "Od początku": on the dashboard the first day of any chart, in a chart's zoom the first day of that chart only
  const first = earliestOf(earliest, zoom ? [zoom] : [...metrics.map((metric) => metric.key), 'hr']);
  const today = warsawToday(), { from, to } = tableBounds(prefs, first), history = from < addDays(to, -365) ? from : addDays(to, -365);
  // one request covers every period, so events like the first day of the full calorie model are found in the whole history, not the slice
  const result = useChunkedJson('/api/day-range', history, to, rangeSchema, (parts): z.infer<typeof rangeSchema> => parts.every((part) => part.state === 'ready') ? { state: 'ready', days: parts.flatMap((part) => part.state === 'ready' ? part.days : []) } : { state: 'not_ready' });
  const hr = useChunkedJson(to >= firstDay ? '/api/google/heart-rate-range' : null, maxDate(firstDay, history), to, heartRateRangeSchema, (parts) => parts.flat());
  const forecast = useJson(`/api/google/energy-forecast?date=${today}`, forecastSchema);
  if (result.error) return <p role="alert">Nie udało się odczytać trendów.</p>;
  if (!result.data) return <Loading />;
  if (result.data.state === 'not_ready') return <p>Wyniki dzienne nie są jeszcze przygotowane.</p>;
  const all = result.data.days, rows = all.filter((row) => row.date >= from && row.date <= to);
  const fc = forecast.data && agg === 'day' && to === today ? { now: valueOf(rows.at(-1)?.snapshot, 'total_energy') ?? 0, total: forecast.data.forecastKcal } : null;
  const events = (key: MetricKey | 'hr') => axisEvents(all, key, true).filter((event) => event.at ? event.at >= from : event.to! >= from);
  const hrPoints = (aggregation: 'day' | 'week') => heartTrend(hr.data ?? [], from, to, aggregation);
  const hrDays = hrPoints('day').filter((point) => point.avg !== null);
  const hrMean = hrDays.length ? hrDays.reduce((sum, point) => sum + point.avg!, 0) / hrDays.length : null;
  const sub = `${fmtRange(from, to)} · ${agg === 'week' ? 'średnie tygodniowe' : 'wartości dzienne'}`;
  const info = (key: MetricKey) => { const a = meanValid(rows, key, from, to); onDrawer({ type: 'trend', key, from, to, agg, mean: a.mean, n: a.n, total: a.total, events: events(key) }); };
  const chart = (key: MetricKey, size?: { W: number; H: number }) => { const metric = metricOf(key);
    return <TrendChart points={metricTrend(rows, key, agg, key === 'total_energy' && to === today ? forecast.data ?? null : undefined)} form={metric.form} color={groups[metric.group].color} decimals={metric.decimals} label={metric.label} events={events(key)} agg={agg} forecast={key === 'total_energy' ? fc : null} width={size?.W} height={size?.H} />; };
  const { W, H } = zoomSize();
  return <>
    <div className="events"><span className="event"><i className="ev-legacy" />starszy model kalorii</span><span className="event"><i className="ev-hatch" />okres nieporównywalny</span>{fc && <span className="event"><i className="ev-fc" />prognoza do 24:00</span>}{agg === 'week' && <span className="event">Słupek bledszy = mniej dób z wartością w tygodniu</span>}</div>
    <div className="tgrid">
      {metrics.map((metric) => { const a = meanValid(rows, metric.key, from, to), body = metric.group === 'body', last = body ? lastMeasured(rows, metric.key, to) : null;
        return <section key={metric.key} className="panel tcard"><header><h3 className="th"><i style={{ background: groups[metric.group].color }} />{metric.label}{metric.unit && <span className="sub"> {metric.unit}</span>}</h3>
          <span className="stat">{body && last ? <>ostatni <b>{nf(last.value, metric.decimals)}</b> · {fmtD(last.date)} · </> : null}śr. {body ? '' : 'dzienna '}<b>{a.mean === null ? '—' : nf(a.mean, metric.decimals)}</b> · {a.n} z {a.total} dób</span><InfoButton label={metric.label} onClick={() => info(metric.key)} /></header>
          <Zoomable label={metric.label} onZoom={() => setZoom(metric.key)}>{chart(metric.key)}</Zoomable></section>; })}
      <section className="panel tcard"><header><h3 className="th"><i style={{ background: 'var(--c-band)' }} />Tętno<span className="sub"> bpm</span></h3>
        <span className="stat">śr. okien <b>{hrMean === null ? '—' : nf(hrMean)}</b> · {hrDays.length} z {hrPoints('day').length} dób z pomiarem</span><InfoButton label="Tętno" onClick={() => onDrawer({ type: 'hr', from, to })} /></header>
        {hr.error ? <p role="alert">Nie udało się odczytać tętna.</p> : <Zoomable label="tętno" onZoom={() => setZoom('hr')}><HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} /></Zoomable>}</section>
      <section className="panel tcard future"><header><h3>Tętno spoczynkowe</h3><span className="tag">M2</span></header><p className="sub" style={{ margin: 0 }}>Osobny typ z Google Health API. Nie jest minimum ani średnią tętna dnia, więc nie wyliczamy go z okien.</p></section>
    </div>
    <section className="panel"><header><h3>Porównania i korelacje</h3><span className="tag">M2+</span></header><p className="sub" style={{ margin: 0 }}>Obciążenie tygodnia, sen a aktywność, spożycie a wydatek. Opis korelacji osobno od wniosków przyczynowych.</p></section>
    {zoom && <ZoomDialog title={zoom === 'hr' ? 'Tętno' : metricOf(zoom).label} sub={sub} legend={zoom === 'hr' ? HR_LEGEND : null} onClose={() => setZoom(null)} onInfo={() => zoom === 'hr' ? onDrawer({ type: 'hr', from, to }) : info(zoom)}
      controls={<><TableRange prefs={prefs} earliest={first} onChange={onPrefs} /><Segmented label="Agregacja" items={aggregations} value={agg} onChange={onAgg} /></>}>
      {zoom === 'hr' ? <HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} width={W} height={H} /> : chart(zoom, { W, H })}</ZoomDialog>}
  </>;
}
