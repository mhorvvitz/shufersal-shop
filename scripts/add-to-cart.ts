import { ShufersalBot } from 'shufersal-automation';
import type { CartItemToAdd } from 'shufersal-automation';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { chunk, bisect } from './lib/chunk';
import {
  readDictionary,
  flagUnavailable,
  summarizeFailure,
  isUnavailable,
  type DictionaryEntry,
} from './lib/dictionary';

// Bulk adds go through Shufersal's POST /cart/addGrid, which 500s on large
// payloads and 405s under rate-limiting. We therefore add in small chunks,
// pausing between them, and retry/bisect a failing chunk to isolate a bad item.
const MAX_CHUNK = 8; // max items per addToCart call — easy to tune
const CHUNK_DELAY_MS = 1500; // pause between chunks to reduce throttling
const CHUNK_RETRIES = 2; // extra attempts for a failing chunk before bisecting
const RETRY_BACKOFF_MS = 1500; // base backoff between chunk retries (grows linearly)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
}

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');
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
const dictionary: DictionaryEntry[] = readDictionary(dictPath);

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

    // One payload entry per matched item, kept paired so we can report which
    // specific items a failing chunk contained.
    type AddUnit = { match: (typeof matched)[number]; payload: CartItemToAdd };
    const units: AddUnit[] = matched.map((m) => ({
      match: m,
      payload: {
        productCode: m.entry.id,
        quantity: m.qty,
        sellingMethod: m.entry.sellingMethod as any,
      },
    }));

    // Items whose add request kept failing — keyed by product code so the
    // verification pass can attach a reason. Per-item cart verification below
    // remains the ground truth; this only explains a non-verified item.
    const rejected = new Map<string, string>();

    // Codes isolated as genuinely bad this run (failed alone) — flagged unavailable in
    // the dictionary so the suggester stops suggesting them and we can offer a replacement.
    const newlyFlagged = new Map<string, string>(); // code -> short reason
    const today = new Date().toISOString().split('T')[0]!;

    // Add one group in a single addToCart call. On failure, retry with linear
    // backoff; if it still fails, bisect and recurse to isolate the bad item.
    // A single item that keeps failing down to size 1 is marked rejected.
    async function addGroup(group: AddUnit[], label: string): Promise<void> {
      if (group.length === 0) return;
      const codes = group.map((u) => u.payload.productCode);
      const payload = group.map((u) => u.payload);

      let lastErr: unknown;
      for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoff = RETRY_BACKOFF_MS * attempt;
          log(`Chunk ${label} retry ${attempt}/${CHUNK_RETRIES} after backoff`, {
            backoffMs: backoff,
            codes,
          });
          await sleep(backoff);
        }
        try {
          log(`Adding chunk ${label}`, { size: group.length, codes });
          await session.addToCart(payload);
          log(`Chunk ${label} addToCart returned without throwing`, { codes });
          return;
        } catch (err) {
          lastErr = err;
          log(`Chunk ${label} addToCart threw`, { attempt, codes, error: String(err) });
        }
      }

      // Exhausted retries. If this is a single item, it's the genuinely bad one.
      if (group.length === 1) {
        const code = group[0]!.payload.productCode;
        const summary = summarizeFailure(String(lastErr));
        rejected.set(code, `add rejected after retries: ${summary}`);
        // Flag it in the dictionary so it stops being suggested and we can offer a
        // replacement. Mutates only this entry; the in-memory copy is updated too.
        if (flagUnavailable(dictPath, code, summary, today)) {
          newlyFlagged.set(code, summary);
          const entry = dictionary.find((e) => e.id === code);
          if (entry) entry.unavailable = { reason: summary, since: today };
        }
        log(`Chunk ${label} isolated a bad item`, { code, reason: summary });
        return;
      }

      // Otherwise split in half and retry each half to isolate the bad item(s).
      const halves = bisect(group);
      if (!halves) {
        // Unreachable for length > 1, but stay safe.
        for (const u of group) {
          rejected.set(u.payload.productCode, `add rejected after retries: ${String(lastErr)}`);
        }
        return;
      }
      log(`Chunk ${label} still failing — bisecting`, {
        codes,
        left: halves.left.map((u) => u.payload.productCode),
        right: halves.right.map((u) => u.payload.productCode),
      });
      await addGroup(halves.left, `${label}.L`);
      await sleep(CHUNK_DELAY_MS);
      await addGroup(halves.right, `${label}.R`);
    }

    const chunks = chunk(units, MAX_CHUNK);
    log('Adding in chunks', {
      totalItems: units.length,
      maxChunk: MAX_CHUNK,
      chunkCount: chunks.length,
    });
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(CHUNK_DELAY_MS);
      await addGroup(chunks[i]!, `${i + 1}/${chunks.length}`);
    }
    if (rejected.size > 0) {
      log('Some items were rejected by Shufersal', {
        codes: [...rejected.keys()],
      });
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

      // If it isn't in the cart afterward, explain why. A chunk that kept
      // failing through retries+bisect already gives us a concrete reason;
      // otherwise look the product up (out of stock, not purchasable, or a
      // selling-method mismatch).
      if (now === 0 && rejected.has(code)) {
        entry['reason'] = rejected.get(code);
        log('Item NOT verified in cart (add rejected)', entry);
      } else if (now === 0) {
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
    // Matched items that are flagged unavailable — newly isolated this run, or already
    // flagged from a previous run. The skill uses this to offer a replacement search.
    result['unavailable'] = matched
      .filter((m) => newlyFlagged.has(m.entry.id) || isUnavailable(m.entry))
      .map((m) => ({
        code: m.entry.id,
        name: m.entry.name,
        brand: m.entry.brand,
        reason: newlyFlagged.get(m.entry.id) ?? m.entry.unavailable?.reason ?? 'unavailable',
        since: m.entry.unavailable?.since ?? today,
        newlyFlagged: newlyFlagged.has(m.entry.id),
      }));
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
