import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSampleCache } from './sample-stats';
import { cadence, daysSince, overdue, isDue, boughtRecently } from './lib/order-stats';
import type { DictionaryEntry } from './lib/dictionary';

// A stand-in for the 10-item sample dictionary — only id/typicalQuantity matter here.
const dict: DictionaryEntry[] = Array.from({ length: 10 }, (_, i) => ({
  id: `P_${i}`,
  name: `item ${i}`,
  brand: 'b',
  typicalQuantity: 1,
  sellingMethod: 'UNIT',
  aliases: [],
}));

// Fixed "now" so the assertions are deterministic regardless of when the suite runs.
const now = new Date('2026-06-21T00:00:00Z');

/** Reproduce the suggester's selection over the sample cache. */
function dueCodes(): string[] {
  const cache = buildSampleCache(dict, now);
  return cache.stats
    .filter((s) => {
      const cad = cadence(s.orderDates);
      if (cad === undefined) return false; // one-off
      const dsl = daysSince(s.lastOrderDate, now);
      return isDue(overdue(dsl, cad)) && boughtRecently(dsl);
    })
    .map((s) => s.code);
}

test('sample cache surfaces the crafted due items and filters the rest', () => {
  // Indices 0,2,4,5,6 are due-and-recent; 1,3,7 not due yet; 8 outside 90d; 9 one-off.
  assert.deepEqual(dueCodes().sort(), ['P_0', 'P_2', 'P_4', 'P_5', 'P_6']);
});

test('sample cache is dated relative to now (not stale on generation)', () => {
  const cache = buildSampleCache(dict, now);
  assert.equal(cache.generatedAt, '2026-06-21');
  assert.equal(cache.scannedOrders, 20);
  // every stat has one orderDate per timesOrdered, newest matching lastOrderDate
  for (const s of cache.stats) {
    assert.equal(s.orderDates.length, s.timesOrdered);
    assert.equal(s.lastOrderDate, s.orderDates[s.orderDates.length - 1]);
  }
});
