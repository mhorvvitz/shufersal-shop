import { ShufersalBot } from 'shufersal-automation';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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
  type ProductStat,
  type OrderStatsCache,
} from './lib/order-stats';

// Load credentials from the skill's own .env (see README). Only needed for --refresh.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');

interface DictionaryEntry {
  id: string;
  name: string;
  brand: string;
  typicalQuantity: number;
  sellingMethod: string;
  aliases: string[];
  needsCuration?: boolean;
}

interface CliArgs {
  refresh: boolean;
  n: number | undefined;
  ordersToScan: number;
}

function parseArgs(argv: string[]): CliArgs {
  let refresh = false;
  let n: number | undefined;
  let ordersToScan = 20;
  for (const raw of argv) {
    if (raw === '--refresh') {
      refresh = true;
      continue;
    }
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) {
      // First positional number is N (how many suggestions). We keep the
      // default orders-to-scan at 20; N is the only positional argument.
      n = Math.floor(num);
    }
  }
  return { refresh, n, ordersToScan };
}

/** Open a session, scan, write the cache. Used only on the --refresh path. */
async function refreshCache(ordersToScan: number): Promise<OrderStatsCache> {
  const USERNAME = process.env['SHUFERSAL_USERNAME'];
  const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
  const CHROME_PATH = process.env['CHROME_PATH'];
  if (!USERNAME || !PASSWORD || !CHROME_PATH) {
    throw new Error('SHUFERSAL_USERNAME, SHUFERSAL_PASSWORD, and CHROME_PATH must be set in .env');
  }

  const bot = new ShufersalBot({ executablePath: CHROME_PATH, headless: true });
  const session = await bot.createSession(USERNAME, PASSWORD);
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Dictionary is a precondition; never create one implicitly.
  if (!fs.existsSync(dictPath)) {
    console.error(
      'No product-dictionary.json found. This file is personal and gitignored, so a fresh ' +
        'checkout starts without it.\n' +
        'Create it before suggesting, either by:\n' +
        '  1. npm run build-dictionary -- 20   (scan your order history, then curate the draft), or\n' +
        '  2. cp product-dictionary.sample.json product-dictionary.json   (start from the 10-item sample).',
    );
    process.exit(1);
  }

  run(args).catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}

async function run(args: CliArgs): Promise<void> {
  let cache: OrderStatsCache | null;
  let stale = false;

  if (args.refresh) {
    cache = await refreshCache(args.ordersToScan);
  } else {
    cache = readCache();
    if (cache === null) {
      console.log(
        'No cache found (order-stats.json). Run with --refresh to scan your order history first:\n' +
          '  npx tsx scripts/suggest.ts --refresh',
      );
      process.exit(0);
      return;
    }
    stale = isStale(cache);
  }

  const dictionary: DictionaryEntry[] = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
  const dictCodes = new Set(dictionary.map((e) => e.id));

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

  const n = args.n ?? cache.medianOrderSize;
  const suggestions = due.slice(0, Math.max(0, n));

  const result = {
    suggestions,
    autoAdded,
    cache: {
      scannedOrders: cache.scannedOrders,
      medianOrderSize: cache.medianOrderSize,
      generatedAt: cache.generatedAt,
      stale,
    },
  };

  console.log('RESULT_JSON_START');
  console.log(JSON.stringify(result, null, 2));
  console.log('RESULT_JSON_END');
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

main();
