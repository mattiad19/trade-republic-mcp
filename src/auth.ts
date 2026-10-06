import { createHash } from 'node:crypto';
import os from 'node:os';
import { CookieJar, type SerializedCookieJar } from 'tough-cookie';
import { z } from 'zod';
import { SafeError } from './errors.js';
import { deleteSession, loadSession, saveSession, type StoredSession } from './keychain.js';

const API_ORIGIN = 'https://api.traderepublic.com';
const APP_VERSION = '2.2631.13';
const WEB_PLATFORM = 'web-pro';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36';
const MAX_BODY_BYTES = 1024 * 1024;

const LoginResponseSchema = z.object({
  processId: z.string().min(1),
  countdownInSeconds: z.number().int().positive().optional(),
}).strict();

const ProcessSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED']),
  requiredAction: z.string().optional(),
  expiresAt: z.union([z.string(), z.number()]).optional(),
}).loose();

function fixedUrl(pathname: string): URL {
  if (!pathname.startsWith('/api/')) throw new SafeError('INVALID_ENDPOINT', 'Ungültiger API-Endpunkt.');
  return new URL(pathname, API_ORIGIN);
}

function deviceHeaders(): Record<string, string> {
  const stableDeviceId = createHash('sha512')
    .update([os.hostname(), os.machine(), os.platform()].join('|'))
    .digest('hex');
  const device = {
    stableDeviceId,
    browser: 'Chrome',
    browserVersion: '146.0.0.0',
    os: 'macOS',
    osVersion: os.release(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    screen: '1920x1080x24',
    preferredLanguages: ['de'],
    numberOfCores: os.cpus().length,
  };
  return {
    'X-TR-Device-Info': Buffer.from(JSON.stringify(device)).toString('base64'),
    'X-TR-App-Version': APP_VERSION,
    'X-Tr-Platform': WEB_PLATFORM,
    'Accept-Language': 'de',
    'User-Agent': USER_AGENT,
  };
}

async function safeJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new SafeError('RESPONSE_TOO_LARGE', 'Die Antwort von Trade Republic ist zu groß.');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new SafeError('RESPONSE_TOO_LARGE', 'Die Antwort von Trade Republic ist zu groß.');
  try { return JSON.parse(text) as unknown; } catch { throw new SafeError('INVALID_RESPONSE', 'Trade Republic lieferte eine ungültige Antwort.'); }
}

function mapHttpError(status: number): SafeError {
  if (status === 401 || status === 403) return new SafeError('AUTH_REQUIRED', 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
  if (status === 429) return new SafeError('RATE_LIMITED', 'Zu viele Anfragen. Bitte später erneut versuchen.');
  return new SafeError('UPSTREAM_ERROR', `Trade Republic antwortete mit Status ${status}.`);
}

export class WebAuthClient {
  public constructor(private readonly jar: CookieJar = new CookieJar()) {}

  private async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const url = fixedUrl(pathname);
    const cookie = await this.jar.getCookieString(url.href);
    const headers = new Headers(init.headers);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    for (const value of response.headers.getSetCookie()) await this.jar.setCookie(value, url.href);
    return response;
  }

  public async begin(phoneNumber: string, pin: string): Promise<{ processId: string; requiredAction?: string; expiresAt: number }> {
    const response = await this.request('/api/v2/auth/web/login', {
      method: 'POST',
      headers: { ...deviceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, pin }),
    });
    if (!response.ok) throw mapHttpError(response.status);
    const login = LoginResponseSchema.safeParse(await safeJson(response));
    if (!login.success) throw new SafeError('LOGIN_CHANGED', 'Der Trade-Republic-Anmeldeablauf hat sich geändert.');
    const process = await this.getProcess(login.data.processId);
    const fallbackSeconds = login.data.countdownInSeconds ?? 120;
    return {
      processId: login.data.processId,
      ...(process.requiredAction ? { requiredAction: process.requiredAction } : {}),
      expiresAt: parseExpiry(process.expiresAt, fallbackSeconds),
    };
  }

  public async getProcess(processId: string): Promise<z.infer<typeof ProcessSchema>> {
    const response = await this.request(`/api/v2/auth/web/login/processes/${encodeURIComponent(processId)}`, { headers: deviceHeaders() });
    if (!response.ok) throw mapHttpError(response.status);
    const parsed = ProcessSchema.safeParse(await safeJson(response));
    if (!parsed.success) throw new SafeError('LOGIN_CHANGED', 'Unbekannter Status im Trade-Republic-Anmeldeablauf.');
    return parsed.data;
  }

  public async submitAuthenticator(processId: string, code: string): Promise<void> {
    if (!/^\d{4,8}$/.test(code)) throw new SafeError('INVALID_CODE', 'Der Authenticator-Code hat ein ungültiges Format.');
    const response = await this.request(`/api/v2/auth/web/login/processes/${encodeURIComponent(processId)}/authenticator-verification`, {
      method: 'POST',
      headers: { ...deviceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) throw mapHttpError(response.status);
  }

  public async persist(): Promise<void> {
    const cookieJar = this.jar.serializeSync() as unknown as Record<string, unknown>;
    await saveSession({ version: 1, cookieJar, savedAt: new Date().toISOString() });
  }

  public async refreshSession(): Promise<void> {
    const response = await this.request('/api/v1/auth/web/session', { method: 'GET' });
    if (!response.ok) throw mapHttpError(response.status);
  }
}

function parseExpiry(value: string | number | undefined, fallbackSeconds: number): number {
  if (typeof value === 'number') return value > 1e11 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + Math.min(fallbackSeconds, 180) * 1000;
}

export async function restoreJar(): Promise<{ session: StoredSession; jar: CookieJar } | null> {
  const session = await loadSession();
  if (!session) return null;
  try {
    return { session, jar: CookieJar.deserializeSync(session.cookieJar as unknown as SerializedCookieJar) };
  } catch {
    throw new SafeError('INVALID_SESSION', 'Die gespeicherte Sitzung ist beschädigt. Bitte abmelden und neu anmelden.');
  }
}

export async function authStatus(): Promise<{ authenticated: boolean; savedAt?: string }> {
  const restored = await restoreJar();
  return restored ? { authenticated: true, savedAt: restored.session.savedAt } : { authenticated: false };
}

let refreshPromise: Promise<{ session: StoredSession; jar: CookieJar }> | null = null;

export async function refreshStoredSession(): Promise<{ session: StoredSession; jar: CookieJar }> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const restored = await restoreJar();
    if (!restored) throw new SafeError('AUTH_REQUIRED', 'Bitte zuerst lokal anmelden.');
    const client = new WebAuthClient(restored.jar);
    try {
      await client.refreshSession();
      await client.persist();
    } catch (error) {
      if (error instanceof SafeError && error.code === 'AUTH_REQUIRED') await deleteSession();
      throw error;
    }
    const updated = await restoreJar();
    if (!updated) throw new SafeError('AUTH_REQUIRED', 'Bitte zuerst lokal anmelden.');
    return updated;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export { deleteSession };
