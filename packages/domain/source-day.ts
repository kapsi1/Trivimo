import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Assign an explicitly offset source timestamp to the application's Warsaw civil day. */
export function sourceDay(timestamp: string): string {
  if (!timestampSchema.safeParse(timestamp).success) throw new Error('Nieprawidłowy czas źródła');
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) throw new Error('Nieprawidłowy czas źródła');
  const parts = formatter.formatToParts(instant);
  const get = (name: string) => parts.find((part) => part.type === name)?.value;
  const year = get('year'), month = get('month'), day = get('day');
  if (!year || !month || !day) throw new Error('Nie można ustalić dnia');
  return `${year.padStart(4, '0')}-${month}-${day}`;
}
