import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  median,
  cadence,
  cadenceLabel,
  daysSince,
  overdue,
  isDue,
  frequency,
  meetsDiscoveryThreshold,
  isNonProduct,
  boughtRecently,
  restockScore,
  writeCache,
  readCache,
  isStale,
  todayISO,
  type ProductStat,
} from './order-stats';

// ── non-product filter ────────────────────────────────────────────────────────

test('isNonProduct flags the delivery-fee code', () => {
  assert.equal(isNonProduct('P_1159', 'anything'), true);
});

test('isNonProduct flags delivery/deposit by name', () => {
  assert.equal(isNonProduct('P_9999', 'משלוח שופרסל אונליין'), true);
  assert.equal(isNonProduct('P_8888', 'פיקדון בקבוקים'), true);
});

test('isNonProduct passes real products', () => {
  assert.equal(isNonProduct('P_4131074', 'חלב בקרטון 3% שומן'), false);
  assert.equal(isNonProduct('P_208428', 'חומוס שלם יכין'), false);
});

// ── recency window ──────────────────────────────────────────────────────────

test('boughtRecently respects the default 90-day window', () => {
  assert.equal(boughtRecently(18), true);
  assert.equal(boughtRecently(90), true);
  assert.equal(boughtRecently(91), false);
  assert.equal(boughtRecently(242), false);
});

test('boughtRecently honors a custom window', () => {
  assert.equal(boughtRecently(100, 120), true);
  assert.equal(boughtRecently(130, 120), false);
});

// ── restock score (frequency × overdue) ───────────────────────────────────────

test('restockScore weights overdue by frequency', () => {
  // frequent staple (7/20) just overdue beats a stale one-off (2/20) far overdue
  const staple = restockScore(frequency(7, 20), 1.88); // 0.35 * 1.88 = 0.658
  const oneOff = restockScore(frequency(2, 20), 3.0); //  0.10 * 3.0  = 0.30
  assert.ok(staple > oneOff);
});

test('restockScore is 0 without a cadence', () => {
  assert.equal(restockScore(0.5, undefined), 0);
});

// ── median / median order size ──────────────────────────────────────────────

test('median of empty list is 0', () => {
  assert.equal(median([]), 0);
});

test('median of odd-length list is the middle value', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([10, 20, 5, 1, 100]), 10);
});

test('median of even-length list averages the two middle values', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([14, 10]), 12);
});

// ── cadence ──────────────────────────────────────────────────────────────────

test('cadence is undefined for fewer than 2 orders', () => {
  assert.equal(cadence([]), undefined);
  assert.equal(cadence(['2026-06-01']), undefined);
});

test('cadence is the mean gap in days between consecutive orders', () => {
  // gaps: 7, 7 -> mean 7
  assert.equal(cadence(['2026-06-01', '2026-06-08', '2026-06-15']), 7);
  // gaps: 14, 14 -> mean 14
  assert.equal(cadence(['2026-05-01', '2026-05-15', '2026-05-29']), 14);
});

test('cadence handles unsorted dates and uneven gaps', () => {
  // sorted: 06-01, 06-08, 06-22 -> gaps 7, 14 -> mean 10.5
  assert.equal(cadence(['2026-06-22', '2026-06-01', '2026-06-08']), 10.5);
});

// ── cadenceLabel bucketing ─────────────────────────────────────────────────────

test('cadenceLabel buckets', () => {
  assert.equal(cadenceLabel(undefined), 'one-off');
  assert.equal(cadenceLabel(7), 'weekly');
  assert.equal(cadenceLabel(6), 'weekly'); // within tolerance
  assert.equal(cadenceLabel(9), 'weekly');
  assert.equal(cadenceLabel(14), 'biweekly');
  assert.equal(cadenceLabel(12), 'biweekly');
  assert.equal(cadenceLabel(28), 'monthly');
  assert.equal(cadenceLabel(30), 'monthly');
  assert.equal(cadenceLabel(45), 'every 45 days');
  assert.equal(cadenceLabel(3), 'every 3 days');
});

// ── daysSince ─────────────────────────────────────────────────────────────────

test('daysSince counts whole days from a reference date', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  assert.equal(daysSince('2026-06-12', now), 9);
  assert.equal(daysSince('2026-06-21', now), 0);
});

// ── overdue / isDue ────────────────────────────────────────────────────────────

test('overdue is daysSinceLast / cadence; undefined when cadence undefined', () => {
  assert.equal(overdue(9, 7), 9 / 7);
  assert.equal(overdue(10, undefined), undefined);
  assert.equal(overdue(10, 0), undefined);
});

test('isDue uses a 0.9 tolerance', () => {
  assert.equal(isDue(undefined), false);
  assert.equal(isDue(0.89), false);
  assert.equal(isDue(0.9), true); // near-due weekly item not missed by a day
  assert.equal(isDue(1.0), true);
  assert.equal(isDue(2.5), true);
});

// ── frequency / discovery threshold ──────────────────────────────────────────

