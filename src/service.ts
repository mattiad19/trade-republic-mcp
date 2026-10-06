import { subscribe } from './protocol.js';
import {
  CashApi, HistoryApi, InstrumentApi, OrdersApi, PortfolioApi, SearchApi, TickerApi,
} from './schemas.js';

function retrievedAt(): string { return new Date().toISOString(); }

export async function getPortfolio() {
  const raw = await subscribe('compactPortfolio', {}, PortfolioApi);
  return {
    positions: raw.positions.map((item) => ({
      instrumentId: item.instrumentId,
      netSize: item.netSize,
      netValue: item.netValue,
      averageCost: item.averageBuyIn ?? item.unrealisedAverageCost ?? null,
      realisedProfit: item.realisedProfit ?? null,
    })),
    netValue: raw.netValue,
    referenceChangeProfit: raw.referenceChangeProfit ?? null,
    referenceChangeProfitPercent: raw.referenceChangeProfitPercent ?? null,
    unrealisedProfit: raw.unrealisedProfit ?? null,
    unrealisedProfitPercent: raw.unrealisedProfitPercent ?? null,
    unrealisedCost: raw.unrealisedCost ?? null,
    retrievedAt: retrievedAt(),
  };
}

export async function getCashBalance() {
  const raw = await subscribe('cash', {}, CashApi);
  return { availableCash: raw.amount ?? raw.availableCash, currency: raw.currencyId ?? raw.currency ?? null, retrievedAt: retrievedAt() };
}

export async function getOrders() {
  const raw = await subscribe('orders', {}, OrdersApi);
  return { orders: raw.orders, totalCount: raw.orders.length, retrievedAt: retrievedAt() };
}

export async function searchAssets(query: string, limit: number) {
  const raw = await subscribe('neonSearch', { data: { q: query } }, SearchApi);
  return { results: raw.results.slice(0, limit), totalCount: raw.results.length, retrievedAt: retrievedAt() };
}

export async function getAssetInfo(isin: string) {
  const raw = await subscribe('instrument', { id: isin }, InstrumentApi);
  return {
    isin: raw.isin, name: raw.name, shortName: raw.shortName ?? null,
    symbol: raw.intlSymbol ?? raw.homeSymbol ?? null, type: raw.typeId ?? null, wkn: raw.wkn ?? null,
    company: raw.company ? { name: raw.company.name, description: raw.company.description ?? null, country: raw.company.countryOfOrigin ?? null } : null,
    exchanges: raw.exchanges?.map((item) => ({ id: item.exchangeId, name: item.name ?? null })) ?? [],
    tags: raw.tags?.map((item) => item.name) ?? [], retrievedAt: retrievedAt(),
  };
}

export async function getPrice(isin: string, exchange = 'LSX') {
  const raw = await subscribe('ticker', { id: `${isin}.${exchange}` }, TickerApi);
  const spread = raw.ask.price - raw.bid.price;
  const midpoint = (raw.ask.price + raw.bid.price) / 2;
  return {
    isin, exchange, bid: raw.bid.price, ask: raw.ask.price, last: raw.last?.price ?? null,
    spread, spreadPercent: midpoint > 0 ? (spread / midpoint) * 100 : null,
    sourceTimestamp: raw.last?.time ?? null, retrievedAt: retrievedAt(),
  };
}

export async function getOrderBook(isin: string, exchange = 'LSX') {
  const raw = await subscribe('ticker', { id: `${isin}.${exchange}` }, TickerApi);
  return {
    isin, exchange,
    bestBid: { price: raw.bid.price, size: raw.bid.size ?? null },
    bestAsk: { price: raw.ask.price, size: raw.ask.size ?? null },
    sourceTimestamp: raw.last?.time ?? null, retrievedAt: retrievedAt(),
  };
}

export async function getPriceHistory(isin: string, range: string, exchange = 'LSX') {
  const raw = await subscribe('aggregateHistory', { id: `${isin}.${exchange}`, range }, HistoryApi);
  return { isin, exchange, range, candles: raw.aggregates, resolution: raw.resolution ?? null, retrievedAt: retrievedAt() };
}
