import { ShufersalBot } from 'shufersal-automation';
import type { CartItemToAdd } from 'shufersal-automation';
import { chunk, bisect } from './chunk';
import {
  readDictionary,
  flagUnavailable,
  summarizeFailure,
  isUnavailable,
  type DictionaryEntry,
} from './dictionary';
import { loadCredentials, loadBrowserConnection } from './browser-connection';

// Bulk adds go through Shufersal's POST /cart/addGrid, which 500s on large
// payloads and 405s under rate-limiting. We therefore add in small chunks,
// pausing between them, and retry/bisect a failing chunk to isolate a bad item.
const MAX_CHUNK = 8; // max items per addToCart call — easy to tune
const CHUNK_DELAY_MS = 1500; // pause between chunks to reduce throttling
const CHUNK_RETRIES = 2; // extra attempts for a failing chunk before bisecting
const RETRY_BACKOFF_MS = 1500; // base backoff between chunk retries (grows linearly)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// One requested item: an alias plus an optional quantity override (null uses
// the dictionary entry's typicalQuantity).
export interface AddRequest {
  query: string;
  qty: number | null;
}

export type Logger = (message: string, data?: unknown) => void;

export const noopLogger: Logger = () => {};

export function findProducts(dictionary: DictionaryEntry[], query: string): DictionaryEntry[] {
  const q = query.toLowerCase().trim();
  return dictionary.filter((entry) => entry.aliases.some((alias) => alias.toLowerCase() === q));
}

/**
 * Matches each request against the dictionary. Pure and side-effect-free, so callers
 * can decide whether a session is even worth creating before calling `executeAdds`.
 */
export function matchAddRequests(
  dictionary: DictionaryEntry[],
  requests: AddRequest[],
): {
  matched: { entry: DictionaryEntry; qty: number }[];
  unmatched: string[];
  ambiguous: { query: string; options: DictionaryEntry[] }[];
} {
  const matched: { entry: DictionaryEntry; qty: number }[] = [];
  const unmatched: string[] = [];
  const ambiguous: { query: string; options: DictionaryEntry[] }[] = [];

  for (const req of requests) {
    const hits = findProducts(dictionary, req.query);
    if (hits.length === 0) {
      unmatched.push(req.query);
    } else if (hits.length > 1) {
      ambiguous.push({ query: req.query, options: hits });
    } else {
      const entry = hits[0]!;
      matched.push({ entry, qty: req.qty ?? entry.typicalQuantity });
    }
  }

  return { matched, unmatched, ambiguous };
}

/**
 * Matches requests against the dictionary, then — if anything matched — logs in and
 * adds them (chunked + retried + verified), flagging genuinely-bad items as
 * unavailable. If nothing matched, returns without ever creating a session, mirroring
 * the CLI runner's original behavior (no point logging in for an empty add).
 */
export async function runAddToCart(
  requests: AddRequest[],
  dictPath: string,
  log: Logger = noopLogger,
): Promise<Record<string, unknown>> {
  const dictionary: DictionaryEntry[] = readDictionary(dictPath);
  const { matched, unmatched, ambiguous } = matchAddRequests(dictionary, requests);

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
    return result;
  }

  log('Run started', {
    matched: matched.map((m) => ({ code: m.entry.id, name: m.entry.name, qty: m.qty })),
    unmatched,
    ambiguous: ambiguous.map((a) => a.query),
  });

  const { username, password } = loadCredentials();
  const bot = new ShufersalBot(loadBrowserConnection());
  const session = await bot.createSession(username, password);

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

    return result;
  } finally {
    await session.close();
    await bot.terminate();
  }
}
