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
    headless: false,
  });

  const session = await bot.createSession(USERNAME, PASSWORD);

  console.log('Searching for חלב (milk)...');
  const results = await session.searchProducts('חלב', 5);

  const selected = results.results.find((p) => p.inStock);
  if (!selected) {
    console.log('No in-stock milk found.');
    return;
  }

  console.log(`Adding 2x "${selected.name}" (${selected.formattedPrice})...`);
  await session.addToCart([
    { productCode: selected.code, quantity: 2, sellingMethod: selected.sellingMethod },
  ]);

  const cart = await session.getCartItems();
  console.log(`Cart has ${cart.length} item(s):`);
  cart.forEach((item) => {
    console.log(`  - ${item.productCode}: qty ${item.quantity}, price ${item.itemPrice}`);
  });

  console.log('\nBrowser left open. Check your cart in your own browser now.');
  console.log('Press Ctrl+C to close when done.');

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
