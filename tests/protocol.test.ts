import { describe, expect, it } from 'vitest';
import { protocolInternals, subscribe } from '../src/protocol.js';
import { TickerApi } from '../src/schemas.js';

describe('read-only WebSocket boundary', () => {
  it('rejects topic overrides before attempting authentication', async () => {
    await expect(subscribe('ticker', { type: 'simpleCreateOrder' }, TickerApi)).rejects.toMatchObject({ code: 'TOPIC_OVERRIDE' });
  });

  it('parses bounded protocol frames and rejects malformed data', () => {
    expect(protocolInternals.parseFrame(Buffer.from('1 A {"ok":true}'))).toEqual({ id: 1, code: 'A', payload: { ok: true } });
    expect(() => protocolInternals.parseFrame(Buffer.from('not-a-frame'))).toThrow('Ungültige WebSocket-Nachricht');
    expect(() => protocolInternals.parseFrame(Buffer.alloc(1024 * 1024 + 1))).toThrow('zu große Nachricht');
  });
});
