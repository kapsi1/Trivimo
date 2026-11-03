import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TokenStore {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

const protect = "Add-Type -AssemblyName System.Security; $b = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))";
const unprotect = "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))";

function powershell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const out: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(out).toString('utf8').trim()) : reject(new Error('dpapi_failed')));
    child.stdin.end(input);
  });
}

/** Windows DPAPI, CurrentUser scope: the file is unreadable for other accounts and machines. */
export class DpapiTokenStore implements TokenStore {
  constructor(private readonly path: string) {}
  async load(): Promise<string | null> {
    let encrypted: string;
    try { encrypted = readFileSync(this.path, 'utf8'); } catch { return null; }
    return powershell(unprotect, encrypted);
  }
  async save(value: string): Promise<void> {
    const encrypted = await powershell(protect, value);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
  }
  async clear(): Promise<void> { rmSync(this.path, { force: true }); }
}
