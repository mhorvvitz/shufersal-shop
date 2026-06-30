import fs from 'fs';
import path from 'path';
import type { Logger } from './add-to-cart-core';

/**
 * A logger that writes to stderr and appends to a log file. Never writes to stdout —
 * both the CLI runner and the MCP server (stdio transport) reserve stdout for their
 * own output (RESULT_JSON / JSON-RPC), so debug traces must go elsewhere.
 */
export function createFileLogger(logFile: string): Logger {
  return (message, data) => {
    const suffix = data === undefined ? '' : ' ' + JSON.stringify(data);
    const line = `[${new Date().toISOString()}] ${message}${suffix}`;
    process.stderr.write(line + '\n');
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, line + '\n');
    } catch (err) {
      process.stderr.write(`(failed to write log file: ${String(err)})\n`);
    }
  };
}
