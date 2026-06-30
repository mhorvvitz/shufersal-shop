import { ShufersalBot } from 'shufersal-automation';
import { loadCredentials, loadBrowserConnection } from './browser-connection';

export interface SearchResultItem {
  code: string;
  name: string;
  brand: string;
  sellingMethod: string;
  price: number;
  formattedPrice: string;
  inStock: boolean;
  purchasable: boolean;
}

export interface SearchResult {
  query: string;
  totalResults: number;
  results: SearchResultItem[];
}

// Read-only product search — used to find a replacement when a dictionary product turns
// out to be unavailable. Never adds to the cart or touches checkout.
export async function runSearch(query: string, limit: number): Promise<SearchResult> {
  const { username, password } = loadCredentials();
  const bot = new ShufersalBot(loadBrowserConnection());
  const session = await bot.createSession(username, password);

  try {
    const search = await session.searchProducts(query, limit);
    const results = search.results.map((p) => ({
      code: p.code,
      name: p.name,
      brand: p.brand?.name ?? '',
      sellingMethod: p.sellingMethod,
      price: p.price,
      formattedPrice: p.formattedPrice,
      inStock: p.inStock,
      purchasable: p.purchasable,
    }));

    return { query, totalResults: search.totalResults, results };
  } finally {
    await session.close();
    await bot.terminate();
  }
}
