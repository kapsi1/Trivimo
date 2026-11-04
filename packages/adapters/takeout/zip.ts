import { closeSync, createReadStream, createWriteStream, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { dirname, join, relative, sep, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createInflateRaw, crc32 } from 'node:zlib';

/** Limits of what is extracted: the import reads at most 5000 files of 32 MiB, so larger entries are refused up front. */
export const zipLimits = { entries: 5000, entryBytes: 32 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 * 1024, ratio: 1000, centralBytes: 64 * 1024 * 1024 };

export interface ZipEntry { name: string; method: 0 | 8; crc: number; compressedSize: number; size: number; localOffset: number }

function read(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) { const count = readSync(fd, buffer, done, length - done, position + done); if (count === 0) throw new Error('zip_truncated'); done += count; }
  return buffer;
}

/**
 * Safe relative path of an entry, or null for a directory or a name that could escape the target (absolute, drive,
 * `..`, empty or control characters). Backslashes count as separators.
 */
export function safeEntryPath(name: string): string | null {
  if (name.endsWith('/') || name.endsWith('\\')) return null;
  const parts = name.split(/[/\\]/);
  if (/^[a-zA-Z]:/.test(name) || name.startsWith('/') || name.startsWith('\\') || parts.some((part) => part === '' || part === '.' || part === '..' || /[\u0000-\u001f<>:"|?*]/.test(part))) throw new Error('zip_unsafe_path');
  return parts.join(sep);
}

/** Central directory of a ZIP file (ZIP64 included); no entry is extracted. */
export function listZip(path: string): ZipEntry[] {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLength = Math.min(size, 65557);
    const tail = read(fd, size - tailLength, tailLength);
    let eocd = -1;
    for (let at = tail.length - 22; at >= 0; at--) if (tail.readUInt32LE(at) === 0x06054b50) { eocd = at; break; }
    if (eocd < 0) throw new Error('zip_invalid');
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locator = eocd - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw new Error('zip_invalid');
      const record = read(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
      if (record.readUInt32LE(0) !== 0x06064b50) throw new Error('zip_invalid');
      count = Number(record.readBigUInt64LE(32)); cdSize = Number(record.readBigUInt64LE(40)); cdOffset = Number(record.readBigUInt64LE(48));
    }
    if (cdSize > zipLimits.centralBytes || cdOffset + cdSize > size) throw new Error('zip_invalid');
    const cd = read(fd, cdOffset, cdSize), entries: ZipEntry[] = [];
    for (let at = 0, index = 0; index < count; index++) {
      if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) throw new Error('zip_invalid');
      const flags = cd.readUInt16LE(at + 8), method = cd.readUInt16LE(at + 10), crc = cd.readUInt32LE(at + 16);
      let compressedSize = cd.readUInt32LE(at + 20), uncompressed = cd.readUInt32LE(at + 24);
      const nameLength = cd.readUInt16LE(at + 28), extraLength = cd.readUInt16LE(at + 30), commentLength = cd.readUInt16LE(at + 32);
      const mode = cd.readUInt32LE(at + 38) >>> 16;
      let localOffset = cd.readUInt32LE(at + 42);
      const name = cd.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      const extra = cd.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      for (let e = 0; e + 4 <= extra.length;) {
        const id = extra.readUInt16LE(e), length = extra.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let field = e + 4;
          if (uncompressed === 0xffffffff) { uncompressed = Number(extra.readBigUInt64LE(field)); field += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(extra.readBigUInt64LE(field)); field += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(extra.readBigUInt64LE(field)); }
        }
        e += 4 + length;
      }
      at += 46 + nameLength + extraLength + commentLength;
      if ((mode & 0o170000) === 0o120000) throw new Error('zip_symlink');
      if (name.endsWith('/')) continue;
      if (flags & 0x1) throw new Error('zip_encrypted');
      if (method !== 0 && method !== 8) throw new Error('zip_unsupported_method');
      entries.push({ name, method, crc, compressedSize, size: uncompressed, localOffset });
    }
    return entries;
  } finally { closeSync(fd); }
}

/** Entries the Takeout import reads: files under a "Google Health" folder (the rest of the archive is not extracted). */
export const isGoogleHealthEntry = (name: string) => name.split(/[/\\]/).includes('Google Health');

/**
 * Extract the selected entries into `target` (which must be empty or new), refusing unsafe paths, symlinks,
 * oversized or over-compressed entries, and checking each entry's size and CRC-32 while writing.
 * Files are created exclusively, so an existing file is never overwritten.
 */
export async function extractZip(path: string, target: string, select: (name: string) => boolean): Promise<{ files: number; bytes: number }> {
  const entries = listZip(path).filter((entry) => select(entry.name));
  if (entries.length > zipLimits.entries) throw new Error('zip_too_many_entries');
  let total = 0;
  for (const entry of entries) {
    if (entry.size > zipLimits.entryBytes) throw new Error('zip_entry_too_large');
    if (entry.size > 1024 * 1024 && entry.size > entry.compressedSize * zipLimits.ratio) throw new Error('zip_ratio');
    total += entry.size;
  }
  if (total > zipLimits.totalBytes) throw new Error('zip_too_large');
  mkdirSync(target, { recursive: true });
  const fd = openSync(path, 'r');
  try {
    for (const entry of entries) {
      const relativePath = safeEntryPath(entry.name);
      if (!relativePath) continue;
      const destination = join(target, relativePath), inside = relative(target, destination);
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw new Error('zip_unsafe_path');
      const local = read(fd, entry.localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('zip_invalid');
      const start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      mkdirSync(dirname(destination), { recursive: true });
      let written = 0, checksum = 0;
      const check = new Transform({ transform(chunk: Buffer, _encoding, done) {
        written += chunk.length;
        if (written > entry.size) { done(new Error('zip_size_mismatch')); return; }
        checksum = crc32(chunk, checksum); done(null, chunk);
      } });
      const output = createWriteStream(destination, { flags: 'wx' });
      if (entry.compressedSize === 0) { output.end(); await new Promise<void>((resolve, reject) => { output.on('finish', () => resolve()); output.on('error', reject); }); }
      else if (entry.method === 8) await pipeline(createReadStream(path, { start, end: start + entry.compressedSize - 1 }), createInflateRaw(), check, output);
      else await pipeline(createReadStream(path, { start, end: start + entry.compressedSize - 1 }), check, output);
      if (written !== entry.size || (checksum >>> 0) !== entry.crc) throw new Error('zip_checksum');
    }
  } finally { closeSync(fd); }
  return { files: entries.length, bytes: total };
}
