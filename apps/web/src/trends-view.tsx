import { useState } from 'react';
import { forecastSchema, groups, heartRateRangeSchema, metricOf, metrics, rangeSchema, useJson, type MetricKey } from './api.ts';
import { HR_LEGEND, HrTrendChart, InfoButton, TrendChart, Zoomable } from './charts.tsx';
import { axisEvents, heartTrend, lastMeasured, meanValid, metricTrend, valueOf } from './derive.ts';
import type { DrawerState } from './details.tsx';
import { addDays, fmtD, fmtRange, maxDate, nf, warsawToday , firstDay } from './format.ts';
import { Segmented, ZoomDialog, zoomSize } from './zoom.tsx';
import { Loading } from './logo.tsx';

export type TrendLength = 30 | 90 | 365 | 0;
export const trendRanges: [TrendLength, string][] = [[30, '30 dni'], [90, '90 dni'], [365, 'Rok'], [0, 'Od 1 sty']];
export const aggregations: ['day' | 'week', string][] = [['day', 'Dni'], ['week', 'Tygodnie']];
/** First day of a trend period: N days back, or 1 January of the current year. */
export const trendFrom = (length: TrendLength, today: string) => length === 0 ? `${today.slice(0, 4)}-01-01` : addDays(today, -(length - 1));

/** Trends of the six M1 metrics and heart rate, from the same day snapshots as the table, with events on the axis. */
export function TrendsView({ length, agg, onLength, onAgg, onDrawer }: { length: TrendLength; agg: 'day' | 'week'; onLength: (length: TrendLength) => void; onAgg: (agg: 'day' | 'week') => void; onDrawer: (state: DrawerState) => void }) {
  const today = warsawToday(), history = addDays(today, -365), from = trendFrom(length, today);
  const [zoom, setZoom] = useState<MetricKey | 'hr' | null>(null);
  // one request covers every period, so events like "first weighing" are found in the whole history, not the slice
  const result = useJson(`/api/day-range?from=${history}&to=${today}`, rangeSchema);
  const hr = useJson(today >= firstDay ? `/api/google/heart-rate-range?from=${maxDate(firstDay, history)}&to=${today}` : null, heartRateRangeSchema);
  const forecast = useJson(`/api/google/energy-forecast?date=${today}`, forecastSchema);
  if (result.error) return <p role="alert">Nie udało się odczytać trendów.</p>;
  if (!result.data) return <Loading />;
  if (result.data.state === 'not_ready') return <p>Wyniki dzienne nie są jeszcze przygotowane.</p>;
  const all = result.data.days, rows = all.filter((row) => row.date >= from);
  const fc = forecast.data && agg === 'day' ? { now: valueOf(rows.at(-1)?.snapshot, 'total_energy') ?? 0, total: forecast.data.forecastKcal } : null;
  const events = (key: MetricKey | 'hr') => axisEvents(all, key, true).filter((event) => event.at ? event.at >= from : event.to! >= from);
  const hrPoints = (aggregation: 'day' | 'week') => heartTrend(hr.data ?? [], from, today, aggregation);
  const hrDays = hrPoints('day').filter((point) => point.avg !== null);
  const hrMean = hrDays.length ? hrDays.reduce((sum, point) => sum + point.avg!, 0) / hrDays.length : null;
  const sub = `${fmtRange(from, today)} · ${agg === 'week' ? 'średnie tygodniowe' : 'wartości dzienne'}`;
  const info = (key: MetricKey) => { const a = meanValid(rows, key, from, today); onDrawer({ type: 'trend', key, from, to: today, agg, mean: a.mean, n: a.n, total: a.total, events: events(key) }); };
  const chart = (key: MetricKey, size?: { W: number; H: number }) => { const metric = metricOf(key);
    return <TrendChart points={metricTrend(rows, key, agg, key === 'total_energy' ? forecast.data ?? null : undefined)} form={metric.form} color={groups[metric.group].color} decimals={metric.decimals} label={metric.label} events={events(key)} agg={agg} forecast={key === 'total_energy' ? fc : null} width={size?.W} height={size?.H} />; };
  const { W, H } = zoomSize();
  return <>
    <div className="events"><span className="event"><i className="ev-legacy" />starszy model kalorii</span><span className="event"><i className="ev-hatch" />okres nieporównywalny</span>{fc && <span className="event"><i className="ev-fc" />prognoza do 24:00</span>}{agg === 'week' && <span className="event">Słupek bledszy = mniej dób z wartością w tygodniu</span>}</div>
    <div className="tgrid">
      {metrics.map((metric) => { const a = meanValid(rows, metric.key, from, today), body = metric.group === 'body', last = body ? lastMeasured(rows, metric.key, today) : null;
        return <section key={metric.key} className="panel tcard"><header><h3 className="th"><i style={{ background: groups[metric.group].color }} />{metric.label}{metric.unit && <span className="sub"> {metric.unit}</span>}</h3>
          <span className="stat">{body && last ? <>ostatni <b>{nf(last.value, metric.decimals)}</b> · {fmtD(last.date)} · </> : null}śr. {body ? '' : 'dzienna '}<b>{a.mean === null ? '—' : nf(a.mean, metric.decimals)}</b> · {a.n} z {a.total} dób</span><InfoButton label={metric.label} onClick={() => info(metric.key)} /></header>
          <Zoomable label={metric.label} onZoom={() => setZoom(metric.key)}>{chart(metric.key)}</Zoomable></section>; })}
      <section className="panel tcard"><header><h3 className="th"><i style={{ background: 'var(--c-band)' }} />Tętno<span className="sub"> bpm</span></h3>
        <span className="stat">śr. okien <b>{hrMean === null ? '—' : nf(hrMean)}</b> · {hrDays.length} z {hrPoints('day').length} dób z pomiarem</span><InfoButton label="Tętno" onClick={() => onDrawer({ type: 'hr', from, to: today })} /></header>
        {hr.error ? <p role="alert">Nie udało się odczytać tętna.</p> : <Zoomable label="tętno" onZoom={() => setZoom('hr')}><HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} /></Zoomable>}</section>
      <section className="panel tcard future"><header><h3>Tętno spoczynkowe</h3><span className="tag">M2</span></header><p className="sub" style={{ margin: 0 }}>Osobny typ z Google Health API. Nie jest minimum ani średnią tętna dnia, więc nie wyliczamy go z okien.</p></section>
    </div>
    <section className="panel"><header><h3>Porównania i korelacje</h3><span className="tag">M2+</span></header><p className="sub" style={{ margin: 0 }}>Obciążenie tygodnia, sen a aktywność, spożycie a wydatek. Opis korelacji osobno od wniosków przyczynowych.</p></section>
    {zoom && <ZoomDialog title={zoom === 'hr' ? 'Tętno' : metricOf(zoom).label} sub={sub} legend={zoom === 'hr' ? HR_LEGEND : null} onClose={() => setZoom(null)} onInfo={() => zoom === 'hr' ? onDrawer({ type: 'hr', from, to: today }) : info(zoom)}
      controls={<><Segmented label="Okres" items={trendRanges} value={length} onChange={onLength} /><Segmented label="Agregacja" items={aggregations} value={agg} onChange={onAgg} /></>}>
      {zoom === 'hr' ? <HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} width={W} height={H} /> : chart(zoom, { W, H })}</ZoomDialog>}
  </>;
}
