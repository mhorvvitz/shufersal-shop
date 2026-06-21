import { ShufersalBot } from 'shufersal-automation';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  scanOrderHistory,
  writeCache,
  seedAliases,
  mostCommonQuantity,
  todayISO,
} from './lib/order-stats';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
}

// How many past orders to scan. Override with: npx tsx scripts/build-dictionary.ts 30
const ORDERS_TO_SCAN = Number(process.argv[2]) || 20;

interface DraftEntry {
  id: string;
  name: string;
  brand: string;
  sellingMethod: string;
  typicalQuantity: number;
  timesOrdered: number;
  lastOrderDate: string;
  aliases: string[];
}

async function main() {
  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME!, PASSWORD!);

  try {
    console.log('Fetching order history...');
    // Shared scan path: also used by suggest.ts. Returns per-product stats.
    const { stats, scannedOrders, medianOrderSize } = await scanOrderHistory(
      session,
      ORDERS_TO_SCAN,
    );
    console.log(`Scanned ${scannedOrders} orders...\n`);

    // Building the dictionary also warms the suggester cache.
    writeCache(stats, { scannedOrders, medianOrderSize, generatedAt: todayISO() });

    // Seed aliases from the Hebrew name + brand words. These are a STARTING POINT —
    // curate product-dictionary.json by hand to add English names and casual terms.
    // lastOrderDate mirrors the original builder: the first-scanned order containing
    // the item (orders are scanned newest-first, so that's the most recent purchase).
    const draft: DraftEntry[] = stats
      .map((p) => ({
        id: p.code,
        name: p.name,
        brand: p.brand,
        sellingMethod: p.sellingMethod,
        typicalQuantity: mostCommonQuantity(p.quantities),
        timesOrdered: p.timesOrdered,
        lastOrderDate: p.orderDates[0]!,
        aliases: seedAliases(p.name, p.brand),
      }))
      .sort((a, b) => b.timesOrdered - a.timesOrdered);

    const outPath = path.join(__dirname, '..', 'dictionary-draft.json');
    fs.writeFileSync(outPath, JSON.stringify(draft, null, 2), 'utf-8');

    console.log(`Draft written to ${outPath}`);
    console.log(`${draft.length} unique products across ${scannedOrders} orders.`);
    console.log('\nNext: curate these into product-dictionary.json — add English names,');
    console.log('Hebrew shorthand, and brand terms to each entry\'s "aliases" array.');
  } finally {
    await session.close();
    await bot.terminate();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
