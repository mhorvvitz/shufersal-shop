import fs from 'fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runAddToCart, type AddRequest, type Logger } from './add-to-cart-core';
import { runViewCart } from './view-cart-core';
import { runSearch } from './search-core';
import { runSuggest } from './suggest-core';

// product-dictionary.json is personal and gitignored — a fresh checkout starts
// without it. The two tools that depend on it report this instead of failing oddly.
export const DICTIONARY_MISSING_MESSAGE =
  'No product-dictionary.json found. This file is personal and gitignored, so a fresh ' +
  'checkout starts without it. Create it first: either scan recent orders with the ' +
  'build-dictionary script and curate the draft, or copy product-dictionary.sample.json ' +
  'to product-dictionary.json to start from the 10-item sample.';

// Every tool ultimately drives one headless-Chrome session that logs in to Shufersal.
// Two of those running at once would trip over each other (shared login, shared cart),
// so all tool work is funnelled through a single-flight queue: calls run one at a time,
// in arrival order. A failing call never blocks the queue (the tail always settles).
let tail: Promise<void> = Promise.resolve();
export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(() => fn());
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface BuildServerOptions {
  dictPath: string;
  log: Logger;
  /** Package version, surfaced in the MCP server info. */
  version?: string;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Builds the shufersal-shop MCP server with its four tools registered. Shared by
 * every transport (stdio and Streamable HTTP) so the tool surface — and its safety
 * boundary — is defined in exactly one place.
 *
 * Safety boundary (see SKILL.md): this server only ever wraps cart-management reads
 * and writes. It never registers a tool for createOrder, selectTimeSlot,
 * getAvailableTimeSlots, or anything checkout/payment/billing-related — by
 * construction, those library methods are simply never called from here.
 */
export function buildServer(options: BuildServerOptions): McpServer {
  const { dictPath, log } = options;
  const dictionaryMissing = () => !fs.existsSync(dictPath);

  const server = new McpServer({
    name: 'shufersal-shop',
    version: options.version ?? '1.0.0',
  });

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
      if (dictionaryMissing()) return textResult(DICTIONARY_MISSING_MESSAGE, true);
      const requests: AddRequest[] = items.map((item) => ({
        query: item.query,
        qty: item.qty ?? null,
      }));
      const result = await withBrowserLock(() => runAddToCart(requests, dictPath, log));
      return textResult(JSON.stringify(result, null, 2));
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
      const result = await withBrowserLock(() => runViewCart(dictPath));
      return textResult(JSON.stringify(result, null, 2));
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
      const result = await withBrowserLock(() => runSearch(query, limit ?? 10));
      return textResult(JSON.stringify(result, null, 2));
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
      if (dictionaryMissing()) return textResult(DICTIONARY_MISSING_MESSAGE, true);
      const result = await withBrowserLock(() =>
        runSuggest(dictPath, { refresh, n, ordersToScan: 20 }),
      );
      if (result.noCache) {
        return textResult(
          'No cache found (order-stats.json). Call suggest_restock again with refresh=true to scan order history first.',
          true,
        );
      }
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  return server;
}
