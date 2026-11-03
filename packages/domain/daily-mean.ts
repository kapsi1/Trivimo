/** The caller supplies only accepted measurements already assigned to the same day. */
export interface AcceptedMeasurement {
  identity: string;
  value: string;
}

export type DailyMean =
  | { status: 'missing'; value: null; count: 0 }
  | { status: 'valid'; value: { numerator: string; denominator: string }; count: number };

export class DailyMeanError extends Error {
  constructor(readonly code: 'invalid_value' | 'identity_conflict') { super(code); }
}

function decimal(value: string): { numerator: bigint; scale: number } {
  if (value.length > 512 || !/^\d+(?:\.\d+)?$/.test(value)) throw new DailyMeanError('invalid_value');
  const [whole, fraction = ''] = value.split('.');
  return { numerator: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Repeated identities represent the same accepted measurement, not extra samples. */
export function dailyMean(measurements: readonly AcceptedMeasurement[]): DailyMean {
  const unique = new Map<string, { numerator: bigint; scale: number }>();
  for (const measurement of measurements) {
    if (!measurement.identity.trim()) throw new DailyMeanError('identity_conflict');
    const next = decimal(measurement.value);
    const previous = unique.get(measurement.identity);
    if (previous && previous.numerator * 10n ** BigInt(next.scale) !== next.numerator * 10n ** BigInt(previous.scale)) {
      throw new DailyMeanError('identity_conflict');
    }
    unique.set(measurement.identity, next);
  }
  if (unique.size === 0) return { status: 'missing', value: null, count: 0 };
  const values = [...unique.values()];
  const scale = values.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const numerator = values.reduce((sum, value) => sum + value.numerator * 10n ** BigInt(scale - value.scale), 0n);
  const denominator = BigInt(values.length) * 10n ** BigInt(scale);
  const divisor = gcd(numerator, denominator);
  return { status: 'valid', value: { numerator: (numerator / divisor).toString(), denominator: (denominator / divisor).toString() }, count: values.length };
}
