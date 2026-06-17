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

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);

  try {
    await session.addToCart(
      matched.map((m) => ({
        productCode: m.entry.id,
        quantity: m.qty,
        sellingMethod: m.entry.sellingMethod as any,
      })),
    );

    const cart = await session.getCartItems();
    const total = cart.reduce((sum, c) => sum + (c.itemPrice ?? 0), 0);

    result['added'] = matched.map((m) => ({
      name: m.entry.name,
      brand: m.entry.brand,
      qty: m.qty,
    }));
    result['cart'] = {
      itemCount: cart.length,
      total: Number(total.toFixed(2)),
    };

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
