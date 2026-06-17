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

interface CheatSheetEntry {
  code: string;
  name: string;
  brand: string;
  sellingMethod: string;
  typicalQuantity: number;
  timesOrdered: number;
  lastOrderDate: string;
  keywords: string[];
}

async function main() {
  const bot = new ShufersalBot({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const session = await bot.createSession(USERNAME, PASSWORD);

  try {
    console.log('Fetching order history...');
    const orders = await session.getOrders();
    const allOrders = [...orders.activeOrders, ...orders.closedOrders];
    const ordersToCheck = allOrders.slice(0, 20);
    console.log(`Scanning ${ordersToCheck.length} orders...\n`);

    const productMap = new Map<string, {
      code: string;
      name: string;
      brand: string;
      sellingMethod: string;
      quantities: number[];
      count: number;
      lastOrderDate: string;
    }>();

    for (const order of ordersToCheck) {
      console.log(`  Order ${order.code} (${order.deliveryDateTime.split('T')[0]})`);
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

    // Build cheat sheet with keywords from product name and brand
    const cheatSheet: CheatSheetEntry[] = Array.from(productMap.values())
      .map((p) => {
        const mostCommonQty = p.quantities.sort((a, b) =>
          p.quantities.filter((v) => v === a).length - p.quantities.filter((v) => v === b).length
        ).pop()!;

        // Generate keywords: split name and brand into individual words, lowercase
        const keywords = [
          ...p.name.split(/[\s,.\-\/|()]+/),
          ...p.brand.split(/[\s,.\-\/|()]+/),
        ]
          .map((w) => w.trim())
          .filter((w) => w.length > 1)
          .filter((w) => !/^\d+(%|גרם|מ"ל|ק"ג|ליטר)?$/.test(w)); // filter out numbers/units

        return {
          code: p.code,
          name: p.name,
          brand: p.brand,
          sellingMethod: p.sellingMethod,
          typicalQuantity: mostCommonQty,
          timesOrdered: p.count,
          lastOrderDate: p.lastOrderDate.split('T')[0],
          keywords: [...new Set(keywords)],
        };
      })
      .sort((a, b) => b.timesOrdered - a.timesOrdered);

    const outPath = path.join(__dirname, '..', '..', 'cheatsheet.json');
    fs.writeFileSync(outPath, JSON.stringify(cheatSheet, null, 2), 'utf-8');

    console.log(`\nCheat sheet saved to ${outPath}`);
    console.log(`${cheatSheet.length} unique products across ${ordersToCheck.length} orders\n`);

    console.log('Top 15 most ordered:');
    cheatSheet.slice(0, 15).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} (${p.brand}) — ${p.timesOrdered}x, typical qty: ${p.typicalQuantity}`);
    });
  } finally {
    await session.close();
    await bot.terminate();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
