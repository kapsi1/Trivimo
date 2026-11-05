import { useState } from 'react';
import type { z } from 'zod';
import { forecastSchema, groups, heartRateRangeSchema, metricOf, metrics, rangeSchema, useChunkedJson, useJson, earliestOf, type Earliest, type Loaded, type MetricKey } from './api.ts';
import { HR_LEGEND, HrTrendChart, TrendChart, Zoomable, tip } from './charts.tsx';
import { axisEvents, heartTrend, meanValid, metricTrend, valueOf } from './derive.ts';
import { addDays, maxDate, nf, warsawToday , firstDay } from './format.ts';
import { tableBounds, type RangePrefs } from './table.tsx';
import { ZoomDialog, zoomSize } from './zoom.tsx';
import { Loading } from './logo.tsx';

export const aggregations: ['day' | 'week', string][] = [['day', 'Dni'], ['week', 'Tygodnie']];
/** Trends of the six M1 metrics and heart rate, from the same day snapshots as the table, with events on the axis. */
export function TrendsView({ earliest, prefs, agg }: { earliest: Loaded<Earliest>; prefs: RangePrefs; agg: 'day' | 'week' }) {
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
  // same order as on the day screen: energy, activity, body; the heart rate closes the set
  const order = ['energy', 'activity', 'body'], ordered = [...metrics].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const mean = (key: MetricKey) => { const metric = metricOf(key); return meanValid(rows, key, from, to, metric.group === 'body').mean; };
  const withUnit = (value: number | null, decimals: number, unit: string) => value === null ? null : `${nf(value, decimals)}${unit ? ` ${unit}` : ''}`;
  const zoomMean = zoom === null ? null : zoom === 'hr' ? withUnit(hrMean, 0, 'bpm') : withUnit(mean(zoom), metricOf(zoom).decimals, metricOf(zoom).unit);
  const chart = (key: MetricKey, size?: { W: number; H: number }) => { const metric = metricOf(key);
    return <TrendChart points={metricTrend(rows, key, agg, key === 'total_energy' && to === today ? forecast.data ?? null : undefined)} form={metric.form} color={groups[metric.group].color} decimals={metric.decimals} label={metric.label} events={events(key)} agg={agg} forecast={key === 'total_energy' ? fc : null} width={size?.W} height={size?.H} />; };
  const { W, H } = zoomSize();
  return <>
    <div className="events"><span className="event"><i className="ev-legacy" />starszy model kalorii</span><span className="event"><i className="ev-hatch" />okres nieporównywalny</span>{fc && <span className="event"><i className="ev-fc" />prognoza do 24:00</span>}{agg === 'week' && <span className="event">Słupek bledszy = mniej dób z wartością w tygodniu</span>}</div>
    <div className="tgrid">
      {ordered.map((metric) => { const body = metric.group === 'body', a = meanValid(rows, metric.key, from, to, body);
        return <section key={metric.key} className="panel tcard"><header><h3 className="th"><i style={{ background: groups[metric.group].color }} />{metric.label}</h3>
          <span className="stat" {...(!body && to === today ? tip(['Dzisiejsza doba nie jest brana pod uwagę do średniej, bo jeszcze trwa']) : {})}>śr. <b>{a.mean === null ? '—' : nf(a.mean, metric.decimals)}</b>{a.mean !== null && metric.unit ? ` ${metric.unit}` : ''}</span></header>
          <Zoomable label={metric.label} onZoom={() => setZoom(metric.key)}>{chart(metric.key)}</Zoomable></section>; })}
      <section className="panel tcard"><header><h3 className="th"><i style={{ background: 'var(--c-band)' }} />Tętno</h3>
        <span className="stat">śr. <b>{hrMean === null ? '—' : nf(hrMean)}</b>{hrMean !== null ? ' bpm' : ''}</span></header>
        {hr.error ? <p role="alert">Nie udało się odczytać tętna.</p> : <Zoomable label="tętno" onZoom={() => setZoom('hr')}><HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} /></Zoomable>}</section>
      <section className="panel tcard future"><header><h3>Tętno spoczynkowe</h3><span className="tag">M2</span></header><p className="sub" style={{ margin: 0 }}>Osobny typ z Google Health API. Nie jest minimum ani średnią tętna dnia, więc nie wyliczamy go z okien.</p></section>
    </div>
    <section className="panel"><header><h3>Porównania i korelacje</h3><span className="tag">M2+</span></header><p className="sub" style={{ margin: 0 }}>Obciążenie tygodnia, sen a aktywność, spożycie a wydatek. Opis korelacji osobno od wniosków przyczynowych.</p></section>
    {zoom && <ZoomDialog title={`${zoom === 'hr' ? 'Tętno' : metricOf(zoom).label}${zoomMean ? `: śr. ${zoomMean}` : ''}`} legend={zoom === 'hr' ? HR_LEGEND : null} onClose={() => setZoom(null)}>
      {zoom === 'hr' ? <HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} width={W} height={H} /> : chart(zoom, { W, H })}</ZoomDialog>}
  </>;
}
