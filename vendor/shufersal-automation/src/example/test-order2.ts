import { ShufersalBot } from '~/index';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set');
}

interface DictionaryEntry {
  id: string;
  name: string;
  brand: string;
  typicalQuantity: number;
  sellingMethod: string;
  aliases: string[];
}

const dictPath = path.join(__dirname, '..', '..', '..', 'shufersal-cart-skill', 'product-dictionary.json');
const dictionary: DictionaryEntry[] = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));

function findProduct(query: string): DictionaryEntry | null {
  const q = query.toLowerCase().trim();
  return dictionary.find((entry) =>
    entry.aliases.some((alias) => alias.toLowerCase() === q)
  ) ?? null;
}

const requests = [
  { query: 'potatoes', qty: null },
  { query: 'red pepper', qty: null },
  { query: 'yellow pepper', qty: null },
  { query: 'bread', qty: null },
  { query: 'wraps', qty: null },
  { query: 'hummus', qty: null },
  { query: 'cream cheese', qty: null },
  { query: 'olive oil', qty: null },
  { query: 'apples', qty: null },
  { query: 'milk', qty: null },
];

async function main() {
  const matched: { entry: DictionaryEntry; qty: number; request: string }[] = [];
  const unmatched: string[] = [];

  console.log('=== Dictionary Lookup ===\n');
  for (const req of requests) {
    const entry = findProduct(req.query);
    if (entry) {
      const qty = req.qty ?? entry.typicalQuantity;
      console.log(`  ✓ ${req.query} -> ${entry.name} (${entry.brand}), qty: ${qty}`);
      matched.push({ entry, qty, request: req.query });
    } else {
      console.log(`  ✗ ${req.query} -> NOT FOUND`);
      unmatched.push(req.query);
    }
  }

  if (unmatched.length > 0) {
    console.log(`\n--- Not in dictionary (add manually) ---`);
    unmatched.forEach((u) => console.log(`  - ${u}`));
  }

  if (matched.length === 0) {
    console.log('\nNo products matched.');
    return;
  }

  console.log(`\n=== Adding ${matched.length} items to cart ===\n`);

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: false });
  const session = await bot.createSession(USERNAME, PASSWORD);

  try {
    await session.addToCart(
      matched.map((m) => ({
        productCode: m.entry.id,
        quantity: m.qty,
        sellingMethod: m.entry.sellingMethod as any,
      })),
    );

    const cart = await session.getCartItems();
    console.log(`Cart has ${cart.length} item(s):`);
    cart.forEach((c) => {
      console.log(`  - ${c.productCode}: qty ${c.quantity}`);
    });

    console.log('\nBrowser left open. Press Ctrl+C to close.');
    await new Promise(() => {});
  } catch (err) {
    console.error('Error:', err);
    await session.close();
    await bot.terminate();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
