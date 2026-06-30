import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { runSuggest, type SuggestOptions } from './lib/suggest-core';

// Load credentials from the skill's own .env (see README). Only needed for --refresh.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');

function parseArgs(argv: string[]): SuggestOptions {
  let refresh = false;
  let n: number | undefined;
  for (const raw of argv) {
    if (raw === '--refresh') {
      refresh = true;
      continue;
    }
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) {
      // First positional number is N (how many suggestions). We keep the
      // default orders-to-scan at 20; N is the only positional argument.
      n = Math.floor(num);
    }
  }
  return { refresh, n, ordersToScan: 20 };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  // Dictionary is a precondition; never create one implicitly.
  if (!fs.existsSync(dictPath)) {
    console.error(
      'No product-dictionary.json found. This file is personal and gitignored, so a fresh ' +
        'checkout starts without it.\n' +
        'Create it before suggesting, either by:\n' +
        '  1. npm run build-dictionary -- 20   (scan your order history, then curate the draft), or\n' +
        '  2. cp product-dictionary.sample.json product-dictionary.json   (start from the 10-item sample).',
    );
    process.exit(1);
  }

  run(options).catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}

async function run(options: SuggestOptions): Promise<void> {
  const result = await runSuggest(dictPath, options);

  if (result.noCache) {
    console.log(
      'No cache found (order-stats.json). Run with --refresh to scan your order history first:\n' +
        '  npx tsx scripts/suggest.ts --refresh',
    );
    return;
  }

  console.log('RESULT_JSON_START');
  console.log(JSON.stringify(result, null, 2));
  console.log('RESULT_JSON_END');
}

main();
