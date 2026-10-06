import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let client: Client | undefined;

afterEach(async () => { await client?.close(); client = undefined; });

describe('stdio MCP integration', () => {
  it('exposes exactly the approved read-only tools', async () => {
    client = new Client({ name: 'integration-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(projectRoot, 'dist/src/server.js')],
      cwd: projectRoot,
      stderr: 'pipe',
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'get_asset_info', 'get_auth_status', 'get_cash_balance', 'get_order_book', 'get_orders',
      'get_portfolio', 'get_price', 'get_price_history', 'search_assets',
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.tools.some((tool) => /place|cancel|modify|transfer/i.test(tool.name))).toBe(false);

    const status = await client.callTool({ name: 'get_auth_status', arguments: {} });
    expect(status.isError).not.toBe(true);
    const forbidden = await client.callTool({ name: 'place_order', arguments: {} }).catch((error: unknown) => error);
    expect(forbidden).toBeTruthy();
  });
});
