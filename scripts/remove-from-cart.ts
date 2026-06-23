import { ShufersalBot } from 'shufersal-automation';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { readDictionary, type DictionaryEntry } from './lib/dictionary';

// Removing is one call per item (session.removeFromCart sets the line quantity to 0).
// A short pause between calls reduces throttling, mirroring the add runner.
const REMOVE_DELAY_MS = 800;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
}

// The dictionary is optional here: you can remove by raw product code without it. When it
// exists we use it to resolve aliases and to print friendly names for codes.
const dictPath = path.join(__dirname, '..', 'product-dictionary.json');
const dictionary: DictionaryEntry[] = fs.existsSync(dictPath) ? readDictionary(dictPath) : [];

// Debug log mirroring add-to-cart.ts — lines go to a gitignored logs/remove-from-cart.log
// (appended) and to stderr, never stdout, so the RESULT_JSON block stays parseable.
const logFile = path.join(__dirname, '..', 'logs', 'remove-from-cart.log');
function log(message: string, data?: unknown): void {
  const suffix = data === undefined ? '' : ' ' + JSON.stringify(data);
  const line = `[${new Date().toISOString()}] ${message}${suffix}`;
  process.stderr.write(line + '\n');
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  } catch (err) {
    process.stderr.write(`(failed to write log file: ${String(err)})\n`);
  }
}

function findProducts(query: string): DictionaryEntry[] {
  const q = query.toLowerCase().trim();
  return dictionary.filter((entry) => entry.aliases.some((alias) => alias.toLowerCase() === q));
}

// Each CLI arg is one item to remove — either a Shufersal product code ("P_..."), which is
// removed directly, or a dictionary alias, which is resolved to a code the same way the add
// runner matches. Raw codes matter for the "remove everything not on the list" flow, where
// cart items that aren't in the dictionary are known only by their code.
//   npx tsx scripts/remove-from-cart.ts "P_7290120871090" "olive oil" "honey"
interface Target {
  query: string;
  code: string;
  name: string;
  brand: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/remove-from-cart.ts "P_4131074" "olive oil" ...');
    process.exit(1);
  }

  const targets: Target[] = [];
  const unmatched: string[] = [];
  const ambiguous: { query: string; options: { id: string; name: string; brand: string }[] }[] = [];

  for (const raw of args) {
    const arg = raw.trim();
    if (/^P_/.test(arg)) {
      const entry = dictionary.find((e) => e.id === arg);
      targets.push({ query: arg, code: arg, name: entry?.name ?? arg, brand: entry?.brand ?? '' });
      continue;
    }
    const hits = findProducts(arg);
    if (hits.length === 0) {
      unmatched.push(arg);
    } else if (hits.length > 1) {
      ambiguous.push({
        query: arg,
        options: hits.map((o) => ({ id: o.id, name: o.name, brand: o.brand })),
      });
    } else {
      const e = hits[0]!;
      targets.push({ query: arg, code: e.id, name: e.name, brand: e.brand });
    }
  }

  const result: Record<string, unknown> = {
    removed: [],
    notInCart: [],
    unmatched,
    ambiguous,
    cart: null,
  };

  // Nothing resolvable to remove — report unmatched/ambiguous and stop (no login).
  if (targets.length === 0) {
    console.log('RESULT_JSON_START');
    console.log(JSON.stringify(result, null, 2));
    console.log('RESULT_JSON_END');
    return;
  }

  log('Run started', {
    targets: targets.map((t) => ({ code: t.code, name: t.name })),
    unmatched,
    ambiguous: ambiguous.map((a) => a.query),
  });

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);

  try {
    // Snapshot before so we can skip items that aren't there and verify the ones that are.
    const before = await session.getCartItems();
    const beforeCodes = new Set(before.map((c) => c.productCode));
    log('Cart before remove', {
      itemCount: before.length,
      items: before.map((c) => ({ code: c.productCode, qty: c.quantity })),
    });

    const attempted: Target[] = [];
    for (const t of targets) {
      if (!beforeCodes.has(t.code)) {
        (result['notInCart'] as unknown[]).push({ code: t.code, name: t.name, brand: t.brand });
        log('Target not in cart (skipped)', { code: t.code, name: t.name });
        continue;
      }
      try {
        await session.removeFromCart(t.code);
        log('removeFromCart called', { code: t.code, name: t.name });
      } catch (err) {
        // removeFromCart returns void; a throw is rare. The after-snapshot below is the
        // ground truth, so we record the attempt and let verification report the verdict.
        log('removeFromCart threw', { code: t.code, error: String(err) });
      }
      attempted.push(t);
      await sleep(REMOVE_DELAY_MS);
    }

    // Snapshot again and verify each attempted item is actually gone — the ground truth,
    // since removeFromCart returns void and a silent failure shows only as the item staying.
    const after = await session.getCartItems();
    const afterCodes = new Set(after.map((c) => c.productCode));
    log('Cart after remove', {
      itemCount: after.length,
      items: after.map((c) => ({ code: c.productCode, qty: c.quantity })),
    });

    result['removed'] = attempted.map((t) => {
      const removed = !afterCodes.has(t.code);
      const entry = { code: t.code, name: t.name, brand: t.brand, removed };
      log(removed ? 'Item verified removed' : 'Item STILL in cart after remove', entry);
      return entry;
    });

    const total = after.reduce((sum, c) => sum + (c.itemPrice ?? 0), 0);
    result['cart'] = { itemCount: after.length, total: Number(total.toFixed(2)) };
    log('Run finished', { cart: result['cart'] });

    console.log('RESULT_JSON_START');
    console.log(JSON.stringify(result, null, 2));
    console.log('RESULT_JSON_END');
  } finally {
    await session.close();
    await bot.terminate();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
