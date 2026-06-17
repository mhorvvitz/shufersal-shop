import { ShufersalBot } from '~/index';
import dotenv from 'dotenv';

dotenv.config();

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set');
}

const ITEMS_TO_FIND = ['חלב', 'תפוחים', 'גבינה מגורדת', 'גבינה פרוסה', 'יוגורט יווני', 'פיתה'];

async function main() {
  const bot = new ShufersalBot({
    executablePath: CHROME_PATH,
    headless: false,
  });

  const session = await bot.createSession(USERNAME, PASSWORD);

  try {
    console.log('Fetching order history...\n');
    const orders = await session.getOrders();
    const allOrders = [...orders.activeOrders, ...orders.closedOrders];
    console.log(`Found ${allOrders.length} orders (${orders.activeOrders.length} active, ${orders.closedOrders.length} closed)\n`);

    // Check up to 5 recent orders for matching products
    const ordersToCheck = allOrders.slice(0, 5);
    const matchedProducts = new Map<string, { name: string; code: string; quantity: number; brand: string; sellingMethod: string; count: number }>();

    for (const order of ordersToCheck) {
      console.log(`Checking order ${order.code} (${order.deliveryDateTime})...`);
      const details = await session.getOrderDetails(order.code);
      if (!details) continue;

      for (const item of details.items) {
        const productName = item.product.name.toLowerCase();
        const brand = item.product.brand?.name ?? 'Unknown';

        for (const searchTerm of ITEMS_TO_FIND) {
          if (productName.includes(searchTerm) || productName.includes(searchTerm.replace(/\s/g, ''))) {
            const key = `${searchTerm}::${item.product.code}`;
            const existing = matchedProducts.get(key);
            if (existing) {
              existing.count++;
              existing.quantity = Math.max(existing.quantity, item.quantity);
            } else {
              matchedProducts.set(key, {
                name: item.product.name,
                code: item.product.code,
                quantity: item.quantity,
                brand,
                sellingMethod: item.product.sellingMethod,
                count: 1,
              });
            }
          }
        }
      }
    }

    // For each search term, pick the most frequently ordered product
    console.log('\n=== Matched Products from Order History ===\n');
    const toAdd: { productCode: string; quantity: number; sellingMethod: any; name: string }[] = [];

    for (const searchTerm of ITEMS_TO_FIND) {
      const matches = Array.from(matchedProducts.entries())
        .filter(([key]) => key.startsWith(`${searchTerm}::`))
        .sort((a, b) => b[1].count - a[1].count);

      if (matches.length > 0) {
        const best = matches[0][1];
        console.log(`${searchTerm}:`);
        console.log(`  -> ${best.name} (${best.brand}), qty: ${best.quantity}, ordered ${best.count}x`);
        if (matches.length > 1) {
          console.log(`     (${matches.length - 1} other matches skipped)`);
        }
        toAdd.push({
          productCode: best.code,
          quantity: best.quantity,
          sellingMethod: best.sellingMethod,
          name: best.name,
        });
      } else {
        console.log(`${searchTerm}: NOT FOUND in order history`);
      }
    }

    if (toAdd.length === 0) {
      console.log('\nNo matching products found in order history.');
      return;
    }

    console.log(`\n=== Adding ${toAdd.length} items to cart ===\n`);
    for (const item of toAdd) {
      console.log(`  ${item.quantity}x ${item.name} (${item.productCode})`);
    }

    await session.addToCart(
      toAdd.map((item) => ({
        productCode: item.productCode,
        quantity: item.quantity,
        sellingMethod: item.sellingMethod,
      })),
    );

    console.log('\nAdded! Verifying cart...');
    const cart = await session.getCartItems();
    console.log(`Cart has ${cart.length} item(s):`);
    cart.forEach((c) => {
      console.log(`  - ${c.productCode}: qty ${c.quantity}, price ${c.itemPrice}`);
    });

    console.log('\nBrowser left open. Press Ctrl+C to close.');
    await new Promise(() => {});
  } catch (err) {
    console.error('Error:', err);
    await session.close();
    await bot.terminate();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
