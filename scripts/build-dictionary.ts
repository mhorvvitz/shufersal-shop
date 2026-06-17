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
    const orders = await session.getOrders();
    const allOrders = [...orders.activeOrders, ...orders.closedOrders];
    const ordersToCheck = allOrders.slice(0, ORDERS_TO_SCAN);
    console.log(`Scanning ${ordersToCheck.length} orders...\n`);

    const productMap = new Map<
      string,
      {
        code: string;
        name: string;
        brand: string;
        sellingMethod: string;
        quantities: number[];
        count: number;
        lastOrderDate: string;
      }
    >();

    for (const order of ordersToCheck) {
      const details = await session.getOrderDetails(order.code);
      if (!details) continue;

      for (const item of details.items) {
        const existing = productMap.get(item.product.code);
        if (existing) {
          existing.count++;
          existing.quantities.push(item.quantity);
        } else {
          productMap.set(item.product.code, {
            code: item.product.code,
            name: item.product.name,
            brand: item.product.brand?.name ?? '',
            sellingMethod: item.product.sellingMethod,
            quantities: [item.quantity],
            count: 1,
            lastOrderDate: order.deliveryDateTime,
          });
        }
      }
    }

    // Seed aliases from the Hebrew name + brand words. These are a STARTING POINT —
    // curate product-dictionary.json by hand to add English names and casual terms.
    const draft: DraftEntry[] = Array.from(productMap.values())
      .map((p) => {
        const mostCommonQty = p.quantities
          .sort(
            (a, b) =>
              p.quantities.filter((v) => v === a).length -
              p.quantities.filter((v) => v === b).length,
          )
          .pop()!;

        const aliases = [...p.name.split(/[\s,.\-\/|()]+/), ...p.brand.split(/[\s,.\-\/|()]+/)]
          .map((w) => w.trim())
          .filter((w) => w.length > 1)
          .filter((w) => !/^\d+(%|גרם|מ"ל|ק"ג|ליטר)?$/.test(w));

        return {
          id: p.code,
          name: p.name,
          brand: p.brand,
          sellingMethod: p.sellingMethod,
          typicalQuantity: mostCommonQty,
          timesOrdered: p.count,
          lastOrderDate: p.lastOrderDate.split('T')[0]!,
          aliases: [...new Set(aliases)],
        };
      })
      .sort((a, b) => b.timesOrdered - a.timesOrdered);

    const outPath = path.join(__dirname, '..', 'dictionary-draft.json');
    fs.writeFileSync(outPath, JSON.stringify(draft, null, 2), 'utf-8');

    console.log(`Draft written to ${outPath}`);
    console.log(`${draft.length} unique products across ${ordersToCheck.length} orders.`);
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
