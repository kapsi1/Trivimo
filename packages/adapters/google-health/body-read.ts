import { z } from 'zod';

const responseSchema = z.object({ dataPoints: z.array(z.unknown()).max(100).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();
export type BodyType = 'weight' | 'body-fat';
export interface BodyPage { rawJson: string; records: unknown[]; nextPageToken: string | null }

/** One bounded source page. Results remain unqualified; pagination must be persisted by its caller. */
export async function listBodyPage(input: { type: BodyType; start: string; end: string; pageToken?: string }, accessToken: string, send: typeof fetch = fetch): Promise<BodyPage> {
  const type = z.enum(['weight', 'body-fat']).parse(input.type);
  z.iso.datetime().parse(input.start); z.iso.datetime().parse(input.end);
  if (Date.parse(input.start) >= Date.parse(input.end)) throw new Error('invalid_range');
  if (!accessToken || accessToken.length > 16384 || (input.pageToken !== undefined && (input.pageToken.length === 0 || input.pageToken.length > 8192))) throw new Error('invalid_request');
  const url = new URL(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints`);
  const field = type === 'body-fat' ? 'body_fat' : 'weight';
  url.searchParams.set('filter', `${field}.sample_time.physical_time >= "${input.start}" AND ${field}.sample_time.physical_time < "${input.end}"`);
  url.searchParams.set('pageSize', '100');
  if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
  const response = await send(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`google_http_${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 1048576) throw new Error('response_too_large');
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1048576) throw new Error('response_too_large'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const rawJson = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  const raw = JSON.parse(rawJson) as unknown;
  const parsed = responseSchema.parse(raw);
  return { rawJson, records: parsed.dataPoints ?? [], nextPageToken: parsed.nextPageToken || null };
}
