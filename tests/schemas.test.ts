import { describe, expect, it } from 'vitest';
import { InstrumentInput, SearchInput } from '../src/schemas.js';

describe('public input validation', () => {
  it('rejects extra fields and arbitrary exchanges', () => {
    expect(InstrumentInput.safeParse({ isin: 'DE0007164600', exchange: 'LSX', type: 'simpleCreateOrder' }).success).toBe(false);
    expect(InstrumentInput.safeParse({ isin: 'DE0007164600', exchange: 'ATTACKER' }).success).toBe(false);
  });

  it('rejects malformed identifiers and bounded search abuse', () => {
    expect(InstrumentInput.safeParse({ isin: '../../secret' }).success).toBe(false);
    expect(SearchInput.safeParse({ query: 'x\u0000y', limit: 10 }).success).toBe(false);
    expect(SearchInput.safeParse({ query: 'SAP', limit: 21 }).success).toBe(false);
  });
});
