#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import path from 'path';
import { buildServer } from './lib/mcp-tools';
import { createFileLogger } from './lib/file-logger';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dictPath =
  process.env.SHUFERSAL_DICT_PATH || path.join(__dirname, '..', 'product-dictionary.json');
const logFile = path.join(__dirname, '..', 'logs', 'add-to-cart.log');
const log = createFileLogger(logFile);

const server = buildServer({ dictPath, log });

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stdout is reserved for JSON-RPC; startup failures go to stderr only.
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
