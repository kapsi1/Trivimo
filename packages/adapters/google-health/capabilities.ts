import { dailySummaryTypes } from './daily-summary.ts';

/**
 * Capability registry of Health API v4 data types. Source: https://developers.google.com/health/data-types,
 * read 2026-11-06 (category, operations, scope). It states what the catalog documents, not what an account allows:
 * an empty result is not "unsupported", and a documented operation is not a confirmed one for this account.
 * Fields and filters per type are confirmed separately when the type gets a reader.
 */
export type Operation = 'list' | 'get' | 'reconcile' | 'rollUp' | 'dailyRollUp' | 'create' | 'update' | 'batchDelete';
export type Category = 'sample' | 'interval' | 'daily' | 'session' | 'food';
export type ScopeGroup = 'activity' | 'health-metrics' | 'nutrition' | 'reproductive' | 'mindfulness' | 'logged-symptoms' | 'sleep' | 'ecg' | 'irn';
/** `read-implemented`: adapter + saved originals exist; `readable-pending`: documented read, no reader yet; `write-only`: no read operation documented. */
export type Support = 'read-implemented' | 'readable-pending' | 'write-only';
export interface DataTypeCapability { id: string; category: Category; operations: readonly Operation[]; scope: ScopeGroup; beta: boolean }

const R: readonly Operation[] = ['list', 'reconcile', 'rollUp', 'dailyRollUp'];
const W: readonly Operation[] = ['create', 'update', 'batchDelete'];
const cap = (id: string, category: Category, operations: readonly Operation[], scope: ScopeGroup, beta = false): DataTypeCapability => ({ id, category, operations, scope, beta });

export const catalogCheckedAt = '2026-11-06';
export const dataTypeCapabilities: readonly DataTypeCapability[] = [
  cap('active-energy-burned', 'interval', R, 'activity'), cap('active-minutes', 'interval', R, 'activity'), cap('active-zone-minutes', 'interval', R, 'activity'),
  cap('activity-level', 'interval', ['list', 'reconcile'], 'activity'), cap('altitude', 'interval', R, 'activity'),
  cap('blood-glucose', 'sample', ['list', 'get', 'reconcile', 'rollUp', 'dailyRollUp'], 'health-metrics'),
  cap('body-fat', 'sample', ['list', 'get', 'reconcile', 'rollUp', 'dailyRollUp', ...W], 'health-metrics'),
  cap('calories-in-heart-rate-zone', 'interval', ['rollUp', 'dailyRollUp'], 'activity'),
  cap('core-body-temperature', 'sample', ['list', 'get', 'reconcile', 'rollUp', 'dailyRollUp'], 'health-metrics'),
  cap('daily-heart-rate-variability', 'daily', ['list', 'reconcile'], 'health-metrics'), cap('daily-heart-rate-zones', 'daily', ['list', 'reconcile'], 'health-metrics'),
  cap('daily-oxygen-saturation', 'daily', ['list', 'reconcile'], 'health-metrics'), cap('daily-respiratory-rate', 'daily', ['list', 'reconcile'], 'health-metrics'),
  cap('daily-resting-heart-rate', 'daily', ['list', 'reconcile'], 'health-metrics'), cap('daily-sleep-temperature-derivations', 'daily', ['list', 'reconcile'], 'health-metrics'),
  cap('daily-vo2-max', 'daily', ['list', 'reconcile'], 'activity'),
  cap('distance', 'interval', R, 'activity'), cap('electrocardiogram', 'session', ['list'], 'ecg'),
  cap('exercise', 'session', ['list', 'get', 'reconcile', ...W], 'activity'), cap('floors', 'interval', ['reconcile', 'rollUp', 'dailyRollUp'], 'activity'),
  cap('food', 'food', ['list', 'get'], 'nutrition'), cap('food-measurement-unit', 'food', ['list', 'get'], 'nutrition'),
  cap('heart-rate', 'sample', R, 'health-metrics'), cap('heart-rate-variability', 'sample', ['list', 'reconcile'], 'health-metrics'),
  cap('height', 'sample', ['list', 'get', 'reconcile', ...W], 'health-metrics'),
  cap('hydration-log', 'session', ['list', 'get', 'reconcile', 'rollUp', 'dailyRollUp', ...W], 'nutrition'),
  cap('irregular-rhythm-notification', 'session', ['list'], 'irn'), cap('menstrual-period', 'interval', W, 'reproductive'), cap('moods', 'sample', W, 'mindfulness'),
  cap('nutrition-log', 'session', ['list', 'get', 'reconcile', 'rollUp', 'dailyRollUp', ...W], 'nutrition'),
  cap('ovulation-test', 'sample', W, 'reproductive'), cap('oxygen-saturation', 'sample', ['list', 'reconcile'], 'health-metrics'),
  cap('respiratory-rate-sleep-summary', 'sample', ['list', 'reconcile'], 'health-metrics'), cap('run-vo2-max', 'sample', R, 'activity'),
  cap('sedentary-period', 'interval', R, 'activity'), cap('skin-temperature-sensors', 'sample', ['list'], 'health-metrics', true),
  cap('sleep', 'session', ['list', 'get', 'reconcile', ...W], 'sleep'), cap('steps', 'interval', R, 'activity'),
  cap('swim-lengths-data', 'interval', R, 'activity'), cap('symptoms', 'sample', W, 'logged-symptoms'),
  cap('time-in-heart-rate-zone', 'interval', R, 'activity'), cap('total-calories', 'interval', ['rollUp', 'dailyRollUp'], 'activity'),
  cap('vo2-max', 'sample', ['list', 'reconcile'], 'activity'), cap('weight', 'sample', ['list', 'get', 'reconcile', 'rollUp', 'dailyRollUp', ...W], 'health-metrics'),
];

/** Kinds with a saved-original reader today (the six M1 metrics' sources plus the daily summaries); extend with each new reader. */
const implemented = new Set<string>(['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate', ...dailySummaryTypes]);
const readOps: readonly Operation[] = ['list', 'get', 'rollUp', 'dailyRollUp', 'reconcile'];
export function supportOf(capability: DataTypeCapability): Support {
  if (implemented.has(capability.id)) return 'read-implemented';
  return capability.operations.some((operation) => readOps.includes(operation)) ? 'readable-pending' : 'write-only';
}
