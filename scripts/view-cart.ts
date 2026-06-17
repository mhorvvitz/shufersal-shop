import { ShufersalBot } from 'shufersal-automation';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Cart items only carry a productCode, so map codes back to dictionary names/brands.
interface DictionaryEntry { id: string; name: string; brand: string; }
const dictPath = path.join(__dirname, '..', 'product-dictionary.json');
const dictionary: DictionaryEntry[] = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
const byCode = new Map(dictionary.map((e) => [e.id, e]));

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
}

// Read-only: lists the current cart contents. Never touches checkout or time slots.
async function main() {
  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);

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
    await bot.terminate();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
