import fs from 'fs';
import path from 'path';
import type { ShufersalSession } from 'shufersal-automation';

// Per-product purchase statistics, accumulated over a span of scanned orders.
// Pulled out of build-dictionary.ts so the dictionary builder and the suggester
// share one scan code path.
export interface ProductStat {
  code: string;
  name: string;
  brand: string;
  sellingMethod: string;
  timesOrdered: number;
  totalOrders: number;
  quantities: number[];
  orderDates: string[]; // ISO date strings (YYYY-MM-DD), one per order containing the item
  lastOrderDate: string; // YYYY-MM-DD
}

export interface CacheMeta {
  scannedOrders: number;
  medianOrderSize: number;
  generatedAt: string; // YYYY-MM-DD
}

export interface OrderStatsCache extends CacheMeta {
  stats: ProductStat[];
}

const CACHE_PATH = path.join(__dirname, '..', '..', 'order-stats.json');

// Line items that aren't real products: the online delivery fee, bottle deposits, etc.
// They appear in most orders and would otherwise pollute the dictionary and suggestions.
const NON_PRODUCT_CODES = new Set(['P_1159']); // משלוח שופרסל אונליין (delivery fee)

/**
 * True if an order line item is a non-product charge (delivery, deposit) rather than
 * something the user actually buys. Matched by a known code blocklist or by name.
 */
export function isNonProduct(code: string, name: string): boolean {
  if (NON_PRODUCT_CODES.has(code)) return true;
  return /משלוח|פיקדון/.test(name);
}

/** Normalize an order's deliveryDateTime (ISO timestamp) to a YYYY-MM-DD date. */
function toDate(deliveryDateTime: string): string {
  return deliveryDateTime.split('T')[0]!;
}

/**
 * Scan an open session's order history and return per-product stats. Logs nothing,
 * makes no cache writes — pure data extraction over the session API. The caller owns
 * session lifecycle.
 */
export async function scanOrderHistory(
  session: ShufersalSession,
  ordersToScan: number,
): Promise<{ stats: ProductStat[]; scannedOrders: number; medianOrderSize: number }> {
  const orders = await session.getOrders();
  const allOrders = [...orders.activeOrders, ...orders.closedOrders];
  const ordersToCheck = allOrders.slice(0, ordersToScan);

  const productMap = new Map<string, ProductStat>();
  // Distinct-product count per order, used to compute the median order size.
  const distinctPerOrder: number[] = [];
  let scannedOrders = 0;

  for (const order of ordersToCheck) {
    const details = await session.getOrderDetails(order.code);
    if (!details) continue;

    scannedOrders++;
    const date = toDate(order.deliveryDateTime);
    const seenInThisOrder = new Set<string>();

    for (const item of details.items) {
      const code = item.product.code;
      // Skip non-product charges (delivery fee, deposits) — they aren't things to restock.
      if (isNonProduct(code, item.product.name)) continue;
      // Guard against the same product appearing twice in one order's line items.
      const firstTimeInOrder = !seenInThisOrder.has(code);
      seenInThisOrder.add(code);

      const existing = productMap.get(code);
      if (existing) {
        existing.quantities.push(item.quantity);
        if (firstTimeInOrder) {
          existing.timesOrdered++;
          existing.orderDates.push(date);
        }
      } else {
        productMap.set(code, {
          code,
          name: item.product.name,
          brand: item.product.brand?.name ?? '',
          sellingMethod: item.product.sellingMethod,
          timesOrdered: 1,
          totalOrders: 0, // filled in below once we know the scanned count
          quantities: [item.quantity],
          orderDates: [date],
          lastOrderDate: date,
        });
      }
    }

    distinctPerOrder.push(seenInThisOrder.size);
  }

  const stats = Array.from(productMap.values()).map((p) => {
    // orderDates are scanned newest-first (active then closed); lastOrderDate is the max.
    const lastOrderDate = p.orderDates.slice().sort().pop() ?? p.lastOrderDate;
    return { ...p, totalOrders: scannedOrders, lastOrderDate };
  });

  return { stats, scannedOrders, medianOrderSize: median(distinctPerOrder) };
}

// ── Pure cadence helpers (no network, no I/O) ──────────────────────────────

/** Median of a list. Returns 0 for an empty list. Average of the two middle values when even. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Mean gap in days between consecutive purchases of an item.
 * Undefined when there are fewer than 2 orders (a one-off has no cadence).
 */
export function cadence(orderDates: string[]): number | undefined {
  if (orderDates.length < 2) return undefined;
  const times = orderDates
    .map((d) => new Date(d + 'T00:00:00Z').getTime())
    .sort((a, b) => a - b);
  let totalGap = 0;
  for (let i = 1; i < times.length; i++) {
    totalGap += (times[i]! - times[i - 1]!) / (1000 * 60 * 60 * 24);
  }
  return totalGap / (times.length - 1);
}

