import type { ReactNode } from 'react';
import { InfoButton } from './charts.tsx';
import { CloseIcon, useDialog } from './details.tsx';

/** Size of a zoomed chart: wide on desktop, narrower on a phone; the window height stays fixed across metric switches. */
export const zoomSize = () => window.innerWidth < 700 ? { W: 640, H: 260 } : { W: 1100, H: 340 };

export function Segmented<T extends string | number>({ items, value, onChange, label, className }: { items: [T, string][]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return <div className={`seg ${className ?? ''}`} role="group" aria-label={label}>{items.map(([key, text]) => <button type="button" key={String(key)} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}</div>;
}

export function ZoomDialog({ title, sub, controls, legend, onInfo, onClose, children }: { title: string; sub: string; controls?: ReactNode; legend?: ReactNode; onInfo: () => void; onClose: () => void; children: ReactNode }) {
  const ref = useDialog(onClose); const { W, H } = zoomSize();
  return <><div className="scrim zscrim" onClick={onClose} /><section ref={ref} className="zoom" role="dialog" aria-modal="true" aria-labelledby="ztitle">
    <header><div><h2 id="ztitle">{title}</h2><p>{sub}</p></div><div className="zctl">{controls}<InfoButton label={title} onClick={onInfo} /><button type="button" className="iconbtn" onClick={onClose} aria-label="Zamknij"><CloseIcon /></button></div></header>
    <div className="zbody"><div className="legend" style={{ minHeight: 20 }}>{legend}</div><div style={{ aspectRatio: `${W} / ${H}` }}>{children}</div></div></section></>;
}
