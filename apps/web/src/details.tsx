import { useEffect, useRef } from 'react';
import { quality, type MetricValue } from './api.ts';
import type { HourKey } from './charts.tsx';

const CloseIcon = () => <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>;
/** Modal dialog shell of the zoom: focus moves in, Esc closes, focus returns. */
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

const hourLabels: Record<HourKey, string> = { active: 'Aktywne kcal', total: 'Spalone kcal', steps: 'Kroki', distance: 'Dystans' };
export const hourMetricLabel = (key: HourKey) => hourLabels[key];

export { CloseIcon };
