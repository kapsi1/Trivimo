import { z } from 'zod';

export type AggregateType = 'steps' | 'distance' | 'active-energy-burned' | 'total-calories';
export interface CivilRange { start: string; end: string }

/** Half-open producer civil days, not Warsaw day intervals. No network call or qualification. */
export function planDailyRollups(type: AggregateType, start: string, end: string): CivilRange[] {
  z.enum(['steps', 'distance', 'active-energy-burned', 'total-calories']).parse(type);
  z.iso.date().parse(start); z.iso.date().parse(end);
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
  if (first >= last) throw new Error('Nieprawidłowy zakres');
  const limit = (type === 'total-calories' ? 14 : 90) * 86400000;
  const chunks: CivilRange[] = [];
  for (let cursor = first; cursor < last; cursor += limit) {
    if (chunks.length >= 1000) throw new Error('Zakres jest zbyt duży');
    chunks.push({ start: new Date(cursor).toISOString().slice(0, 10), end: new Date(Math.min(cursor + limit, last)).toISOString().slice(0, 10) });
  }
  return chunks;
}
