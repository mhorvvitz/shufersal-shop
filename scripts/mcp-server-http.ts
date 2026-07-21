#!/usr/bin/env node
import express, { type Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './lib/mcp-tools';
import { createFileLogger } from './lib/file-logger';
import { bearerAuth } from './lib/http-auth';

// Load credentials from the skill's own .env (see README). On a hosted deployment
// these usually come from the platform's env/secrets instead, which is fine —
// dotenv only fills in vars that aren't already set.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Defaults to the project root; override with SHUFERSAL_DICT_PATH to read from a
// mounted volume in a container (see the deployment docs).
const dictPath =
  process.env.SHUFERSAL_DICT_PATH || path.join(__dirname, '..', 'product-dictionary.json');
const logFile = path.join(__dirname, '..', 'logs', 'add-to-cart.log');
const log = createFileLogger(logFile);

const port = Number(process.env.MCP_HTTP_PORT ?? 3000);
const token = process.env.MCP_AUTH_TOKEN;
if (!token) {
  console.error(
    'MCP_AUTH_TOKEN is not set. Refusing to start an unauthenticated MCP server that can ' +
      'drive a real Shufersal cart. Set MCP_AUTH_TOKEN (see README / .env.example).',
  );
  process.exit(1);
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Liveness probe — unauthenticated so platform health checks can reach it. It says
// nothing about Shufersal connectivity, only that the process is up.
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Everything under /mcp requires the bearer token.
app.use('/mcp', bearerAuth(token));

// Stateless Streamable HTTP: a fresh server + transport per request, fully isolated.
// We don't use server->client streaming, so enableJsonResponse keeps responses plain
// JSON and no session bookkeeping is needed. Cross-request concurrency is still
// serialized at the tool layer (withBrowserLock) so Shufersal logins never overlap.
app.post('/mcp', async (req, res) => {
  const server = buildServer({ dictPath, log });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log('mcp-http request failed', { error: String(err) });
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
});

// Stateless mode has no standalone SSE stream or session to delete.
app.get('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed.'));
app.delete('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed.'));

app.listen(port, () => {
  log(`shufersal-shop MCP server (Streamable HTTP) listening on :${port}`);
});
