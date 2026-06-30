import { ShufersalBot } from 'shufersal-automation';
import fs from 'fs';
import {
  scanOrderHistory,
  writeCache,
  readCache,
  isStale,
  cadence,
  cadenceLabel,
  daysSince,
  overdue,
  isDue,
  frequency,
  boughtRecently,
  restockScore,
  isNonProduct,
  meetsDiscoveryThreshold,
  seedAliases,
  mostCommonQuantity,
  todayISO,
  type OrderStatsCache,
} from './order-stats';
import { readDictionary, isUnavailable, type DictionaryEntry } from './dictionary';
import { loadCredentials, loadBrowserConnection } from './browser-connection';

export interface SuggestOptions {
  refresh?: boolean;
  n?: number;
  ordersToScan?: number;
}

interface Suggestion {
  name: string;
  brand: string;
  code: string;
  timesOrdered: number;
  totalOrders: number;
  daysSinceLast: number;
  cadence: number;
  cadenceLabel: string;
  overdue: number;
  score: number;
  due: boolean;
  inDictionary: boolean;
  autoAdded: boolean;
}

/** Open a session, scan, write the cache. Used only on the --refresh path. */
export async function refreshSuggestCache(ordersToScan: number): Promise<OrderStatsCache> {
  const { username, password } = loadCredentials();

  const bot = new ShufersalBot(loadBrowserConnection());
  const session = await bot.createSession(username, password);
  try {
    const { stats, scannedOrders, medianOrderSize } = await scanOrderHistory(session, ordersToScan);
    const meta = { scannedOrders, medianOrderSize, generatedAt: todayISO() };
    // Only write once the scan fully succeeded — never persist a partial cache.
    writeCache(stats, meta);
    return { ...meta, stats };
  } finally {
    await session.close();
    await bot.terminate();
  }
}

export type SuggestResult =
  | { noCache: true }
  | {
      noCache?: false;
      suggestions: Suggestion[];
      autoAdded: { name: string; code: string; aliases: string[]; needsCuration: true }[];
      cache: { scannedOrders: number; medianOrderSize: number; generatedAt: string; stale: boolean };
    };

/**
 * Builds restock suggestions from the cached order scan (refreshing it first if
 * `options.refresh` is set). Returns `{ noCache: true }` if no cache exists yet and a
 * refresh wasn't requested — callers should tell the user to run with refresh first.
 */
export async function runSuggest(dictPath: string, options: SuggestOptions): Promise<SuggestResult> {
  let cache: OrderStatsCache | null;
  let stale = false;

  if (options.refresh) {
    cache = await refreshSuggestCache(options.ordersToScan ?? 20);
  } else {
    cache = readCache();
    if (cache === null) {
      return { noCache: true };
    }
    stale = isStale(cache);
  }

  const dictionary: DictionaryEntry[] = readDictionary(dictPath);
  const dictCodes = new Set(dictionary.map((e) => e.id));
  // Codes flagged unavailable (e.g. by the add runner) are never suggested.
  const unavailableCodes = new Set(dictionary.filter(isUnavailable).map((e) => e.id));

  // Drop non-product line items (delivery fee, deposits) even if an older cache still
  // contains them — the scan-time filter only protects fresh scans.
  const stats = cache.stats.filter((s) => !isNonProduct(s.code, s.name));

  // Auto-add: non-dictionary items meeting the discovery threshold get appended to
  // product-dictionary.json (never reordering/rewriting existing entries).
  const autoAdded: { name: string; code: string; aliases: string[]; needsCuration: true }[] = [];
  const newEntries: DictionaryEntry[] = [];

  for (const stat of stats) {
    if (dictCodes.has(stat.code)) continue;
    if (!meetsDiscoveryThreshold(stat.timesOrdered, stat.totalOrders)) continue;

    const aliases = seedAliases(stat.name, stat.brand);
    const entry: DictionaryEntry = {
      id: stat.code,
      name: stat.name,
      brand: stat.brand,
      typicalQuantity: mostCommonQuantity(stat.quantities),
      sellingMethod: stat.sellingMethod,
      aliases,
      needsCuration: true,
    };
    newEntries.push(entry);
    dictCodes.add(stat.code);
    autoAdded.push({ name: stat.name, code: stat.code, aliases, needsCuration: true });
  }

  if (newEntries.length > 0) {
    // Append only — preserve existing entries and their order exactly.
    const updated = [...dictionary, ...newEntries];
    fs.writeFileSync(dictPath, JSON.stringify(updated, null, 2), 'utf-8');
  }

  // Build candidate suggestions: every stat that is now in the dictionary and has a
  // defined cadence. One-offs (timesOrdered < 2) have no cadence and are skipped.
  const candidates: Suggestion[] = [];
  for (const stat of stats) {
    const inDictionary = dictCodes.has(stat.code);
    if (!inDictionary) continue; // not curated and didn't meet discovery threshold
    if (unavailableCodes.has(stat.code)) continue; // flagged unavailable — don't suggest

    const cad = cadence(stat.orderDates);
    if (cad === undefined) continue; // one-off, never suggested

    const dsl = daysSince(stat.lastOrderDate);
    const od = overdue(dsl, cad)!;
    const due = isDue(od);
    const score = restockScore(frequency(stat.timesOrdered, stat.totalOrders), od);

    candidates.push({
      name: stat.name,
      brand: stat.brand,
      code: stat.code,
      timesOrdered: stat.timesOrdered,
      totalOrders: stat.totalOrders,
      daysSinceLast: dsl,
      cadence: round2(cad),
      cadenceLabel: cadenceLabel(cad),
      overdue: round2(od),
      score: round2(score),
      due,
      inDictionary: true,
      autoAdded: autoAdded.some((a) => a.code === stat.code),
    });
  }

  // Keep items that are due AND still part of the user's recent buying (within the
  // recency window — drops past phases that show huge overdue ratios). Rank by restock
  // score (frequency × overdue) so reliable staples beat stale one-offs; tie-break by
  // shorter cadence.
  const due = candidates
    .filter((c) => c.due && boughtRecently(c.daysSinceLast))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.cadence - b.cadence;
    });

  const n = options.n ?? cache.medianOrderSize;
  const suggestions = due.slice(0, Math.max(0, n));

  return {
    suggestions,
    autoAdded,
    cache: {
      scannedOrders: cache.scannedOrders,
      medianOrderSize: cache.medianOrderSize,
      generatedAt: cache.generatedAt,
      stale,
    },
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
