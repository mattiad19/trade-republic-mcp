import { describe, expect, it } from 'vitest';
import {
  CashApi, HistoryApi, InstrumentApi, InstrumentInput, PortfolioApi, SearchApi, SearchInput, TickerApi,
} from '../src/schemas.js';

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

  it('accepts the current bounded read response shapes', () => {
    expect(CashApi.parse([{ accountNumber: 'cash-1', currencyId: 'EUR', amount: 10 }])).toMatchObject({ amount: 10 });
    expect(SearchApi.safeParse({
      results: [{ isin: 'DE0007164600', name: 'SAP', tags: [{ id: 'stock', name: 'Aktie', type: 'instrument' }] }],
      resultCount: 1,
    }).success).toBe(true);
    expect(InstrumentApi.safeParse({
      isin: 'DE0007164600', name: 'SAP', exchanges: [{ slug: 'LSX' }], exchangeIds: ['LSX'],
      company: { name: 'SAP', description: null },
    }).success).toBe(true);
    expect(TickerApi.safeParse({
      bid: { price: '10.1', time: 1 }, ask: { price: '10.2', time: 2 }, last: { price: '10.15', time: 3 },
    }).success).toBe(true);
    expect(HistoryApi.safeParse({
      aggregates: [{ time: 1, open: '10', high: '11', low: '9', close: '10.5', volume: 100 }], resolution: 60_000,
    }).success).toBe(true);
    expect(PortfolioApi.safeParse({
      categories: [{ categoryType: 'stocksAndETFs', positions: [{
        isin: 'DE0007164600', netSize: '2', averageBuyIn: '100', bondInfo: null,
      }] }],
    }).success).toBe(true);
  });
});
