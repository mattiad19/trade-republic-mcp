import { CookieJar } from 'tough-cookie';
import WebSocket, { type RawData } from 'ws';
import { z } from 'zod';
import { refreshStoredSession } from './auth.js';
import { SafeError } from './errors.js';

const API_ORIGIN = 'https://api.traderepublic.com';
const WS_URL = 'wss://api.traderepublic.com';
const MAX_MESSAGE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

export const READ_TOPICS = [
  'compactPortfolio', 'cash', 'orders', 'neonSearch', 'instrument', 'ticker', 'aggregateHistory',
] as const;
export type ReadTopic = (typeof READ_TOPICS)[number];

const allowedTopics = new Set<string>(READ_TOPICS);
let activeRequests = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (activeRequests >= 3) await new Promise<void>((resolve) => waiters.push(resolve));
  activeRequests += 1;
  return () => { activeRequests -= 1; waiters.shift()?.(); };
}

function rawToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function parseFrame(data: RawData): { id: number; code: string; payload: unknown } | null {
  const buffer = rawToBuffer(data);
  if (buffer.length > MAX_MESSAGE_BYTES) throw new SafeError('MESSAGE_TOO_LARGE', 'Trade Republic lieferte eine zu große Nachricht.');
  const text = buffer.toString('utf8');
  if (text === 'connected') return null;
  const match = /^(\d+)\s+([A-Z])(?:\s+([\s\S]*))?$/.exec(text);
  if (!match?.[1] || !match[2]) throw new SafeError('INVALID_MESSAGE', 'Ungültige WebSocket-Nachricht von Trade Republic.');
  let payload: unknown = null;
  if (match[3]) {
    try { payload = JSON.parse(match[3]) as unknown; } catch { throw new SafeError('INVALID_MESSAGE', 'Ungültige JSON-Nachricht von Trade Republic.'); }
  }
  return { id: Number(match[1]), code: match[2], payload };
}

async function cookieHeader(jar: CookieJar): Promise<string> {
  const cookie = await jar.getCookieString(API_ORIGIN);
  if (!cookie) throw new SafeError('AUTH_REQUIRED', 'Keine gültige Sitzung. Bitte zuerst lokal anmelden.');
  return cookie;
}

export async function subscribe<T>(topic: ReadTopic, payload: Readonly<Record<string, unknown>>, schema: z.ZodType<T>): Promise<T> {
  if (!allowedTopics.has(topic)) throw new SafeError('TOPIC_FORBIDDEN', 'Dieser API-Topic ist nicht erlaubt.');
  if (Object.hasOwn(payload, 'type')) throw new SafeError('TOPIC_OVERRIDE', 'Das Feld „type“ ist in Payloads nicht erlaubt.');
  const release = await acquire();
  try {
    const restored = await refreshStoredSession();
    const cookie = await cookieHeader(restored.jar);
    return await new Promise<T>((resolve, reject) => {
      const ws = new WebSocket(WS_URL, {
        headers: { Cookie: cookie },
        handshakeTimeout: 10_000,
        maxPayload: MAX_MESSAGE_BYTES,
        perMessageDeflate: false,
        followRedirects: false,
      });
      let connected = false;
      let settled = false;
      const subscriptionId = 1;
      const finish = (error?: unknown, value?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (ws.readyState === WebSocket.OPEN) ws.close(1000);
        else ws.terminate();
        if (error) reject(error instanceof Error ? error : new SafeError('INTERNAL_ERROR', 'Interner Fehler.'));
        else resolve(value as T);
      };
      const timeout = setTimeout(() => finish(new SafeError('UPSTREAM_TIMEOUT', 'Die Trade-Republic-Anfrage hat zu lange gedauert.')), REQUEST_TIMEOUT_MS);
      ws.once('open', () => {
        ws.send('connect 31 ' + JSON.stringify({
          locale: 'de', platformId: 'webtrading', platformVersion: 'chrome - 146.0.0',
          clientId: 'app.traderepublic.com', clientVersion: '5582',
        }));
      });
      ws.on('message', (data) => {
        try {
          if (!connected && rawToBuffer(data).toString('utf8') === 'connected') {
            connected = true;
            ws.send(`sub ${subscriptionId} ${JSON.stringify({ ...payload, type: topic })}`);
            return;
          }
          const message = parseFrame(data);
          if (!message || message.id !== subscriptionId) return;
          if (message.code === 'E') return finish(new SafeError('UPSTREAM_REJECTED', 'Trade Republic hat die Leseanfrage abgelehnt.'));
          if (message.code !== 'A') return;
          const parsed = schema.safeParse(message.payload);
          if (!parsed.success) return finish(new SafeError('INVALID_RESPONSE', 'Die Antwortstruktur von Trade Republic hat sich geändert.'));
          finish(undefined, parsed.data);
        } catch (error) { finish(error); }
      });
      ws.once('error', () => finish(new SafeError('CONNECTION_FAILED', 'Keine sichere Verbindung zu Trade Republic möglich.')));
      ws.once('close', () => { if (!settled) finish(new SafeError('CONNECTION_CLOSED', 'Die Trade-Republic-Verbindung wurde beendet.')); });
    });
  } finally { release(); }
}

export const protocolInternals = { parseFrame };
