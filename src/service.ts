import { subscribe } from './protocol.js';
import { getSecuritiesAccountNumber } from './auth.js';
import {
  CashApi, HistoryApi, InstrumentApi, OrdersApi, PortfolioApi, SearchApi, TickerApi,
} from './schemas.js';

function retrievedAt(): string { return new Date().toISOString(); }

export async function getPortfolio() {
  const securitiesAccountNumber = await getSecuritiesAccountNumber();
  const raw = await subscribe('compactPortfolioByType', { secAccNo: securitiesAccountNumber }, PortfolioApi);
  const sourcePositions = raw.categories.flatMap((category) => category.positions);
  const instrumentResults = await Promise.allSettled(sourcePositions.map(async (item) => {
    const instrument = await subscribe('instrument', { id: item.isin }, InstrumentApi);
    return instrument.exchangeIds?.[0] ?? instrument.exchanges?.[0]?.exchangeId ?? instrument.exchanges?.[0]?.slug ?? 'LSX';
  }));
  const tickerResults = await Promise.allSettled(sourcePositions.map(async (item, index) => {
    const instrumentResult = instrumentResults[index];
    const exchange = instrumentResult?.status === 'fulfilled' ? instrumentResult.value : 'LSX';
    const ticker = await subscribe('ticker', { id: `${item.isin}.${exchange}` }, TickerApi);
    const currentPrice = ticker.last?.price;
    if (currentPrice === undefined) throw new Error('Missing last price');
    const priceFactor = item.bondInfo === null || item.bondInfo === undefined ? 1 : 100;
    return {
      exchange,
      currentPrice: currentPrice / priceFactor,
      sourceTimestamp: ticker.last?.time ?? null,
      netValue: (currentPrice * item.netSize) / priceFactor,
    };
  }));
  const positions = sourcePositions.map((item, index) => {
    const tickerResult = tickerResults[index];
    const quote = tickerResult?.status === 'fulfilled' ? tickerResult.value : null;
    return {
      instrumentId: item.isin,
      name: item.name ?? null,
      netSize: item.netSize,
      netValue: quote?.netValue ?? null,
      currentPrice: quote?.currentPrice ?? null,
      exchange: quote?.exchange ?? null,
      sourceTimestamp: quote?.sourceTimestamp ?? null,
      averageCost: item.averageBuyIn ?? null,
      realisedProfit: item.realisedProfit ?? null,
    };
  });
  const completeValues = positions.every((item) => item.netValue !== null);
  const completeCosts = positions.every((item) => item.averageCost !== null);
  const netValue = completeValues ? positions.reduce((sum, item) => sum + (item.netValue ?? 0), 0) : null;
  const unrealisedCost = completeCosts
    ? sourcePositions.reduce((sum, item) => {
      const priceFactor = item.bondInfo === null || item.bondInfo === undefined ? 1 : 100;
      return sum + ((item.averageBuyIn ?? 0) * item.netSize) / priceFactor;
    }, 0)
    : null;
  const unrealisedProfit = netValue !== null && unrealisedCost !== null ? netValue - unrealisedCost : null;
  return {
    positions,
    netValue,
    valuationComplete: completeValues,
    valuedPositionCount: positions.filter((item) => item.netValue !== null).length,
    totalPositionCount: positions.length,
    referenceChangeProfit: null,
    referenceChangeProfitPercent: null,
    unrealisedProfit,
    unrealisedProfitPercent: unrealisedProfit !== null && unrealisedCost !== null && unrealisedCost !== 0
      ? (unrealisedProfit / unrealisedCost) * 100
      : null,
    unrealisedCost,
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
  const raw = await subscribe('neonSearch', {
    data: { q: query, filter: [{ key: 'type', value: 'stock' }], page: 1, pageSize: limit },
  }, SearchApi);
  return { results: raw.results.slice(0, limit), totalCount: raw.resultCount ?? raw.results.length, retrievedAt: retrievedAt() };
}

export async function getAssetInfo(isin: string) {
  const raw = await subscribe('instrument', { id: isin }, InstrumentApi);
  return {
    isin: raw.isin, name: raw.name, shortName: raw.shortName ?? null,
    symbol: raw.intlSymbol ?? raw.homeSymbol ?? null, type: raw.typeId ?? null, wkn: raw.wkn ?? null,
    company: raw.company ? { name: raw.company.name, description: raw.company.description ?? null, country: raw.company.countryOfOrigin ?? null } : null,
    exchanges: raw.exchanges?.map((item) => ({ id: item.exchangeId ?? item.slug, name: item.name ?? null })) ?? [],
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
  const raw = await subscribe('aggregateHistoryLight', { id: `${isin}.${exchange}`, range }, HistoryApi);
  return { isin, exchange, range, candles: raw.aggregates, resolution: raw.resolution ?? null, retrievedAt: retrievedAt() };
}
