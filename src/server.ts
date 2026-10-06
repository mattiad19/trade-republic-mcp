#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { authStatus } from './auth.js';
import { publicError } from './errors.js';
import { audited, log } from './logger.js';
import { AssetInfoInput, EmptyInput, InstrumentInput, PriceHistoryInput, SearchInput } from './schemas.js';
import {
  getAssetInfo, getCashBalance, getOrderBook, getOrders, getPortfolio, getPrice,
  getPriceHistory, searchAssets,
} from './service.js';

const OutputShape = { result: z.unknown() };
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function success(result: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: { result },
  };
}

function failure(error: unknown): CallToolResult {
  const safe = publicError(error);
  return {
    content: [{ type: 'text', text: JSON.stringify(safe) }],
    structuredContent: { result: safe },
    isError: true,
  };
}

function run(tool: string, action: () => Promise<unknown>): Promise<CallToolResult> {
  return audited(tool, action).then(success, failure);
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'trade-republic-readonly', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.registerTool('get_auth_status', {
    title: 'Trade Republic: Anmeldestatus',
    description: 'Zeigt ausschließlich, ob lokal eine Sitzung im macOS-Schlüsselbund gespeichert ist.',
    inputSchema: EmptyInput.shape, outputSchema: OutputShape, annotations,
  }, () => run('get_auth_status', authStatus));

  server.registerTool('get_portfolio', {
    title: 'Trade Republic: Depot', description: 'Liest Depotpositionen und Depotwert. Führt keine Transaktion aus.',
    inputSchema: EmptyInput.shape, outputSchema: OutputShape, annotations,
  }, () => run('get_portfolio', getPortfolio));

  server.registerTool('get_cash_balance', {
    title: 'Trade Republic: Guthaben', description: 'Liest das verfügbare Guthaben. Führt keine Transaktion aus.',
    inputSchema: EmptyInput.shape, outputSchema: OutputShape, annotations,
  }, () => run('get_cash_balance', getCashBalance));

  server.registerTool('get_orders', {
    title: 'Trade Republic: Orders', description: 'Liest bestehende und historische Orders. Kann Orders weder ändern noch stornieren.',
    inputSchema: EmptyInput.shape, outputSchema: OutputShape, annotations,
  }, () => run('get_orders', getOrders));

  server.registerTool('search_assets', {
    title: 'Trade Republic: Wertpapiere suchen', description: 'Sucht Wertpapiere nach Name oder Symbol; maximal 20 Ergebnisse.',
    inputSchema: SearchInput.shape, outputSchema: OutputShape, annotations,
  }, ({ query, limit }) => run('search_assets', () => searchAssets(query, limit)));

  server.registerTool('get_asset_info', {
    title: 'Trade Republic: Wertpapierdetails', description: 'Liest Stammdaten zu einer validierten ISIN.',
    inputSchema: AssetInfoInput.shape, outputSchema: OutputShape, annotations,
  }, ({ isin }) => run('get_asset_info', () => getAssetInfo(isin)));

  server.registerTool('get_price', {
    title: 'Trade Republic: Kurs', description: 'Liest Geld-, Brief- und gegebenenfalls letzten Kurs. Ein Geldkurs beweist nicht, dass der Markt geöffnet ist.',
    inputSchema: InstrumentInput.shape, outputSchema: OutputShape, annotations,
  }, ({ isin, exchange }) => run('get_price', () => getPrice(isin, exchange)));

  server.registerTool('get_price_history', {
    title: 'Trade Republic: Kurshistorie', description: 'Liest historische OHLCV-Kerzen für einen begrenzten Zeitraum.',
    inputSchema: PriceHistoryInput.shape, outputSchema: OutputShape, annotations,
  }, ({ isin, range, exchange }) => run('get_price_history', () => getPriceHistory(isin, range, exchange)));

  server.registerTool('get_order_book', {
    title: 'Trade Republic: Bestes Geld/Brief', description: 'Liest ausschließlich das beste verfügbare Geld- und Briefangebot, kein vollständiges Orderbuch.',
    inputSchema: InstrumentInput.shape, outputSchema: OutputShape, annotations,
  }, ({ isin, exchange }) => run('get_order_book', () => getOrderBook(isin, exchange)));

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  const shutdown = (): void => { void server.close().finally(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await server.connect(transport);
  log('info', 'server.started', { transport: 'stdio', mode: 'read-only' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    log('error', 'server.failed', { outcome: 'startup_error' });
    process.exit(1);
  });
}
