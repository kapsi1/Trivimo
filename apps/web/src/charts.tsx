import { useEffect, useRef, type ReactNode } from 'react';
import { addDays, diffDays, fitAxis, fmtD, isoWeek, MON, mondayOf, nf, niceTicks } from './format.ts';

/** Tooltip lines as a data attribute: first line is the title (date, hours or week), then value lines. */
export const tip = (lines: (string | false | null | undefined)[]) => ({ 'data-tip': JSON.stringify(lines.filter(Boolean)) });

/** One global tooltip for every element with data-tip; short, never the only place a value is shown. */
export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current!; let source: Element | null = null;
    const hide = () => { element.hidden = true; source = null; };
    const move = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
      if (!target) { if (!element.hidden) hide(); return; }
      if (target !== source) {
        source = target; let lines: string[] = [];
        try { lines = JSON.parse(target.getAttribute('data-tip') ?? '[]') as string[]; } catch { /* malformed: show nothing */ }
        element.replaceChildren(...lines.map((line, index) => { const node = document.createElement(index ? 'span' : 'b'); node.textContent = line; return node; }));
      }
      element.hidden = false;
      const box = element.getBoundingClientRect(); let x = event.clientX + 14, y = event.clientY + 16;
      if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - 14;
      if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - 16;
      element.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    };
    // also hide when the pointer leaves the window, the tab or window loses focus, or the view changes under the pointer
    const out = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerout', out); document.addEventListener('click', hide); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('scroll', hide, true); window.addEventListener('blur', hide); window.addEventListener('hashchange', hide);
    return () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerout', out); document.removeEventListener('click', hide); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide); window.removeEventListener('hashchange', hide);
    };
  }, []);
  return <div ref={ref} className="tip" role="tooltip" hidden />;
}

/** The "?" button in a chart or card corner: opens the metadata panel without zooming the chart. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="info" aria-label={`Skąd te dane: ${label}`} title="Skąd te dane" onClick={(event) => { event.stopPropagation(); onClick(); }}>?</button>;
}
/** A chart area that opens its zoomed version on click or Enter. */
export function Zoomable({ label, onZoom, children, style }: { label: string; onZoom: () => void; children: ReactNode; style?: React.CSSProperties }) {
  return <div className="zoomable" role="button" tabIndex={0} aria-label={`Powiększ wykres: ${label}`} style={style} onClick={onZoom} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onZoom(); } }}>{children}</div>;
}

