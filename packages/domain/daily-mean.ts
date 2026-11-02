/** The caller supplies only accepted measurements already assigned to the same day. */
export interface AcceptedMeasurement {
  identity: string;
  value: number;
}

export type DailyMean =
  | { status: 'missing'; value: null; count: 0 }
  | { status: 'valid'; value: number; count: number };

/** Repeated identities represent the same accepted measurement, not extra samples. */
export function dailyMean(measurements: readonly AcceptedMeasurement[]): DailyMean {
  const unique = new Map<string, number>();
  for (const measurement of measurements) {
    if (!measurement.identity.trim() || !Number.isFinite(measurement.value)) {
      throw new Error('Nieprawidłowy zaakceptowany pomiar');
    }
    if (unique.has(measurement.identity) && unique.get(measurement.identity) !== measurement.value) {
      throw new Error('Sprzeczne wartości tego samego pomiaru');
    }
    unique.set(measurement.identity, measurement.value);
  }
  if (unique.size === 0) return { status: 'missing', value: null, count: 0 };

  // Sort identities to keep the result independent of input and import order.
  const values = [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const mean = values.reduce((sum, [, value]) => sum + value / values.length, 0);
  if (!Number.isFinite(mean)) throw new Error('Wartość poza zakresem obliczeń');
  return { status: 'valid', value: mean, count: values.length };
}
