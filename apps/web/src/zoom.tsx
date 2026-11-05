import type { ReactNode } from 'react';
import { addDays, warsawToday , firstDay } from './format.ts';
import { CloseIcon, useDialog } from './details.tsx';

/** Size of a zoomed chart: wide on desktop, narrower on a phone; the window height stays fixed across metric switches. */
export const zoomSize = () => window.innerWidth < 700 ? { W: 640, H: 260 } : { W: 1100, H: 340 };

export function Segmented<T extends string | number>({ items, value, onChange, label, className }: { items: [T, string][]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return <div className={`seg ${className ?? ''}`} role="group" aria-label={label}>{items.map(([key, text]) => <button type="button" key={String(key)} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}</div>;
}

const arrow = (path: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>;
/** Day picker: arrows, date field and "Dziś"; days from the first supported day to today. Used in the top bar and in day zooms. */
export function DateControl({ date, onDate }: { date: string; onDate: (date: string) => void }) {
  const today = warsawToday();
  return <div className="datectl">
    <button type="button" className="iconbtn" aria-label="Poprzedni dzień" disabled={date <= firstDay} onClick={() => onDate(addDays(date, -1))}>{arrow('M15 5l-7 7 7 7')}</button>
    <input type="date" value={date} min={firstDay} max={today} aria-label="Wybierz dzień" onChange={(event) => { if (event.target.value) onDate(event.target.value); }} />
    <button type="button" className="iconbtn" aria-label="Następny dzień" disabled={date >= today} onClick={() => onDate(addDays(date, 1))}>{arrow('M9 5l7 7-7 7')}</button>
    <button type="button" className="btn ghost" disabled={date === today} onClick={() => onDate(today)}>Dziś</button></div>;
}

export function ZoomDialog({ title, sub, controls, legend, onClose, children }: { title: string; sub?: string; controls?: ReactNode; legend?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useDialog(onClose); const { W, H } = zoomSize();
  // the top bar (date, tabs) stays usable while a chart is zoomed: the dialog starts below it
  const top = Math.max(0, Math.round(document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0));
  return <><div className="scrim zscrim" onClick={onClose} /><section ref={ref} className="zoom" style={{ top: top + 8, maxHeight: `calc(100% - ${top + 16}px)` }} role="dialog" aria-modal="true" aria-labelledby="ztitle">
    <header><div><h2 id="ztitle">{title}</h2>{sub && <p>{sub}</p>}</div><div className="zctl">{controls}<button type="button" className="iconbtn" onClick={onClose} aria-label="Zamknij"><CloseIcon /></button></div></header>
    <div className="zbody"><div className="legend" style={{ minHeight: 20 }}>{legend}</div><div style={{ aspectRatio: `${W} / ${H}` }}>{children}</div></div></section></>;
}