export interface SparkPoint { value: number | null; provisional: boolean; tip: string[] }
/** 14 days: bars for totals, a line joining measured days for measurements; the last bar can carry a dashed forecast. */
export function Sparkline({ points, form, color, forecast }: { points: SparkPoint[]; form: 'bar' | 'line'; color: string; forecast?: { now: number; total: number } | null }) {
  const W = 140, H = 34, n = points.length, step = (W - 8) / Math.max(1, n - 1), x = (i: number) => 4 + i * step;
  const hits = points.map((point, i) => <rect key={`h${i}`} className="hit" x={x(i) - step / 2} y={0} width={step} height={H} {...tip(point.tip)} />);
  const values = points.flatMap((point) => point.value === null ? [] : [point.value]); if (forecast) values.push(forecast.total);
  if (!values.length) return <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><line x1={0} x2={W} y1={30} y2={30} className="axis" strokeDasharray="2 3" />{hits}</svg>;
  const max = Math.max(...values), min = form === 'bar' ? 0 : Math.min(...values), span = max - min || 1, y = (v: number) => 30 - ((v - min) / span) * 26;
  let marks: ReactNode;
  if (form === 'bar') {
    marks = <>{points.map((point, i) => point.value !== null ? <rect key={i} x={x(i) - 3.5} y={y(point.value)} width={7} height={Math.max(1, 30 - y(point.value))} rx={1.5} fill={color} opacity={point.provisional ? 0.45 : i === n - 1 ? 1 : 0.55} /> : <rect key={i} x={x(i) - 3.5} y={29} width={7} height={1} fill="var(--faint)" />)}
      {forecast && <rect x={x(n - 1) - 3} y={y(forecast.total)} width={6} height={Math.max(0, y(forecast.now) - y(forecast.total))} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 1.5" />}</>;
  } else {
    const path = points.reduce((acc, point, i) => point.value === null ? acc : `${acc}${acc ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.value).toFixed(1)}`, '');
    const last = points.map((point, i) => point.value !== null ? i : -1).filter((i) => i >= 0).pop();
    marks = <><path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />{points.map((point, i) => point.value === null ? null : <circle key={i} cx={x(i)} cy={y(point.value)} r={i === last ? 2.8 : 1.6} fill={color} />)}</>;
  }
  return <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">{marks}{hits}</svg>;
}

export interface HrPoint { avg: number | null; min: number | null; max: number | null; tip: string[] }
/** 14 days of heart rate: a min–max stroke per day and a line of the day's window mean. */
export function HrSpark({ points }: { points: HrPoint[] }) {
  const W = 140, H = 34, n = points.length, step = (W - 8) / Math.max(1, n - 1), x = (i: number) => 4 + i * step;
  const hits = points.map((point, i) => <rect key={`h${i}`} className="hit" x={x(i) - step / 2} y={0} width={step} height={H} {...tip(point.tip)} />);
  const ok = points.filter((point) => point.avg !== null);
  if (!ok.length) return <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><line x1={0} x2={W} y1={30} y2={30} className="axis" strokeDasharray="2 3" />{hits}</svg>;
  const lo = Math.min(...ok.map((point) => point.min!)), hi = Math.max(...ok.map((point) => point.max!)), y = (v: number) => 31 - ((v - lo) / (hi - lo || 1)) * 28;
  const path = points.reduce((acc, point, i) => point.avg === null ? acc : `${acc}${acc ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.avg).toFixed(1)}`, '');
  const last = points.map((point, i) => point.avg !== null ? i : -1).filter((i) => i >= 0).pop();
  return <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    {points.map((point, i) => point.avg === null ? null : <line key={i} x1={x(i)} x2={x(i)} y1={y(point.max!)} y2={y(point.min!)} stroke="color-mix(in srgb, var(--c-band) 35%, transparent)" strokeWidth={3} strokeLinecap="round" />)}
    <path d={path} fill="none" stroke="var(--c-band)" strokeWidth={1.6} strokeLinejoin="round" />
    {points.map((point, i) => point.avg === null ? null : <circle key={`c${i}`} cx={x(i)} cy={y(point.avg)} r={i === last ? 2.8 : 1.6} fill="var(--c-band)" />)}{hits}</svg>;
}

export type HourKey = 'total' | 'active' | 'steps' | 'distance';
export interface HourPoint { start: number; label: string; range: string; total: number | null; active: number | null; steps: number | null; distance: number | null; fc: number | null; now: boolean; future: boolean; hrWindows: number | null; hrAvg: number | null }
export interface HrWindow { index: number; label: string; avg: number; min: number; max: number }
const hourUnits: Record<HourKey, string> = { total: 'kcal', active: 'kcal', steps: 'kroków', distance: 'km' };
/** Tooltip lines about whose estimate the calories are: phone, band or mixed, from the share of windows with heart rate. */
export function energyTip(hrWindows: number | null, windows: number): string[] {
  if (hrWindows === null) return ['Źródło: nieustalone'];
  return [`Źródło: ${hrWindows === 0 ? 'telefon' : hrWindows >= windows ? 'opaska' : 'mieszane'}`, `Opaska: ${nf(hrWindows / windows * 100)} %`];
}
/**
 * Hourly bars. For burned kcal: the part outside active kcal plus active kcal; for a day in progress a dashed resting
 * forecast fills the rest of the current hour and the future hours. With `hr`: the heart-rate window means on a right axis.
 */
export function HourChart({ hours, metric, height = 150, width = 640, hr }: { hours: HourPoint[]; metric: HourKey; height?: number; width?: number; hr?: HrWindow[] }) {
  const H = height, W = width, L = 36, B = 18, T = 8, big = H > 200, color = metric === 'steps' || metric === 'distance' ? 'var(--c-activity)' : 'var(--c-energy)';
  const win = hr ?? [], R = win.length ? 40 : 0, PW = W - R, stacked = metric === 'total';
  const values = hours.flatMap((h) => [h[metric], stacked && h.fc !== null ? (h.total ?? 0) + h.fc : null]).filter((v): v is number => v !== null);
  if (!values.length) return <p className="sub">Brak danych godzinowych.</p>;
  const ticks = niceTicks(0, Math.max(...values, 1), big ? 4 : 2), top = ticks.at(-1)!;
  const n = hours.length, step = (PW - L) / n, base = H - B, y = (v: number) => T + (base - T) * (1 - v / top);
  const decimals = metric === 'distance' ? 2 : 0, unit = hourUnits[metric];
  let hrMarks: ReactNode = null;
  if (win.length) {
    const { ticks: hticks, lo: h0, hi: h1 } = fitAxis(Math.min(...win.map((v) => v.avg)), Math.max(...win.map((v) => v.avg)), big ? 4 : 2);
    const y2 = (v: number) => T + (base - T) * (1 - (v - h0) / (h1 - h0)), ws = step / 6, xw = (i: number) => L + i * ws + ws / 2;
    let path = '', previous = -2; for (const v of win) { path += `${v.index === previous + 1 ? 'L' : 'M'}${xw(v.index).toFixed(1)},${y2(v.avg).toFixed(1)}`; previous = v.index; }
    const indexes = new Set(win.map((v) => v.index));
    hrMarks = <><path d={path} fill="none" stroke="var(--c-band)" strokeWidth={1.8} strokeLinejoin="round" />
      {win.filter((v) => !indexes.has(v.index - 1) && !indexes.has(v.index + 1)).map((v) => <circle key={v.index} cx={xw(v.index)} cy={y2(v.avg)} r={2} fill="var(--c-band)" />)}
      {hticks.map((t) => <text key={`hr${t}`} x={PW + 6} y={y2(t) + 3.5} style={{ fill: 'var(--c-band)' }}>{t}</text>)}</>;
  }
  const lines = (h: HourPoint) => {
    const out = [h.range];
    if (h.future && !(stacked && h.fc !== null)) out.push('—');
    else if (stacked) { if (h.total !== null) out.push(`${nf(h.total)} kcal`); else out.push('—'); if (h.fc !== null) out.push(`Prognoza: ${nf((h.total ?? 0) + h.fc)} kcal`); }
    else out.push(h[metric] === null ? '—' : `${nf(h[metric]!, decimals)} ${unit}`);
    if ((metric === 'total' || metric === 'active') && !h.future && h[metric] !== null) out.push(...energyTip(h.hrWindows, 6));
    if (hr && h.hrAvg !== null) out.push(`Tętno: śr. ${nf(h.hrAvg)} bpm`);
    return out;
  };
  const every = W > 900 ? 1 : 3;
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rozkład godzinowy, ${unit}${win.length ? ', z tętnem' : ''}`}>
    {ticks.map((t) => <g key={t}><line className="grid" x1={L} x2={PW} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end">{nf(t, metric === 'distance' ? 1 : 0)}</text></g>)}
    {hours.map((h, i) => {
      const x = L + i * step + 1.5, w = Math.max(1, step - 3), opacity = h.now ? 0.55 : 1;
      const total = h.total, rest = total === null ? null : total - (h.active ?? 0);
      return <g key={h.start}>
        {stacked && total !== null && rest !== null && <><rect x={x} y={y(rest)} width={w} height={Math.max(0, base - y(rest))} fill="color-mix(in srgb, var(--c-energy) 32%, transparent)" opacity={opacity} />
          {!!h.active && <rect x={x} y={y(total)} width={w} height={Math.max(0, y(rest) - y(total))} fill="var(--c-energy)" opacity={opacity} />}</>}
        {!stacked && h[metric] !== null && <rect x={x} y={y(h[metric]!)} width={w} height={Math.max(0.5, base - y(h[metric]!))} rx={2} fill={color} opacity={h.now ? 0.45 : 0.9} />}
        {stacked && h.fc !== null ? <rect x={x + 0.5} y={y((total ?? 0) + h.fc)} width={Math.max(0, w - 1)} height={Math.max(0, y(total ?? 0) - y((total ?? 0) + h.fc))} fill="color-mix(in srgb, var(--c-energy) 8%, transparent)" stroke="var(--c-energy)" strokeWidth={1} strokeDasharray="3 2" />
          : h.future ? <rect x={x} y={base - 2} width={w} height={2} fill="var(--line-strong)" /> : null}
      </g>;
    })}
    {hrMarks}<line className="axis" x1={L} x2={PW} y1={base} y2={base} />
    {hours.map((h, i) => i % every === 0 || h.label.endsWith('′') ? <text key={`l${h.start}`} x={L + i * step + step / 2} y={H - 4} textAnchor="middle">{h.label}</text> : null)}
    {hours.map((h, i) => <rect key={`t${h.start}`} className="hit" x={L + i * step} y={T} width={step} height={base - T} {...tip(lines(h))} />)}
  </svg>;
}

/** Heart rate in ten-minute windows: a min–max band and the window mean; windows without a measurement are gaps. */
export function HrDayChart({ windows, slots, hours, height = 150, width = 640 }: { windows: HrWindow[]; slots: number; hours: HourPoint[]; height?: number; width?: number }) {
  const H = height, W = width, L = 36, B = 18, T = 8, base = H - B;
  if (!windows.length) return <p className="sub">Brak pomiarów tętna tej doby.</p>;
  const { ticks, lo: t0, hi: t1 } = fitAxis(Math.min(...windows.map((v) => v.min)), Math.max(...windows.map((v) => v.max)), H > 200 ? 5 : H < 100 ? 2 : 3);
  const step = (W - L) / slots, x = (i: number) => L + i * step + step / 2, y = (v: number) => T + (base - T) * (1 - (v - t0) / (t1 - t0));
  let path = '', previous = -2; for (const v of windows) { path += `${v.index === previous + 1 ? 'L' : 'M'}${x(v.index).toFixed(1)},${y(v.avg).toFixed(1)}`; previous = v.index; }
  const indexes = new Set(windows.map((v) => v.index)), every = W > 900 ? 1 : 3;
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tętno w oknach 10-minutowych">
    {ticks.map((t) => <g key={t}><line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end">{t}</text></g>)}
    {windows.map((v) => <rect key={v.index} x={L + v.index * step} y={y(v.max)} width={Math.max(1, step - 0.3)} height={Math.max(1, y(v.min) - y(v.max))} fill="color-mix(in srgb, var(--c-band) 30%, transparent)" />)}
    <path d={path} fill="none" stroke="var(--c-band)" strokeWidth={1.6} strokeLinejoin="round" />
    {windows.filter((v) => !indexes.has(v.index - 1) && !indexes.has(v.index + 1)).map((v) => <circle key={`c${v.index}`} cx={x(v.index)} cy={y(v.avg)} r={2} fill="var(--c-band)" />)}
    <line className="axis" x1={L} x2={W} y1={base} y2={base} />
    {hours.map((h, i) => i % every === 0 || h.label.endsWith('′') ? <text key={h.start} x={L + (i * 6 + 3) * step} y={H - 4} textAnchor="middle">{h.label}</text> : null)}
    {windows.map((v) => <rect key={`t${v.index}`} className="hit" x={L + v.index * step} y={T} width={step} height={base - T} {...tip([v.label, `śr. ${nf(v.avg)} bpm`, `${nf(v.min)}–${nf(v.max)} bpm`])} />)}
  </svg>;
}

export interface TrendPt { date: string; value: number | null; provisional: boolean; legacy: boolean; coverage?: number; tip: string[] }
export interface HrTrendPt { date: string; avg: number | null; min: number | null; max: number | null; tip: string[] }
/** Periods (hatched) and moments (dashed line) on the time axis instead of invisible jumps. */
export interface AxisEvent { from?: string; to?: string; at?: string; label: string }
interface Frame { agg: 'day' | 'week'; W: number; H: number; L: number; T: number; B: number; step: number; x: (i: number) => number; idx: (date: string) => number; n: number; first: string; last: string }
function frame(points: { date: string }[], agg: 'day' | 'week', W: number, H: number): Frame {
  const L = 44, B = 20, T = 14, n = points.length, step = (W - L) / Math.max(1, n), first = points[0]?.date ?? '', last = points.at(-1)?.date ?? '';
  return { agg, W, H, L, T, B, step, n, first, last: agg === 'week' ? addDays(last, 6) : last, x: (i) => L + i * step + step / 2, idx: (date) => agg === 'week' ? points.findIndex((point) => point.date === mondayOf(date)) : diffDays(first, date) };
}
function AxisDecor({ f, points, events, highlight }: { f: Frame; points: { date: string }[]; events: AxisEvent[]; highlight?: string }) {
  const { L, T, H, B, step, n, W } = f;
  const every = n <= 31 ? Math.max(1, Math.ceil(n * 48 / W)) : 0;
  // Month labels: keep at least `gap` units between them. Thin out to every 2nd/3rd/4th/6th month, then to January only, then to every k-th year.
  const gap = 54, months = Math.max(1, (f.agg === 'week' ? n * 7 : n) / 30.4), need = Math.ceil(gap * months / Math.max(1, W - L));
  const monthStep = [1, 2, 3, 4, 6, 12].find((candidate) => candidate >= need) ?? 12, yearStep = need > 12 ? Math.ceil(need / 12) : 1;
  const monthShown = (date: string) => { const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)); return monthStep < 12 ? (month - 1) % monthStep === 0 : month === 1 && year % yearStep === 0; };
  // Event labels sit on one line above the plot (a period's label is right-aligned to the end of its band): each is cut at the start of the next one so they never overlap.
  const glyph = 7.2;
  const placed = events.flatMap((event, k) => {
    if (event.from && event.to && event.to >= f.first && event.from <= f.last) {
      const a = Math.max(0, f.idx(event.from < f.first ? f.first : event.from)), b = Math.min(n - 1, f.idx(event.to > f.last ? f.last : event.to));
      if (b < a) return [];
      const right = L + (b + 1) * step - 4; return [{ key: k, x: Math.max(L + 4, right - event.label.length * glyph), text: event.label, node: <rect x={L + a * step} y={T} width={(b - a + 1) * step} height={H - B - T} fill="url(#hatch)" opacity={0.7} /> }];
    }
    if (event.at && event.at >= f.first && event.at <= f.last) { const xi = L + f.idx(event.at) * step; return [{ key: k, x: xi + 4, text: event.label, node: <line x1={xi} x2={xi} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" /> }]; }
    return [];
  }).sort((a, b) => a.x - b.x);
  const labelled = placed.map((item, i) => ({ ...item, room: (placed[i + 1]?.x ?? W) - item.x - 8 }));
  return <>
    {highlight && f.idx(highlight) >= 0 && f.idx(highlight) < n && <rect x={L + f.idx(highlight) * step} y={T} width={step} height={H - B - T} fill="color-mix(in srgb, var(--accent) 16%, transparent)" />}
    {labelled.map(({ key, node, text, x, room }) => <g key={key}>{node}{room >= 4 * glyph && <text x={x} y={T - 3}>{text.length * glyph <= room ? text : `${text.slice(0, Math.max(1, Math.floor(room / glyph) - 1))}…`}</text>}</g>)}
    {points.map((point, i) => {
      if (!every && !monthShown(point.date)) return null;
      const show = every ? i % every === (n - 1) % every : f.agg === 'week' ? Number(point.date.slice(8)) <= 7 : point.date.slice(8) === '01';
      return show ? <text key={point.date} x={f.x(i)} y={H - 5} textAnchor="middle">{every ? fmtD(point.date) : point.date.slice(5, 7) === '01' ? point.date.slice(0, 4) : MON[Number(point.date.slice(5, 7)) - 1]}</text> : null;
    })}
  </>;
}
const hatch = <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="2" /></pattern>;

/** Bars from zero for daily totals, a line joining measured days for measurements; a missing day is never a value. */
export function TrendChart({ points, form, color, decimals, label, events = [], highlight, forecast, width = 640, height = 150, agg = 'day' }: { points: TrendPt[]; form: 'bar' | 'line'; color: string; decimals: number; label: string; events?: AxisEvent[]; highlight?: string; forecast?: { now: number; total: number } | null; width?: number; height?: number; agg?: 'day' | 'week' }) {
  const values = points.flatMap((point) => point.value === null ? [] : [point.value]); if (forecast) values.push(forecast.total);
  if (!values.length) return <p className="sub">Brak wartości w tym okresie.</p>;
  const f = frame(points, agg, width, height), { L, T, B, H, W, step, n } = f, bar = form === 'bar', big = H > 200;
  let lo = bar ? 0 : Math.min(...values), hi = Math.max(...values);
  if (!bar) { const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad; }
  const ticks = niceTicks(lo, hi, big ? 5 : 3).filter((t) => bar || (t >= lo && t <= hi)), top = bar ? ticks.at(-1)! : hi, bottom = bar ? 0 : lo;
  const y = (v: number) => T + (H - B - T) * (1 - (v - bottom) / (top - bottom));
  const bx = (i: number) => L + i * step + Math.min(1, step * 0.15), bw = Math.max(1, step - Math.min(2, step * 0.3));
  const path = points.reduce((acc, point, i) => point.value === null ? acc : `${acc}${acc ? 'L' : 'M'}${f.x(i).toFixed(1)},${y(point.value).toFixed(1)}`, '');
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${values.length - (forecast ? 1 : 0)} wartości z ${n}`}>
    <defs>{hatch}<pattern id="legacy" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="color-mix(in srgb, var(--c-energy) 25%, transparent)" /><line x1="0" y1="0" x2="0" y2="4" stroke="var(--c-energy)" strokeWidth="1.6" /></pattern></defs>
    {ticks.map((t) => <g key={t}><line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end">{nf(t, decimals && !bar ? 1 : 0)}</text></g>)}
    <AxisDecor f={f} points={points} events={events} highlight={highlight} />
    {bar ? <>{points.map((point, i) => point.value === null ? null : <rect key={point.date} x={bx(i)} y={y(point.value)} width={bw} height={Math.max(0.5, y(bottom) - y(point.value))} rx={Math.min(2, step / 4)} fill={point.legacy ? 'url(#legacy)' : color} opacity={point.provisional ? (point.coverage !== undefined ? 0.3 + point.coverage * 0.6 : 0.4) : 0.9} />)}
      {forecast && <rect x={bx(n - 1)} y={y(forecast.total)} width={bw} height={Math.max(0, y(forecast.now) - y(forecast.total))} fill="color-mix(in srgb, var(--c-energy) 8%, transparent)" stroke={color} strokeWidth={1} strokeDasharray="3 2" />}</>
      : <><path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" opacity={0.85} />{points.map((point, i) => point.value === null ? null : <circle key={point.date} cx={f.x(i)} cy={y(point.value)} r={n > 120 ? 1.8 : big ? 3.2 : 2.6} fill={color} opacity={point.provisional ? 0.5 : 1} />)}</>}
    <line className="axis" x1={L} x2={W} y1={H - B} y2={H - B} />
    {points.map((point, i) => <rect key={`t${point.date}`} className="hit" x={L + i * step} y={T} width={step} height={H - B - T} {...tip(point.tip)} />)}
  </svg>;
}

/** Heart rate over days or weeks: a vertical min–max stroke and a line of the mean of window means. */
export function HrTrendChart({ points, events = [], highlight, width = 640, height = 150, agg = 'day' }: { points: HrTrendPt[]; events?: AxisEvent[]; highlight?: string; width?: number; height?: number; agg?: 'day' | 'week' }) {
  const ok = points.filter((point) => point.avg !== null);
  if (!ok.length) return <p className="sub">Brak pomiarów tętna w tym okresie.</p>;
  const f = frame(points, agg, width, height), { L, T, B, H, W, step, n } = f, big = H > 200;
  const { ticks, lo: t0, hi: t1 } = fitAxis(Math.min(...ok.map((point) => point.min!)), Math.max(...ok.map((point) => point.max!)), big ? 5 : 3);
  const y = (v: number) => T + (H - B - T) * (1 - (v - t0) / (t1 - t0)), sw = Math.max(1, Math.min(5, step * 0.5));
  const path = points.reduce((acc, point, i) => point.avg === null ? acc : `${acc}${acc ? 'L' : 'M'}${f.x(i).toFixed(1)},${y(point.avg).toFixed(1)}`, '');
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tętno: ${ok.length} wartości z ${n}`}>
    <defs>{hatch}</defs>
    {ticks.map((t) => <g key={t}><line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end">{t}</text></g>)}
    <AxisDecor f={f} points={points} events={events} highlight={highlight} />
    {points.map((point, i) => point.avg === null ? null : <line key={point.date} x1={f.x(i)} x2={f.x(i)} y1={y(point.max!)} y2={y(point.min!)} stroke="color-mix(in srgb, var(--c-band) 40%, transparent)" strokeWidth={sw} strokeLinecap="round" />)}
    <path d={path} fill="none" stroke="var(--c-band)" strokeWidth={1.6} strokeLinejoin="round" opacity={0.85} />
    {points.map((point, i) => point.avg === null ? null : <circle key={`c${point.date}`} cx={f.x(i)} cy={y(point.avg)} r={n > 120 ? 1.6 : big ? 3 : 2.4} fill="var(--c-band)" />)}
    <line className="axis" x1={L} x2={W} y1={H - B} y2={H - B} />
    {points.map((point, i) => <rect key={`t${point.date}`} className="hit" x={L + i * step} y={T} width={step} height={H - B - T} {...tip(point.tip)} />)}
  </svg>;
}
export const weekTitle = (monday: string) => `Tydzień ${isoWeek(monday)} · ${fmtD(monday)}–${fmtD(addDays(monday, 6))}`;

export const HR_LEGEND = <><span><i style={{ background: 'var(--c-band)' }} />średnia okna</span><span><i style={{ background: 'color-mix(in srgb, var(--c-band) 30%, transparent)' }} />min–maks.</span></>;
export function EnergyLegend({ forecast }: { forecast: boolean }) {
  return <><span><i style={{ background: 'var(--c-energy)' }} />aktywne</span><span><i style={{ background: 'color-mix(in srgb, var(--c-energy) 32%, transparent)' }} />spalone poza aktywnymi</span>{forecast && <span><i className="i-fc" />prognoza bez aktywności</span>}</>;
}
