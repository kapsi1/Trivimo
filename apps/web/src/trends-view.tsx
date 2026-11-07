import { useState } from 'react';
import type { z } from 'zod';
import { forecastSchema, groups, heartRateRangeSchema, metricOf, metrics, rangeSchema, useChunkedJson, useJson, earliestOf, type Earliest, type Loaded, type MetricKey } from './api.ts';
import { HR_RANGE_LEGEND, HrTrendChart, TrendChart, Zoomable, tip } from './charts.tsx';
import { axisEvents, forecastHint, heartTrend, meanValid, metricTrend, summaryMean, summaryTrend, valueOf } from './derive.ts';
import { summaryRowOf, summaryRows } from './summaries.tsx';
import { summaryMainKey, type SummaryType } from './summary-number.ts';
import { addDays, maxDate, nf, appToday , firstDay } from './format.ts';
import { tableBounds, type RangePrefs } from './table.tsx';
import { ZoomDialog, zoomSize } from './zoom.tsx';
import { Loading } from './logo.tsx';

const isSummaryType = (key: string): key is SummaryType => key in summaryMainKey;
export const aggregations: ['day' | 'week', string][] = [['day', 'Dni'], ['week', 'Tygodnie']];
/** Trends of the six M1 metrics and heart rate, from the same day snapshots as the table, with events on the axis. */
export function TrendsView({ earliest, prefs, agg, legend }: { earliest: Loaded<Earliest>; prefs: RangePrefs; agg: 'day' | 'week'; legend: boolean }) {
  const [zoom, setZoom] = useState<MetricKey | SummaryType | 'hr' | null>(null);
  // "Od początku": on the dashboard the first day of any chart, in a chart's zoom the first day of that chart only; producer
  // summaries have no earliest day of their own, so in their zoom the scope of all charts applies
  const first = earliestOf(earliest, zoom && !isSummaryType(zoom) ? [zoom] : [...metrics.map((metric) => metric.key), 'hr']);
  const today = appToday(), { from, to } = tableBounds(prefs, first), history = from < addDays(to, -365) ? from : addDays(to, -365);
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
  // same order as on the day screen: energy, activity, body; the heart rate closes the set
  const order = ['energy', 'activity', 'body'], ordered = [...metrics].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const mean = (key: MetricKey) => { const metric = metricOf(key); return meanValid(rows, key, from, to, metric.group === 'body').mean; };
  const withUnit = (value: number | null, decimals: number, unit: string) => value === null ? null : `${nf(value, decimals)}${unit ? ` ${unit}` : ''}`;
  const zoomMean = zoom === null ? null : zoom === 'hr' ? null : isSummaryType(zoom) ? withUnit(summaryMean(rows, zoom).mean, summaryRowOf(zoom).digits, summaryRowOf(zoom).unit) : withUnit(mean(zoom), metricOf(zoom).decimals, metricOf(zoom).unit);
  const zoomLabel = zoom === null ? '' : zoom === 'hr' ? 'Tętno' : isSummaryType(zoom) ? summaryRowOf(zoom).label : metricOf(zoom).label;
  const chart = (key: MetricKey, size?: { W: number; H: number }) => { const metric = metricOf(key);
    return <TrendChart points={metricTrend(rows, key, agg, key === 'total_energy' && to === today ? forecast.data ?? null : undefined)} form={metric.form} color={groups[metric.group].color} decimals={metric.decimals} label={metric.label} events={events(key)} agg={agg} forecast={key === 'total_energy' ? fc : null} width={size?.W} height={size?.H} />; };
  const summaryChart = (type: SummaryType, size?: { W: number; H: number }) => { const row = summaryRowOf(type);
    return <TrendChart points={summaryTrend(rows, type, agg)} form="line" color={groups.body.color} decimals={row.digits} label={row.label} events={events('hr')} agg={agg} width={size?.W} height={size?.H} />; };
  const { W, H } = zoomSize();
  return <>
    {legend && <div className="events"><span className="event"><i className="ev-legacy" />starszy model kalorii</span><span className="event"><i className="ev-hatch" />okres nieporównywalny</span>{fc && <span className="event" title={forecast.data ? forecastHint(forecast.data) : undefined}><i className="ev-fc" />prognoza do 24:00</span>}{agg === 'week' && <span className="event">Słupek bledszy = mniej dób z wartością w tygodniu</span>}</div>}
    <div className="tgrid">
      {ordered.map((metric) => { const body = metric.group === 'body', a = meanValid(rows, metric.key, from, to, body);
        return <section key={metric.key} className="panel tcard"><header><h3 className="th"><i style={{ background: groups[metric.group].color }} />{metric.label}</h3>
          <span className="stat" {...(!body && to === today ? tip(['Dzisiejsza doba nie jest brana pod uwagę do średniej, bo jeszcze trwa']) : {})}>śr. <b>{a.mean === null ? '—' : nf(a.mean, metric.decimals)}</b>{a.mean !== null && metric.unit ? ` ${metric.unit}` : ''}</span></header>
          <Zoomable label={metric.label} onZoom={() => setZoom(metric.key)}>{chart(metric.key)}</Zoomable></section>; })}
      <section className="panel tcard"><header><h3 className="th"><i style={{ background: 'var(--c-band)' }} />Tętno</h3></header>
        {hr.error ? <p role="alert">Nie udało się odczytać tętna.</p> : <Zoomable label="tętno" onZoom={() => setZoom('hr')}><HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} /></Zoomable>}</section>
      {summaryRows.map((row) => { const a = summaryMean(rows, row.type);
        return <section key={row.type} className="panel tcard"><header><h3 className="th" title={row.hint}><i style={{ background: groups.body.color }} />{row.label}</h3>
          <span className="stat" {...tip(['Średnia z dób z jedną wartością; doby bez wartości lub z różnymi punktami są pominięte'])}>śr. <b>{a.mean === null ? '—' : nf(a.mean, row.digits)}</b>{a.mean !== null ? ` ${row.unit}` : ''}</span></header>
          <Zoomable label={row.label} onZoom={() => setZoom(row.type)}>{summaryChart(row.type)}</Zoomable></section>; })}
    </div>
    <section className="panel"><header><h3>Porównania i korelacje</h3><span className="tag">M2+</span></header><p className="sub" style={{ margin: 0 }}>Obciążenie tygodnia, sen a aktywność, spożycie a wydatek. Opis korelacji osobno od wniosków przyczynowych.</p></section>
    {zoom && <ZoomDialog title={`${zoomLabel}${zoomMean ? `: śr. ${zoomMean}` : ''}`} legend={zoom === 'hr' ? HR_RANGE_LEGEND : null} onClose={() => setZoom(null)}>
      {zoom === 'hr' ? <HrTrendChart points={hrPoints(agg)} events={events('hr')} agg={agg} width={W} height={H} /> : isSummaryType(zoom) ? summaryChart(zoom, { W, H }) : chart(zoom, { W, H })}</ZoomDialog>}
  </>;
}
