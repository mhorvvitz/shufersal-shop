#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { runAddToCart, type AddRequest } from './lib/add-to-cart-core';
import { runViewCart } from './lib/view-cart-core';
import { runSearch } from './lib/search-core';
import { runSuggest } from './lib/suggest-core';
import { createFileLogger } from './lib/file-logger';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');
const logFile = path.join(__dirname, '..', 'logs', 'add-to-cart.log');
const log = createFileLogger(logFile);

// product-dictionary.json is personal and gitignored — a fresh checkout starts
// without it. Both tools that depend on it report this instead of failing oddly.
const DICTIONARY_MISSING_MESSAGE =
  'No product-dictionary.json found. This file is personal and gitignored, so a fresh ' +
  'checkout starts without it. Create it first: either scan recent orders with the ' +
  'build-dictionary script and curate the draft, or copy product-dictionary.sample.json ' +
  'to product-dictionary.json to start from the 10-item sample.';

function dictionaryMissing(): boolean {
  return !fs.existsSync(dictPath);
}

const server = new McpServer({
  name: 'shufersal-shop',
  version: '1.0.0',
});

// Safety boundary (see SKILL.md): this server only ever wraps cart-management reads
// and writes. It never registers a tool for createOrder, selectTimeSlot,
// getAvailableTimeSlots, or anything checkout/payment/billing-related — by
// construction, those library methods are simply never called from here.

server.registerTool(
  'add_to_cart',
  {
    title: 'Add to Shufersal cart',
    description:
      'Add grocery items to the Shufersal cart by matching them against the user\'s personal ' +
      'product dictionary (exact brands/products they buy). Never places an order or touches ' +
      'checkout. Items not found in the dictionary are reported as unmatched, not guessed.',
    inputSchema: {
      items: z
        .array(
          z.object({
            query: z
              .string()
              .describe('The product alias/name as requested, e.g. "milk" or "חלב"'),
            qty: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Quantity to add; omit to use the dictionary entry's typicalQuantity"),
          }),
        )
        .min(1)
        .describe('Items to add to the cart'),
    },
  },
  async ({ items }) => {
    if (dictionaryMissing()) {
      return { content: [{ type: 'text' as const, text: DICTIONARY_MISSING_MESSAGE }], isError: true };
    }
    const requests: AddRequest[] = items.map((item) => ({
      query: item.query,
      qty: item.qty ?? null,
    }));
    const result = await runAddToCart(requests, dictPath, log);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  'view_cart',
  {
    title: 'View Shufersal cart',
    description:
      'Read-only: shows what is currently in the Shufersal cart (items, quantities, prices, ' +
      'total). Never modifies the cart and never touches checkout or delivery slots.',
  },
  async () => {
    const result = await runViewCart(dictPath);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  'search_products',
  {
    title: 'Search Shufersal products',
    description:
      'Read-only product search on Shufersal. Use it to find a replacement when a dictionary ' +
      'product is flagged unavailable, or to look up a product the user mentions that is not ' +
      'in their dictionary. Never adds anything to the cart.',
    inputSchema: {
      query: z.string().describe('Hebrew or English search text, e.g. "חלב 3%"'),
      limit: z.number().int().positive().max(50).optional().describe('Max results (default 10)'),
    },
  },
  async ({ query, limit }) => {
    const result = await runSearch(query, limit ?? 10);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  'suggest_restock',
  {
    title: 'Suggest what to restock',
    description:
      'Suggests grocery items the user is due to restock, ranked by how often they buy each ' +
      'item and how overdue it is, based on their cached order-history scan. Set refresh=true ' +
      'to re-scan order history first (one login) — needed the first time, or when the cache ' +
      'is missing/stale.',
    inputSchema: {
      refresh: z
        .boolean()
        .optional()
        .describe('Re-scan order history before suggesting (one login to Shufersal)'),
      n: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max number of suggestions (default: the median order size)'),
    },
  },
  async ({ refresh, n }) => {
    if (dictionaryMissing()) {
      return { content: [{ type: 'text' as const, text: DICTIONARY_MISSING_MESSAGE }], isError: true };
    }
    const result = await runSuggest(dictPath, { refresh, n, ordersToScan: 20 });
    if (result.noCache) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No cache found (order-stats.json). Call suggest_restock again with refresh=true to scan order history first.',
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stdout is reserved for JSON-RPC; startup failures go to stderr only.
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
