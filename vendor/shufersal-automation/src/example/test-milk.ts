import { ShufersalBot } from '~/index';
import dotenv from 'dotenv';

dotenv.config();

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const CHROME_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD || !CHROME_PATH) {
  throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set');
}

async function main() {
  const bot = new ShufersalBot({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const session = await bot.createSession(USERNAME, PASSWORD);

  try {
    console.log('Searching for חלב (milk)...\n');
    const results = await session.searchProducts('חלב', 5);

    if (results.results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`Found ${results.totalResults} total results. Top 5:\n`);
    results.results.forEach((product, i) => {
      const brand = product.brand?.name ?? 'No brand';
      const stock = product.inStock ? 'In stock' : 'OUT OF STOCK';
      console.log(`  ${i + 1}. ${product.name}`);
      console.log(`     Brand: ${brand} | Price: ${product.formattedPrice} | ${stock}`);
      console.log(`     Code: ${product.code} | Method: ${product.sellingMethod}`);
      console.log('');
    });

    // Pick first in-stock product and add 2 to cart
    const selected = results.results.find((p) => p.inStock);
    if (!selected) {
      console.log('All results are out of stock.');
      return;
    }

    console.log(`Adding 2x "${selected.name}" (${selected.formattedPrice}) to cart...`);
    await session.addToCart([
      {
        productCode: selected.code,
        quantity: 2,
        sellingMethod: selected.sellingMethod,
      },
    ]);

    console.log('Added!\n');

    const cart = await session.getCartItems();
    console.log(`Cart now has ${cart.length} item(s):`);
    cart.forEach((item) => {
      console.log(`  - ${item.productCode}: qty ${item.quantity}, price ${item.itemPrice}`);
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
