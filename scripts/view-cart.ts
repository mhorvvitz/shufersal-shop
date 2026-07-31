import fs from 'fs';
import path from 'path';
import { requireCredentials } from './lib/env';
import { createBot } from './lib/browser';

// Cart items only carry a productCode, so map codes back to dictionary names/brands.
interface DictionaryEntry { id: string; name: string; brand: string; }
const dictPath = path.join(__dirname, '..', 'product-dictionary.json');
// The cart can still be listed without a dictionary; codes just won't map to names.
const dictionary: DictionaryEntry[] = fs.existsSync(dictPath)
  ? JSON.parse(fs.readFileSync(dictPath, 'utf-8'))
  : [];
const byCode = new Map(dictionary.map((e) => [e.id, e]));

// Importing lib/env loads the skill's own .env (see README).
const { username: USERNAME, password: PASSWORD } = requireCredentials();

// Read-only: lists the current cart contents. Never touches checkout or time slots.
async function main() {
  const browser = await createBot();
  console.error(`Browser: ${browser.description}`);
  const session = await browser.bot.createSession(USERNAME, PASSWORD);

  try {
    const cart = await session.getCartItems();
    const total = cart.reduce((sum, c) => sum + (c.itemPrice ?? 0), 0);

    const result = {
      items: cart.map((c) => {
        const entry = byCode.get(c.productCode);
        return {
          productCode: c.productCode,
          name: entry?.name ?? null,
          brand: entry?.brand ?? null,
          quantity: c.quantity,
          itemPrice: c.itemPrice ?? null,
        };
      }),
      itemCount: cart.length,
      total: Number(total.toFixed(2)),
    };

    console.log('RESULT_JSON_START');
    console.log(JSON.stringify(result, null, 2));
    console.log('RESULT_JSON_END');
  } finally {
    await session.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
