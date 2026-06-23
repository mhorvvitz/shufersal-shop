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

// Read-only product search — one login, one OR many queries. Used to find a product when an
// item isn't in the dictionary (the "unmatched item" flow) or when a saved product turns out
// to be unavailable. Never adds to the cart or touches checkout.
//   npx tsx scripts/search.ts "חלב 3%"
//   npx tsx scripts/search.ts "חלב 3%" 6                       (single query + limit)
//   npx tsx scripts/search.ts --limit 6 "feta cheese" "napkins" "barley"   (batch)
function parseArgs(argv: string[]): { queries: string[]; limit: number } {
  const queries: string[] = [];
  let limit = 10;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--limit') {
      limit = Number(argv[++i]) || limit;
    } else if (/^\d+$/.test(a) && argv.length === 2 && queries.length === 1) {
      // Back-compat: `search.ts "query" 6` — a lone trailing number is the limit.
      limit = Number(a) || limit;
    } else {
      queries.push(a);
    }
  }
  return { queries, limit };
}

async function main(): Promise<void> {
  const { queries, limit } = parseArgs(process.argv.slice(2));
  if (queries.length === 0) {
    console.log('Usage: npx tsx scripts/search.ts [--limit N] "<query>" ["<query2>" ...]');
    process.exit(1);
  }

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);
  try {
    // One login, every query — searching many items one-login-per-query is slow and risks
    // rate-limiting, so the unmatched-item flow can pass them all at once.
    const searches: unknown[] = [];
    for (const query of queries) {
      try {
        const search = await session.searchProducts(query, limit);
        searches.push({
          query,
          totalResults: search.totalResults,
          results: search.results.map((p) => ({
            code: p.code,
            name: p.name,
            brand: p.brand?.name ?? '',
            sellingMethod: p.sellingMethod,
            price: p.price,
            formattedPrice: p.formattedPrice,
            inStock: p.inStock,
            purchasable: p.purchasable,
          })),
        });
      } catch (err) {
        searches.push({ query, error: String(err) });
      }
    }

    console.log('RESULT_JSON_START');
    console.log(JSON.stringify({ searches }, null, 2));
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