test('frequency is share of scanned orders', () => {
  assert.equal(frequency(5, 20), 0.25);
  assert.equal(frequency(0, 20), 0);
  assert.equal(frequency(2, 0), 0);
});

test('discovery threshold requires timesOrdered >= 2 AND frequency >= 0.15', () => {
  assert.equal(meetsDiscoveryThreshold(1, 20), false); // one-off
  assert.equal(meetsDiscoveryThreshold(2, 20), false); // 0.10 < 0.15
  assert.equal(meetsDiscoveryThreshold(3, 20), true); // 0.15
  assert.equal(meetsDiscoveryThreshold(5, 20), true); // 0.25
  assert.equal(meetsDiscoveryThreshold(2, 10), true); // 0.20
});

// ── cache read / write / staleness (temp file) ───────────────────────────────

function tmpFile(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'order-stats-')),
    'order-stats.json',
  );
}

const FIXTURE_STATS: ProductStat[] = [
  {
    code: 'P_1',
    name: 'חלב',
    brand: 'תנובה',
    sellingMethod: 'UNIT',
    timesOrdered: 12,
    totalOrders: 20,
    quantities: [1, 1, 2],
    orderDates: ['2026-06-01', '2026-06-08', '2026-06-12'],
    lastOrderDate: '2026-06-12',
  },
];

test('readCache returns null when the file is absent', () => {
  const p = path.join(os.tmpdir(), 'definitely-missing-order-stats-xyz.json');
  if (fs.existsSync(p)) fs.rmSync(p);
  assert.equal(readCache(p), null);
});

test('writeCache then readCache round-trips stats and meta', () => {
  const p = tmpFile();
  writeCache(FIXTURE_STATS, {
    scannedOrders: 20,
    medianOrderSize: 14,
    generatedAt: '2026-06-21',
  }, p);
  const cache = readCache(p);
  assert.ok(cache);
  assert.equal(cache!.scannedOrders, 20);
  assert.equal(cache!.medianOrderSize, 14);
  assert.equal(cache!.generatedAt, '2026-06-21');
  assert.deepEqual(cache!.stats, FIXTURE_STATS);
});

test('isStale is true past maxAgeDays, false within', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  assert.equal(isStale({ generatedAt: '2026-06-20' }, 14, now), false);
  assert.equal(isStale({ generatedAt: '2026-06-07' }, 14, now), false); // exactly 14
  assert.equal(isStale({ generatedAt: '2026-06-06' }, 14, now), true); // 15
});

test('todayISO returns a YYYY-MM-DD string', () => {
  assert.equal(todayISO(new Date('2026-06-21T23:30:00Z')), '2026-06-21');
});

// ── end-to-end selection (mirrors suggest.ts; pure, no network) ──────────────

test('cadence selection: due items ranked by overdue desc, one-offs excluded', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const stats: ProductStat[] = [
    // weekly milk: gaps 7,7,7 -> cadence 7, last 9 days ago -> overdue ~1.29, due
    { code: 'P_milk', name: 'חלב', brand: 'תנובה', sellingMethod: 'UNIT', timesOrdered: 12, totalOrders: 20,
      quantities: [1], orderDates: ['2026-05-29', '2026-06-05', '2026-06-12'], lastOrderDate: '2026-06-12' },
    // biweekly, last 5 days ago -> overdue ~0.35, not due
    { code: 'P_oil', name: 'שמן', brand: 'x', sellingMethod: 'UNIT', timesOrdered: 4, totalOrders: 20,
      quantities: [1], orderDates: ['2026-05-10', '2026-05-24', '2026-06-07', '2026-06-16'], lastOrderDate: '2026-06-16' },
    // monthly, last 40 days ago -> overdue ~1.4, due
    { code: 'P_rice', name: 'אורז', brand: 'y', sellingMethod: 'UNIT', timesOrdered: 5, totalOrders: 20,
      quantities: [1], orderDates: ['2026-03-13', '2026-04-12', '2026-05-12'], lastOrderDate: '2026-05-12' },
    // one-off -> no cadence, never suggested
    { code: 'P_once', name: 'משהו', brand: '', sellingMethod: 'UNIT', timesOrdered: 1, totalOrders: 20,
      quantities: [1], orderDates: ['2026-06-01'], lastOrderDate: '2026-06-01' },
  ];

  const due = stats
    .map((s) => {
      const cad = cadence(s.orderDates);
      if (cad === undefined) return null;
      const dsl = daysSince(s.lastOrderDate, now);
      const od = overdue(dsl, cad)!;
      return { code: s.code, cadence: cad, overdue: od, due: isDue(od) };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.due)
    .sort((a, b) => (b.overdue !== a.overdue ? b.overdue - a.overdue : a.cadence - b.cadence));

  assert.deepEqual(due.map((c) => c.code), ['P_rice', 'P_milk']);
  // P_oil not due, P_once has no cadence
  assert.equal(due.find((c) => c.code === 'P_oil'), undefined);
  assert.equal(due.find((c) => c.code === 'P_once'), undefined);
});
