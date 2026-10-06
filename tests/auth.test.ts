import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAuthClient } from '../src/auth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Trade Republic v2 authentication', () => {
  it('accepts additional login fields and process metadata without a status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        processId: 'process-1',
        countdownInSeconds: 120,
        serverExtension: { ignored: true },
      }))
      .mockResolvedValueOnce(jsonResponse({
        requiredAction: 'APP_CONFIRMATION',
        expiresAt: null,
        serverExtension: 'ignored',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const startedAt = Date.now();
    const flow = await new WebAuthClient().begin('+491701234567', '1234');

    expect(flow).toMatchObject({ processId: 'process-1', requiredAction: 'APP_CONFIRMATION' });
    expect(flow.expiresAt).toBeGreaterThanOrEqual(startedAt + 119_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes a numeric countdown and tolerates a missing required action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ processId: 'process-2', countdownInSeconds: '60' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'PENDING' }));
    vi.stubGlobal('fetch', fetchMock);

    const startedAt = Date.now();
    const flow = await new WebAuthClient().begin('+491701234567', '1234');

    expect(flow.processId).toBe('process-2');
    expect(flow.requiredAction).toBeUndefined();
    expect(flow.expiresAt).toBeGreaterThanOrEqual(startedAt + 59_000);
  });

  it('polls until the app confirms the login', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'PENDING' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'CONFIRMED' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new WebAuthClient().waitForConfirmation('process-3', Date.now() + 1_000, 0),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown process states instead of storing an ambiguous session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ status: 'APPROVED_BY_UNKNOWN_FLOW' })));

    await expect(
      new WebAuthClient().waitForConfirmation('process-4', Date.now() + 1_000, 0),
    ).rejects.toMatchObject({ code: 'LOGIN_CHANGED' });
  });

  it('maps rejected login processes without exposing response contents', async () => {
    const secretMarker = 'TEST-SECRET-MUST-NOT-LEAK';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
      errors: [{
        errorCode: 'ALREADY_PROCESSED',
        errorMessage: secretMarker,
        meta: { processId: 'private-process-id' },
      }],
    }, 410)));

    let caught: unknown;
    try {
      await new WebAuthClient().getProcess('private-process-id');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'LOGIN_REJECTED' });
    expect(String(caught)).not.toContain(secretMarker);
    expect(String(caught)).not.toContain('private-process-id');
  });
});
