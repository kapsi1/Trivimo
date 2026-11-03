import { z } from 'zod';

export interface SourceIdentityInput {
  provider: string;
  account: string;
  type: string;
  originalId: string | null;
  timestamp: string | null;
  origin: string | null;
}

export type SourceIdentity =
  | { status: 'identified'; version: 1; key: string }
  | { status: 'candidate'; version: 1; key: string }
  | { status: 'unresolved'; reason: 'missing_source' | 'missing_identity_evidence' };

/** Fallback keys are candidates only; matching or accepting them requires separate evidence. */
export function sourceIdentity(input: SourceIdentityInput): SourceIdentity {
  if (![input.provider, input.account, input.type].every((part) => part.trim().length > 0)) return { status: 'unresolved', reason: 'missing_source' };
  const scope = [input.provider, input.account, input.type];
  if (input.originalId?.trim()) return { status: 'identified', version: 1, key: JSON.stringify([...scope, 'id', input.originalId]) };
  if (!input.timestamp || !z.iso.datetime({ offset: true }).safeParse(input.timestamp).success || !input.origin?.trim()) return { status: 'unresolved', reason: 'missing_identity_evidence' };
  return { status: 'candidate', version: 1, key: JSON.stringify([...scope, 'timestamp-origin', input.timestamp, input.origin]) };
}
