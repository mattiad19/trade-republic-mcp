import { afterEach, describe, expect, it, vi } from 'vitest';
import { audited } from '../src/logger.js';

describe('security logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not log tool inputs or results', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    const secret = 'sensitive-test-value-must-not-appear';
    await audited('test_tool', () => Promise.resolve({ secret }));
    expect(writes.join('')).not.toContain(secret);
    expect(writes.join('')).toContain('test_tool');
  });
});
