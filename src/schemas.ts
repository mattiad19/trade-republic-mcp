import { z } from 'zod';

const finiteNumber = z.union([z.number(), z.string()]).transform((value, context) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    context.addIssue({ code: 'custom', message: 'Expected a finite number' });
    return z.NEVER;
  }
  return number;
});

export const EmptyInput = z.object({}).strict();
export const Isin = z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, 'Ungültige ISIN');
export const Exchange = z.literal('LSX').default('LSX');
export const InstrumentInput = z.object({ isin: Isin, exchange: Exchange.optional() }).strict();
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
export const SearchInput = z.object({
  query: z.string().trim().min(1).max(100).refine(
    (value) => !hasControlCharacter(value),
    'Steuerzeichen sind nicht erlaubt',
  ),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();
export const AssetInfoInput = z.object({ isin: Isin }).strict();
export const PriceHistoryInput = z.object({
  isin: Isin,
  exchange: Exchange.optional(),
  range: z.enum(['1d', '5d', '1m', '3m', '6m', '1y', '5y', 'max']),
}).strict();

const position = z.object({
  instrumentId: z.string().max(100),
  netSize: finiteNumber,
  netValue: finiteNumber,
  averageBuyIn: finiteNumber.optional(),
  unrealisedAverageCost: finiteNumber.optional(),
  realisedProfit: finiteNumber.optional(),
}).loose();
export const PortfolioApi = z.object({
  positions: z.array(position).max(10_000),
  netValue: finiteNumber,
  referenceChangeProfit: finiteNumber.optional(),
  referenceChangeProfitPercent: finiteNumber.optional(),
  unrealisedProfit: finiteNumber.optional(),
  unrealisedProfitPercent: finiteNumber.optional(),
  unrealisedCost: finiteNumber.optional(),
}).loose();

export const CashApi = z.object({
  amount: finiteNumber.optional(), availableCash: finiteNumber.optional(),
  currencyId: z.string().max(10).optional(), currency: z.string().max(10).optional(),
}).loose().refine((value) => value.amount !== undefined || value.availableCash !== undefined);

const quote = z.object({ price: finiteNumber, size: finiteNumber.optional(), time: z.string().max(100).optional() }).loose();
export const TickerApi = z.object({ bid: quote, ask: quote, last: quote.optional() }).loose();
export const HistoryApi = z.object({
  aggregates: z.array(z.object({
    time: z.number(), open: finiteNumber, high: finiteNumber, low: finiteNumber,
    close: finiteNumber, volume: finiteNumber.optional(),
  }).loose()).max(20_000),
  resolution: z.number().optional(),
}).loose();
export const SearchApi = z.object({
  results: z.array(z.object({
    isin: z.string().max(20), name: z.string().max(500), type: z.string().max(100).optional(),
    tags: z.array(z.string().max(100)).max(100).optional(),
  }).loose()).max(5_000),
}).loose();
export const InstrumentApi = z.object({
  isin: z.string().max(20), name: z.string().max(500), shortName: z.string().max(500).optional(),
  intlSymbol: z.string().max(50).optional(), homeSymbol: z.string().max(50).optional(),
  typeId: z.string().max(100).optional(), wkn: z.string().max(20).optional(),
  company: z.object({
    name: z.string().max(500), description: z.string().max(20_000).optional(), countryOfOrigin: z.string().max(100).optional(),
  }).loose().optional(),
  exchanges: z.array(z.object({ exchangeId: z.string().max(50), name: z.string().max(200).optional() }).loose()).max(100).optional(),
  tags: z.array(z.object({ id: z.string().max(100), name: z.string().max(100) }).loose()).max(100).optional(),
}).loose();

export const OrdersApi = z.union([
  z.object({ orders: z.array(z.record(z.string(), z.unknown())).max(10_000) }).loose(),
  z.array(z.record(z.string(), z.unknown())).max(10_000).transform((orders) => ({ orders })),
]);
