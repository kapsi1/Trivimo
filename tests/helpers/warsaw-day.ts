import { dayBounds } from '../../packages/domain/day-zone.ts';

/** Bounds of a Warsaw day, for tests of the default zone. */
export const warsawDay = (date: string) => dayBounds(date, 'Europe/Warsaw');
