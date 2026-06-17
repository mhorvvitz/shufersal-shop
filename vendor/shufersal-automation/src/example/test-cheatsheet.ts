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

function matchFromCheatSheet(query: string, cheatSheet: CheatSheetEntry[]): CheatSheetEntry | null {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  // Score each product: how many query words appear in its keywords or name
  const scored = cheatSheet.map((entry) => {
    const nameAndBrand = `${entry.name} ${entry.brand}`.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (nameAndBrand.includes(word)) {
        score++;
      }
    }
    // Boost by order frequency
    return { entry, score, boosted: score > 0 ? score * 100 + entry.timesOrdered : 0 };
  });

  const best = scored.sort((a, b) => b.boosted - a.boosted)[0];
  return best && best.score > 0 ? best.entry : null;
}

async function main() {
  const cheatSheetPath = path.join(__dirname, '..', '..', 'cheatsheet.json');
  const cheatSheet: CheatSheetEntry[] = JSON.parse(fs.readFileSync(cheatSheetPath, 'utf-8'));

  const requests = [
    { query: 'Milk', hebrewHints: ['חלב'] },
    { query: 'Apples', hebrewHints: ['תפוחים'] },
    { query: 'Shredded Cheese', hebrewHints: ['מגורדת', 'גבינה מגורדת'] },
    { query: 'Sliced Cheese', hebrewHints: ['פרוס', 'גבינה פרוסה'] },
    { query: 'Greek Yogurt', hebrewHints: ['יווני', 'יוגורט יווני'] },
    { query: 'Pita', hebrewHints: ['פיתה'] },
  ];

  console.log('=== Matching from Cheat Sheet ===\n');

  const toAdd: { code: string; quantity: number; sellingMethod: string; name: string }[] = [];
  const notFound: string[] = [];

  for (const req of requests) {
    // Try each Hebrew hint against the cheat sheet
    let match: CheatSheetEntry | null = null;
    for (const hint of req.hebrewHints) {
      match = matchFromCheatSheet(hint, cheatSheet);
      if (match) break;
    }

    if (match) {
      console.log(`${req.query}:`);
      console.log(`  -> ${match.name} (${match.brand}), qty: ${match.typicalQuantity}, ordered ${match.timesOrdered}x`);
      toAdd.push({
        code: match.code,
        quantity: match.typicalQuantity,
        sellingMethod: match.sellingMethod,
        name: match.name,
      });
    } else {
      console.log(`${req.query}: NOT in cheat sheet — would fall back to search`);
      notFound.push(req.query);
    }
  }

  console.log(`\n=== Adding ${toAdd.length} items to cart ===\n`);
  for (const item of toAdd) {
    console.log(`  ${item.quantity}x ${item.name} (${item.code})`);
  }

  const bot = new ShufersalBot({
    executablePath: CHROME_PATH,
    headless: false,
  });

  const session = await bot.createSession(USERNAME, PASSWORD);

  try {
    await session.addToCart(
      toAdd.map((item) => ({
        productCode: item.code,
        quantity: item.quantity,
        sellingMethod: item.sellingMethod as any,
      })),
    );

    console.log('\nAdded! Verifying cart...');
    const cart = await session.getCartItems();
    console.log(`Cart has ${cart.length} item(s):`);
    cart.forEach((c) => {
      console.log(`  - ${c.productCode}: qty ${c.quantity}, price ${c.itemPrice}`);
    });

    if (notFound.length > 0) {
      console.log(`\nItems not in cheat sheet (would need search): ${notFound.join(', ')}`);
    }

    console.log('\nBrowser left open. Press Ctrl+C to close.');
    await new Promise(() => {});
  } catch (err) {
    console.error('Error:', err);
    await session.close();
    await bot.terminate();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
