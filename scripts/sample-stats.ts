import fs from 'fs';
import path from 'path';
import {
  todayISO,
  CACHE_FILE_PATH,
  type ProductStat,
  type OrderStatsCache,
} from './lib/order-stats';
import { readDictionary, type DictionaryEntry } from './lib/dictionary';

// Generates a sample order-stats cache aligned to product-dictionary.sample.json so the
// suggester can be tried without credentials or a live order scan:
//
//   cp product-dictionary.sample.json product-dictionary.json
//   npm run sample-stats
//   npm run suggest
//
// Dates are anchored to *today*, not hard-coded, so the demo never goes stale (the suggester
// filters by a 90-day recency window and 14-day cache staleness). Each sample item gets a
// profile crafted to show a realistic mix: items that are due, items not due yet, one that
// falls outside the recency window, and a one-off with no cadence.
interface Profile {
  cadenceDays: number; // average gap between purchases (0 = a one-off, never suggested)
  lastDaysAgo: number; // how long since the most recent purchase
  timesOrdered: number;
}

const PROFILES: Profile[] = [
  { cadenceDays: 7, lastDaysAgo: 9, timesOrdered: 8 }, // weekly, due
  { cadenceDays: 7, lastDaysAgo: 4, timesOrdered: 6 }, // weekly, not due yet
  { cadenceDays: 14, lastDaysAgo: 20, timesOrdered: 5 }, // biweekly, due
  { cadenceDays: 14, lastDaysAgo: 8, timesOrdered: 4 }, // biweekly, not due yet
  { cadenceDays: 30, lastDaysAgo: 40, timesOrdered: 4 }, // monthly, due
  { cadenceDays: 10, lastDaysAgo: 12, timesOrdered: 6 }, // every 10 days, due
  { cadenceDays: 7, lastDaysAgo: 35, timesOrdered: 5 }, // weekly, well overdue (still within window)
  { cadenceDays: 30, lastDaysAgo: 15, timesOrdered: 5 }, // monthly, not due yet
  { cadenceDays: 28, lastDaysAgo: 100, timesOrdered: 3 }, // monthly, outside the 90-day window → filtered
  { cadenceDays: 0, lastDaysAgo: 50, timesOrdered: 1 }, // one-off, no cadence → never suggested
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD (UTC) date `n` whole days before `now`. */
export function dateNDaysAgo(n: number, now: Date = new Date()): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - n * DAY_MS).toISOString().split('T')[0]!;
}

/** Build a sample order-stats cache from a dictionary, dated relative to `now`. Pure. */
export function buildSampleCache(
  dict: DictionaryEntry[],
  now: Date = new Date(),
): OrderStatsCache {
  const scannedOrders = 20;
  const stats: ProductStat[] = dict.map((entry, i) => {
    const p = PROFILES[i % PROFILES.length]!;
    // Order dates spaced by the cadence: newest is `lastDaysAgo`, each prior one a cadence earlier.
    const orderDates: string[] = [];
    for (let k = 0; k < p.timesOrdered; k++) {
      orderDates.push(dateNDaysAgo(p.lastDaysAgo + k * p.cadenceDays, now));
    }
    orderDates.sort(); // ascending — lastOrderDate is the max
    return {
      code: entry.id,
      name: entry.name,
      brand: entry.brand,
      sellingMethod: entry.sellingMethod,
      timesOrdered: p.timesOrdered,
      totalOrders: scannedOrders,
      quantities: Array(p.timesOrdered).fill(entry.typicalQuantity),
      orderDates,
      lastOrderDate: orderDates[orderDates.length - 1]!,
    };
  });

  return { scannedOrders, medianOrderSize: 8, generatedAt: todayISO(now), stats };
}

function main(): void {
  const samplePath = path.join(__dirname, '..', 'product-dictionary.sample.json');
  const dict = readDictionary(samplePath);
  const cache = buildSampleCache(dict);
  fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), 'utf-8');

  console.log(`Wrote ${cache.stats.length} sample stats to ${CACHE_FILE_PATH}`);
  console.log('(Overwrites any existing order-stats.json — rebuild your real one with: npm run suggest -- --refresh)');
  console.log('\nMake sure product-dictionary.json is the sample, then try it:');
  console.log('  cp product-dictionary.sample.json product-dictionary.json   # if you haven\'t already');
  console.log('  npm run suggest');
}

// Only write the file when run directly (not when imported by tests).
if (require.main === module) {
  main();
}
