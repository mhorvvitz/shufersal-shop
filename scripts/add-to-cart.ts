import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { runAddToCart, type AddRequest } from './lib/add-to-cart-core';
import { createFileLogger } from './lib/file-logger';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');

// Debug log so we can investigate why an add did/didn't take effect. Lines go to a
// gitignored logs/add-to-cart.log (appended) and to stderr — never stdout, so the
// RESULT_JSON block stays clean and parseable.
const logFile = path.join(__dirname, '..', 'logs', 'add-to-cart.log');
const log = createFileLogger(logFile);

// Each CLI arg is one requested item: `alias` or `alias=qty`. Quantity is separated
// with `=` so Hebrew names with spaces stay intact. Omit `=qty` to use typicalQuantity.
//   npx tsx scripts/add-to-cart.ts "milk" "pita=3" "חלב 3%"
function parseArgs(argv: string[]): AddRequest[] {
  return argv.map((raw) => {
    const eq = raw.lastIndexOf('=');
    if (eq !== -1) {
      const maybeQty = Number(raw.slice(eq + 1));
      if (!Number.isNaN(maybeQty)) {
        return { query: raw.slice(0, eq).trim(), qty: maybeQty };
      }
    }
    return { query: raw.trim(), qty: null };
  });
}

async function main() {
  if (!fs.existsSync(dictPath)) {
    console.error(
      'No product-dictionary.json found. This file is personal and gitignored, so a fresh ' +
        'checkout starts without it.\n' +
        'Create it before adding items, either by:\n' +
        '  1. npm run build-dictionary -- 20   (scan your order history, then curate the draft), or\n' +
        '  2. cp product-dictionary.sample.json product-dictionary.json   (start from the 10-item sample).',
    );
    process.exit(1);
  }

  const requests = parseArgs(process.argv.slice(2));
  if (requests.length === 0) {
    console.log('Usage: npx tsx scripts/add-to-cart.ts "milk" "pita=3" "eggs"');
    process.exit(1);
  }

  const result = await runAddToCart(requests, dictPath, log);

  console.log('RESULT_JSON_START');
  console.log(JSON.stringify(result, null, 2));
  console.log('RESULT_JSON_END');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
