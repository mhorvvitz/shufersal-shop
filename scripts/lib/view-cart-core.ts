import { ShufersalBot } from 'shufersal-automation';
import fs from 'fs';
import { loadCredentials, loadBrowserConnection } from './browser-connection';

// Cart items only carry a productCode, so map codes back to dictionary names/brands.
interface DictionaryEntry {
  id: string;
  name: string;
  brand: string;
}

export interface ViewCartItem {
  productCode: string;
  name: string | null;
  brand: string | null;
  quantity: number;
  itemPrice: number | null;
}

export interface ViewCartResult {
  items: ViewCartItem[];
  itemCount: number;
  total: number;
}

// Read-only: lists the current cart contents. Never touches checkout or time slots.
export async function runViewCart(dictPath: string): Promise<ViewCartResult> {
  // The cart can still be listed without a dictionary; codes just won't map to names.
  const dictionary: DictionaryEntry[] = fs.existsSync(dictPath)
    ? JSON.parse(fs.readFileSync(dictPath, 'utf-8'))
    : [];
  const byCode = new Map(dictionary.map((e) => [e.id, e]));

  const { username, password } = loadCredentials();
  const bot = new ShufersalBot(loadBrowserConnection());
  const session = await bot.createSession(username, password);

  try {
    const cart = await session.getCartItems();
    const total = cart.reduce((sum, c) => sum + (c.itemPrice ?? 0), 0);

    return {
      items: cart.map((c) => {
        const entry = byCode.get(c.productCode);
        return {
          productCode: c.productCode,
          name: entry?.name ?? null,
          brand: entry?.brand ?? null,
          quantity: c.quantity,
          itemPrice: c.itemPrice ?? null,
        };
      }),
      itemCount: cart.length,
      total: Number(total.toFixed(2)),
    };
  } finally {
    await session.close();
    await bot.terminate();
  }
}
