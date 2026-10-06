import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SafeError } from './errors.js';

const SessionSchema = z.object({
  version: z.literal(1),
  cookieJar: z.record(z.string(), z.unknown()),
  savedAt: z.iso.datetime(),
});

export type StoredSession = z.infer<typeof SessionSchema>;

export function helperPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.dirname(currentDir);
  const projectRoot = path.basename(parentDir) === 'dist' ? path.dirname(parentDir) : parentDir;
  return path.join(projectRoot, 'bin', 'tr-keychain-helper');
}

async function run(operation: 'get' | 'set' | 'delete', input?: string): Promise<string> {
  const executable = helperPath();
  try {
    await access(executable);
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, [operation], { stdio: ['pipe', 'pipe', 'pipe'] });
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      let outputSize = 0;
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
      child.stdout.on('data', (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > 2 * 1024 * 1024) child.kill('SIGKILL');
        else output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(Buffer.concat(output).toString('utf8'));
        else reject(new Error(Buffer.concat(errors).toString('utf8')));
      });
      child.stdin.end(input);
    });
  } catch {
    throw new SafeError('KEYCHAIN_UNAVAILABLE', 'Der macOS-Schlüsselbund ist nicht verfügbar oder gesperrt.');
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await run('get');
  if (!raw) return null;
  let json: unknown;
  try { json = JSON.parse(raw) as unknown; } catch { json = null; }
  const parsed = SessionSchema.safeParse(json);
  if (!parsed.success) throw new SafeError('INVALID_SESSION', 'Die gespeicherte Sitzung ist ungültig. Bitte neu anmelden.');
  return parsed.data;
}

export async function saveSession(session: StoredSession): Promise<void> {
  const validated = SessionSchema.parse(session);
  await run('set', JSON.stringify(validated));
}

export async function deleteSession(): Promise<void> {
  await run('delete');
}
