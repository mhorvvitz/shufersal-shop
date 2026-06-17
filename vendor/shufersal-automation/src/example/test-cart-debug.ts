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

  try {
    // Check selected time slot
    const timeSlot = await session.getSelectedTimeSlot();
    console.log('Selected time slot:', timeSlot);

    // Check current cart
    const cartBefore = await session.getCartItems();
    console.log(`\nCart before: ${cartBefore.length} items`);
    cartBefore.forEach((item) => {
      console.log(`  - ${item.productCode}: qty ${item.quantity}, price ${item.itemPrice}`);
    });

    // Add milk
    console.log('\nAdding milk...');
    await session.addToCart([
      { productCode: 'P_4131074', quantity: 1, sellingMethod: 'UNIT' as any },
    ]);

    // Check cart after
    const cartAfter = await session.getCartItems();
    console.log(`\nCart after: ${cartAfter.length} items`);
    cartAfter.forEach((item) => {
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