/** Bucket a raw cadence (days) into a human label. Display only; ranking uses raw cadence. */
export function cadenceLabel(cadenceDays: number | undefined): string {
  if (cadenceDays === undefined) return 'one-off';
  if (Math.abs(cadenceDays - 7) <= 2) return 'weekly';
  if (Math.abs(cadenceDays - 14) <= 3) return 'biweekly';
  if (cadenceDays >= 25 && cadenceDays <= 32) return 'monthly';
  return `every ${Math.round(cadenceDays)} days`;
}

/** Whole-days elapsed between an ISO date string and a reference date (default: now). */
export function daysSince(lastOrderDate: string, now: Date = new Date()): number {
  const last = new Date(lastOrderDate + 'T00:00:00Z').getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - last) / (1000 * 60 * 60 * 24));
}

/** overdue ratio: daysSinceLast / cadence. Undefined when cadence is undefined. */
export function overdue(daysSinceLast: number, cadenceDays: number | undefined): number | undefined {
  if (cadenceDays === undefined || cadenceDays <= 0) return undefined;
  return daysSinceLast / cadenceDays;
}

/**
 * An item is "due" when it has a defined cadence and a near-full cadence has elapsed.
 * Tolerance of 0.9 so a near-due weekly item isn't missed by a day.
 */
export function isDue(
  overdueRatio: number | undefined,
  tolerance = 0.9,
): boolean {
  return overdueRatio !== undefined && overdueRatio >= tolerance;
}

/**
 * Frequency: share of scanned orders that contained the item.
 */
export function frequency(timesOrdered: number, totalOrders: number): number {
  if (totalOrders <= 0) return 0;
  return timesOrdered / totalOrders;
}

/**
 * Suggestions only consider items bought within this many days. Filters out items the
 * user appears to have stopped buying (a brief past phase shows huge overdue ratios
 * that would otherwise dominate the ranking).
 */
export const RECENT_WINDOW_DAYS = 90;

/** True if the item was last bought within the recency window. */
export function boughtRecently(
  daysSinceLast: number,
  windowDays = RECENT_WINDOW_DAYS,
): boolean {
  return daysSinceLast <= windowDays;
}

/**
 * Restock score: weight overdue-ness by how reliably the user buys the item, so
 * frequent staples outrank stale one-offs that happen to be far past a short cadence.
 * Returns 0 when there is no cadence (undefined overdue).
 */
export function restockScore(freq: number, overdueRatio: number | undefined): number {
  if (overdueRatio === undefined) return 0;
  return freq * overdueRatio;
}

/**
 * Discovery threshold for auto-adding a non-dictionary item: genuinely recurring,
 * not a one-off. timesOrdered >= 2 AND frequency >= 0.15.
 */
export function meetsDiscoveryThreshold(
  timesOrdered: number,
  totalOrders: number,
  minFrequency = 0.15,
): boolean {
  return timesOrdered >= 2 && frequency(timesOrdered, totalOrders) >= minFrequency;
}

// ── Cache I/O ──────────────────────────────────────────────────────────────

/** Write the scan results to order-stats.json. Optional path override for tests. */
export function writeCache(
  stats: ProductStat[],
  meta: CacheMeta,
  cachePath: string = CACHE_PATH,
): void {
  const cache: OrderStatsCache = {
    scannedOrders: meta.scannedOrders,
    medianOrderSize: meta.medianOrderSize,
    generatedAt: meta.generatedAt,
    stats,
  };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

/** Read order-stats.json. Returns null if the file is absent. */
export function readCache(cachePath: string = CACHE_PATH): OrderStatsCache | null {
  if (!fs.existsSync(cachePath)) return null;
  return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as OrderStatsCache;
}

/** True if generatedAt is older than maxAgeDays (default 14). */
export function isStale(
  meta: Pick<CacheMeta, 'generatedAt'>,
  maxAgeDays = 14,
  now: Date = new Date(),
): boolean {
  return daysSince(meta.generatedAt, now) > maxAgeDays;
}

/** Today's date as YYYY-MM-DD (UTC), for stamping generatedAt. */
export function todayISO(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .split('T')[0]!;
}

export const CACHE_FILE_PATH = CACHE_PATH;

/**
 * Seed aliases from a product's Hebrew name + brand words. These are a STARTING POINT
 * for curation, not finished aliases. Shared by the dictionary builder and the
 * suggester's auto-add path so both generate identical seeds.
 */
export function seedAliases(name: string, brand: string): string[] {
  const aliases = [...name.split(/[\s,.\-\/|()]+/), ...brand.split(/[\s,.\-\/|()]+/)]
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .filter((w) => !/^\d+(%|גרם|מ"ל|ק"ג|ליטר)?$/.test(w));
  return [...new Set(aliases)];
}

/** Most common quantity in a list (ties resolved toward the last-seen mode, matching the builder). */
export function mostCommonQuantity(quantities: number[]): number {
  return quantities
    .slice()
    .sort(
      (a, b) =>
        quantities.filter((v) => v === a).length - quantities.filter((v) => v === b).length,
    )
    .pop()!;
}
