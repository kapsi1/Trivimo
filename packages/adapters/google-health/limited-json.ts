/** Reads a response body as UTF-8 text, refusing anything above `limit` bytes. */
export async function readLimitedText(response: Response, limit = 1048576): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) throw new Error('response_too_large');
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) throw new Error('response_too_large'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
