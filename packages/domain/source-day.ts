import { z } from 'zod';
import { dayOfInstant } from './day-zone.ts';

const timestampSchema = z.iso.datetime({ offset: true });

/** Assign an explicitly offset source timestamp to the civil day of the application's day zone. */
export function sourceDay(timestamp: string, zone: string): string {
  if (!timestampSchema.safeParse(timestamp).success) throw new Error('Nieprawidłowy czas źródła');
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) throw new Error('Nieprawidłowy czas źródła');
  return dayOfInstant(instant, zone);
}
