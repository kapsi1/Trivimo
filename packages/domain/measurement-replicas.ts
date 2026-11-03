import type { BodyCandidate } from './body-daily.ts';

export interface SourceMeasurement { id: string; time: number; value: string }

const scaled = (value: string, scale: number) => { const [whole = '0', fraction = ''] = value.split('.'); return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0').slice(0, scale) || '0'); };

/**
 * One weighing can reach the account through several apps (rule google-body-v1, seen on 2026 data: the same weighing
 * from Fitbit and from Google Fit via Health Connect, same second and value). Records within one second whose values
 * differ by less than `tolerance` (a precision-conversion margin) are one measurement with the smallest record id as its
 * identity; records at the same moment with clearly different values cannot be told apart and stay pending (a conflict).
 */
export function mergeReplicas(records: readonly SourceMeasurement[], tolerance: string): { candidates: BodyCandidate[]; replicas: number } {
  const scale = 6; const limit = scaled(tolerance, scale);
  const sorted = [...records].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  const groups: SourceMeasurement[][] = [];
  for (const record of sorted) {
    const group = groups.at(-1);
    if (group && record.time - group[0]!.time <= 1000) group.push(record); else groups.push([record]);
  }
  let replicas = 0;
  const candidates = groups.map((group): BodyCandidate => {
    const values = group.map((record) => scaled(record.value, scale));
    const spread = values.reduce((max, value) => value > max ? value : max) - values.reduce((min, value) => value < min ? value : min);
    const identity = group.map((record) => record.id).sort()[0]!;
    if (spread >= limit) return { identity, value: group[0]!.value, decision: 'pending' };
    replicas += group.length - 1;
    return { identity, value: group.find((record) => record.id === identity)!.value, decision: 'accepted' };
  });
  return { candidates, replicas };
}
