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

const CountdownSchema = z.preprocess(
  (value) => {
    if (value === null) return undefined;
    if (typeof value === 'string' && /^\d{1,3}$/.test(value)) return Number(value);
    return value;
  },
  z.number().int().min(0).max(600).optional(),
);

const LoginResponseSchema = z.object({
  processId: z.string().min(1),
  countdownInSeconds: CountdownSchema,
});

const ProcessSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED']).optional(),
  requiredAction: z.enum(['APP_CONFIRMATION', 'AUTHENTICATOR_VERIFICATION']).nullish(),
  expiresAt: z.union([z.string().max(64), z.number()]).nullish(),
});

const ErrorResponseSchema = z.object({
  errors: z.array(z.object({ errorCode: z.string().max(64) })).min(1),
});

const AccountSchema = z.object({
  securitiesAccountNumber: z.string().min(1).max(100),
});

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

async function mapHttpError(response: Response): Promise<SafeError> {
  if (response.status === 401 || response.status === 403) return new SafeError('AUTH_REQUIRED', 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
  if (response.status === 429) return new SafeError('RATE_LIMITED', 'Zu viele Anfragen. Bitte später erneut versuchen.');

  let errorCode: string | undefined;
  try {
    const parsed = ErrorResponseSchema.safeParse(await safeJson(response));
    errorCode = parsed.success ? parsed.data.errors[0]?.errorCode : undefined;
  } catch {
    // Error bodies are optional and never included in public diagnostics.
  }

  if (errorCode === 'PROCESS_GONE') return new SafeError('LOGIN_TIMEOUT', 'Die Bestätigung ist abgelaufen. Bitte die Anmeldung erneut starten.');
  if (errorCode === 'ALREADY_PROCESSED') return new SafeError('LOGIN_REJECTED', 'Die Anmeldung wurde abgelehnt oder bereits verwendet.');
  if (errorCode === 'NOT_FOUND') return new SafeError('LOGIN_NOT_FOUND', 'Trade Republic kennt diese Anmeldeanfrage nicht mehr.');
  if (errorCode === 'TOO_MANY_REQUESTS') return new SafeError('RATE_LIMITED', 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.');
  if (errorCode === 'VALIDATION_CODE_INVALID') return new SafeError('INVALID_CODE', 'Der Authenticator-Code ist nicht korrekt.');
  if (errorCode === 'VALIDATION_CODE_ALREADY_USED') return new SafeError('INVALID_CODE', 'Der Authenticator-Code wurde bereits verwendet.');
  return new SafeError('UPSTREAM_ERROR', `Trade Republic antwortete mit Status ${response.status}.`);
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
    if (!response.ok) throw await mapHttpError(response);
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
    if (!response.ok) throw await mapHttpError(response);
    const parsed = ProcessSchema.safeParse(await safeJson(response));
    if (!parsed.success) throw new SafeError('LOGIN_CHANGED', 'Der Status der Trade-Republic-Anmeldung hat ein unbekanntes Format.');
    return parsed.data;
  }

  public async waitForConfirmation(processId: string, expiresAt: number, pollIntervalMs = 2_000): Promise<void> {
    while (Date.now() < expiresAt) {
      const process = await this.getProcess(processId);
      if (process.status === 'CONFIRMED' || process.status === 'COMPLETED') return;
      if (process.status !== 'PENDING') {
        throw new SafeError('LOGIN_CHANGED', 'Trade Republic lieferte einen unbekannten Anmeldestatus.');
      }
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(pollIntervalMs, 0), remainingMs)));
    }
    throw new SafeError('LOGIN_TIMEOUT', 'Die Bestätigung ist abgelaufen.');
  }

  public async submitAuthenticator(processId: string, code: string): Promise<void> {
    if (!/^\d{4,8}$/.test(code)) throw new SafeError('INVALID_CODE', 'Der Authenticator-Code hat ein ungültiges Format.');
    const response = await this.request(`/api/v2/auth/web/login/processes/${encodeURIComponent(processId)}/authenticator-verification`, {
      method: 'POST',
      headers: { ...deviceHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) throw await mapHttpError(response);
  }

  public async persist(): Promise<void> {
    const cookieJar = this.jar.serializeSync() as unknown as Record<string, unknown>;
    await saveSession({ version: 1, cookieJar, savedAt: new Date().toISOString() });
  }

  public async refreshSession(): Promise<void> {
    const response = await this.request('/api/v1/auth/web/session', { method: 'GET' });
    if (!response.ok) throw await mapHttpError(response);
  }

  public async getSecuritiesAccountNumber(): Promise<string> {
    const response = await this.request('/api/v2/auth/account', { headers: deviceHeaders() });
    if (!response.ok) throw await mapHttpError(response);
    const parsed = AccountSchema.safeParse(await safeJson(response));
    if (!parsed.success) throw new SafeError('INVALID_RESPONSE', 'Trade Republic lieferte keine Wertpapierkontonummer.');
    return parsed.data.securitiesAccountNumber;
  }
}

function parseExpiry(value: string | number | null | undefined, fallbackSeconds: number): number {
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

export async function getSecuritiesAccountNumber(): Promise<string> {
  const restored = await refreshStoredSession();
  return await new WebAuthClient(restored.jar).getSecuritiesAccountNumber();
}

export { deleteSession };
