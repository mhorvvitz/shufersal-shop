import { ShufersalBot } from 'shufersal-automation';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
}

interface DictionaryEntry {
  id: string;
  name: string;
  brand: string;
  typicalQuantity: number;
  sellingMethod: string;
  aliases: string[];
}

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');
const dictionary: DictionaryEntry[] = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));

// Debug log so we can investigate why an add did/didn't take effect. Lines go to a
// gitignored logs/add-to-cart.log (appended) and to stderr — never stdout, so the
// RESULT_JSON block stays clean and parseable.
const logFile = path.join(__dirname, '..', 'logs', 'add-to-cart.log');
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

// Each CLI arg is one requested item: `alias` or `alias=qty`. Quantity is separated
// with `=` so Hebrew names with spaces stay intact. Omit `=qty` to use typicalQuantity.
//   npx tsx scripts/add-to-cart.ts "milk" "pita=3" "חלב 3%"
interface Request {
  query: string;
  qty: number | null;
}

function parseArgs(argv: string[]): Request[] {
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
  const requests = parseArgs(process.argv.slice(2));

  if (requests.length === 0) {
    console.log('Usage: npx tsx scripts/add-to-cart.ts "milk" "pita=3" "eggs"');
    process.exit(1);
  }

  const matched: { entry: DictionaryEntry; qty: number }[] = [];
  const unmatched: string[] = [];
  const ambiguous: { query: string; options: DictionaryEntry[] }[] = [];

  for (const req of requests) {
    const hits = findProducts(req.query);
    if (hits.length === 0) {
      unmatched.push(req.query);
    } else if (hits.length > 1) {
      ambiguous.push({ query: req.query, options: hits });
    } else {
      const entry = hits[0]!;
      matched.push({ entry, qty: req.qty ?? entry.typicalQuantity });
    }
  }

  // Machine-readable result block so the skill can format the reply.
  const result: Record<string, unknown> = {
    added: [],
    unmatched,
    ambiguous: ambiguous.map((a) => ({
      query: a.query,
      options: a.options.map((o) => ({ id: o.id, name: o.name, brand: o.brand })),
    })),
    cart: null,
  };

  if (matched.length === 0) {
    console.log('RESULT_JSON_START');
    console.log(JSON.stringify(result, null, 2));
    console.log('RESULT_JSON_END');
    return;
  }

  log('Run started', {
    matched: matched.map((m) => ({ code: m.entry.id, name: m.entry.name, qty: m.qty })),
    unmatched,
    ambiguous: ambiguous.map((a) => a.query),
  });

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);

  try {
    // Snapshot the cart before adding so we can tell what each add actually changed.
    const before = await session.getCartItems();
    const beforeQty = new Map(before.map((c) => [c.productCode, c.quantity]));
    log('Cart before add', {
      itemCount: before.length,
      items: before.map((c) => ({ code: c.productCode, qty: c.quantity })),
    });

    const payload = matched.map((m) => ({
      productCode: m.entry.id,
      quantity: m.qty,
      sellingMethod: m.entry.sellingMethod as any,
    }));
    log('Calling addToCart with payload', payload);

    try {
      await session.addToCart(payload);
      log('addToCart returned without throwing (note: the library returns void and does not surface the API response)');
    } catch (err) {
      log('addToCart threw', { error: String(err) });
      throw err;
    }

    // Snapshot again and verify each item actually landed. addToCart returns void, so
    // a silent server-side rejection only shows up as the cart being unchanged.
    const cart = await session.getCartItems();
    const afterQty = new Map(cart.map((c) => [c.productCode, c.quantity]));
    log('Cart after add', {
      itemCount: cart.length,
      items: cart.map((c) => ({ code: c.productCode, qty: c.quantity })),
    });

    const verification: unknown[] = [];
    for (const m of matched) {
      const code = m.entry.id;
      const had = beforeQty.get(code) ?? 0;
      const now = afterQty.get(code) ?? 0;
      const entry: Record<string, unknown> = {
        name: m.entry.name,
        brand: m.entry.brand,
        productCode: code,
        requestedQty: m.qty,
        beforeQty: had,
        afterQty: now,
        verified: now > 0, // present in the cart afterward
        changed: now !== had, // this run actually moved the quantity
      };

      // If it isn't in the cart afterward, look the product up to explain why
      // (out of stock, not purchasable, or a selling-method mismatch).
      if (now === 0) {
        try {
          const product = await session.getProductByCode(code);
          if (!product) {
            entry['reason'] = 'product code not found on Shufersal';
          } else {
            entry['reason'] = !product.purchasable
              ? 'not purchasable'
              : !product.inStock
                ? 'out of stock'
                : product.sellingMethod !== (m.entry.sellingMethod as any)
                  ? `selling-method mismatch (dictionary=${m.entry.sellingMethod}, live=${product.sellingMethod})`
                  : 'add silently rejected by Shufersal despite product being available';
            entry['product'] = {
              inStock: product.inStock,
              purchasable: product.purchasable,
              sellingMethod: product.sellingMethod,
              price: product.price,
            };
          }
        } catch (err) {
          entry['reason'] = `lookup failed: ${String(err)}`;
        }
        log('Item NOT verified in cart', entry);
      } else {
        log('Item verified in cart', entry);
      }
      verification.push(entry);
    }

    const total = cart.reduce((sum, c) => sum + (c.itemPrice ?? 0), 0);

    // `added` echoes what was attempted (intent). `verification` is the ground truth —
    // whether each item is actually in the cart afterward, with a reason when it isn't.
    result['added'] = matched.map((m) => ({
      name: m.entry.name,
      brand: m.entry.brand,
      qty: m.qty,
    }));
    result['verification'] = verification;
    result['cart'] = {
      itemCount: cart.length,
      total: Number(total.toFixed(2)),
    };
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
