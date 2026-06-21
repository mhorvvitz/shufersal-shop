import { ShufersalBot } from 'shufersal-automation';
import dotenv from 'dotenv';
import path from 'path';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
}

// Read-only product search — used to find a replacement when a dictionary product turns
// out to be unavailable. Never adds to the cart or touches checkout.
//   npx tsx scripts/search.ts "חלב 3%" [limit]
async function main(): Promise<void> {
  const query = process.argv[2];
  const limit = Number(process.argv[3]) || 10;
  if (!query) {
    console.log('Usage: npx tsx scripts/search.ts "<query>" [limit]');
    process.exit(1);
  }

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);
  try {
    const search = await session.searchProducts(query, limit);
    const results = search.results.map((p) => ({
      code: p.code,
      name: p.name,
      brand: p.brand?.name ?? '',
      sellingMethod: p.sellingMethod,
      price: p.price,
      formattedPrice: p.formattedPrice,
      inStock: p.inStock,
      purchasable: p.purchasable,
    }));

    console.log('RESULT_JSON_START');
    console.log(
      JSON.stringify({ query, totalResults: search.totalResults, results }, null, 2),
    );
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
