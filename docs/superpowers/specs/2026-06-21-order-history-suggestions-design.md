# Order-History Suggestions — Design

**Date:** 2026-06-21
**Status:** Approved (design); spec under review
**Skill:** shufersal-shop

## Problem

The skill can add items the user names, but it can't proactively answer "what should I
add to my cart?" based on what the user actually buys. The raw signal already exists —
`build-dictionary.ts` scans order history and computes per-product `timesOrdered` and
`lastOrderDate` — but it is discarded into a draft file sorted by frequency and never
surfaced as recommendations.

## Goal

A read-only suggester that recommends what to restock based on each item's purchase
**cadence** (some items are bought weekly, some biweekly, some ~monthly), surfacing items
that are **due** since their last order. Fast enough to run often, and it also grows the
product dictionary from recurring buys it discovers.

## Decisions (locked)

1. **Ranking:** per-item cadence model — estimate each item's typical purchase interval
   from order history (weekly / biweekly / ~monthly / …), track its last order date, and
   suggest items that are **due** (days since last purchase ≥ that item's cadence). Rank the
   due items by how overdue they are. No global popularity score.
2. **Data freshness:** cache scan results to a local file; suggestions read the cache
   instantly. Re-scan only on demand (`--refresh`) or when the cache is stale. Avoids the
   repeated logins that trigger Shufersal rate-limiting.
3. **Dictionary growth:** frequent buys not yet in the dictionary are folded into it, not
   just shown.
4. **Auto-add behavior:** discovered items are appended to `product-dictionary.json`
   automatically with Hebrew-name-derived aliases and `"needsCuration": true`. They become
   matchable immediately; alias enrichment happens later, non-blocking.
5. **Scope:** the add-runner bulk-add robustness fix (chunking/retry) is a **separate
   task**, not part of this spec.

## Architecture

The order-scan logic is extracted from `build-dictionary.ts` into a shared module so the
dictionary builder and the suggester share one code path.

```
scripts/
  lib/order-stats.ts     ← NEW: scanOrderHistory(), cache read/write
  build-dictionary.ts    ← refactored to use lib/order-stats (behavior unchanged)
  suggest.ts             ← NEW: the suggester
order-stats.json         ← NEW cache file (gitignored, personal like the dictionary)
```

### Components

**`lib/order-stats.ts`**
- `scanOrderHistory(session, ordersToScan): ProductStat[]` — logs nothing; takes an open
  session, returns per-product stats. Pulled out of `build-dictionary.ts` verbatim where
  possible. **Filters out non-product line items** (`isNonProduct`) — the online delivery
  fee (`P_1159`) and deposits (name matches `משלוח`/`פיקדון`) — so they never reach the
  dictionary, suggestions, or the median-order-size count. `suggest.ts` re-applies the same
  filter at cache-read time so a pre-filter cache can't reintroduce them.
- `ProductStat`: `{ code, name, brand, sellingMethod, timesOrdered, totalOrders,
  quantities: number[], orderDates: string[], lastOrderDate }`.
- `writeCache(stats, meta)` / `readCache()` — persist to `order-stats.json` with
  `{ scannedOrders, medianOrderSize, generatedAt, stats }`, where `medianOrderSize` is the
  median count of distinct products per scanned order. `readCache()` returns `null` if
  absent.
- `isStale(meta, maxAgeDays)` — true if `generatedAt` older than threshold (default 14
  days).

**`build-dictionary.ts`** (refactored)
- Creates a session, calls `scanOrderHistory(...)`, and additionally writes the cache via
  `writeCache(...)` (so building the dictionary also warms the suggester cache). Draft
  output and curation messaging unchanged.

**`suggest.ts`**
- `npx tsx scripts/suggest.ts [N]` — default N = the user's **median order size** (median
  number of distinct products per order across the scanned orders), computed from the cache.
  An explicit `[N]` argument overrides it.
- `--refresh` flag: open a session, run `scanOrderHistory`, `writeCache`, then suggest.
- Without `--refresh`: `readCache()`. If missing → print a clear "run with --refresh"
  message and exit (do **not** silently log in). If stale → still suggest, but mark
  `cache.stale = true` so the caller can mention it.
- Cross-reference each stat against `product-dictionary.json` by product code:
  - In dictionary → candidate suggestion (`inDictionary: true`).
  - Not in dictionary AND meets the discovery threshold (see below) → append an entry to
    `product-dictionary.json` with Hebrew-derived aliases (same alias-seeding logic as the
    builder) and `needsCuration: true`, then include as a suggestion (`inDictionary: true`,
    `autoAdded: true`).
- Read-only with respect to cart and checkout. Writes only local files
  (`order-stats.json`, `product-dictionary.json`). Stays within the skill safety boundary.

## Cadence model

The algorithm is deliberately simple: estimate each item's purchase **cadence**, then
suggest the items that are due.

Per product, from the cache:

- `cadence` = mean gap in days between consecutive `orderDates` containing the item — how
  often the user buys it. Undefined when `timesOrdered < 2` (a one-off; no cadence).
- `cadenceLabel` = `cadence` bucketed for display: weekly (≈7), biweekly (≈14), monthly
  (≈28–30), or "every N days" otherwise. Display only; ranking uses the raw `cadence`.
- `daysSinceLast = today − lastOrderDate`
- `overdue = daysSinceLast / cadence` — ≥ 1 means due (a full cadence has elapsed since the
  last purchase); > 1 means overdue.
- `due = cadence is defined AND overdue >= 1` (with a small tolerance, e.g. `overdue >= 0.9`,
  so a near-due weekly item isn't missed by a day).

**Selection & ranking:**
1. Consider only items with a defined cadence (`timesOrdered >= 2`). One-offs are never
   suggested — they have no pattern to predict from.
2. Keep items that are **`due`** AND were **bought within the recency window**
   (`RECENT_WINDOW_DAYS = 90`). The recency filter drops items the user appears to have
   stopped buying — a brief past phase (e.g. bought twice 8 months ago on a 5-day cadence)
   otherwise shows a huge `overdue` ratio and dominates the ranking.
3. Rank survivors by **restock score** `= frequency × overdue` (descending), so reliably
   bought staples outrank stale items that merely happen to be far past a short cadence.
   Tie-break by shorter cadence.
4. Take the top **N** (default = median order size). If fewer than N qualify, suggest only
   those — never pad with items that aren't due yet.

The output exposes the inputs (`cadence`, `cadenceLabel`, `daysSinceLast`, `overdue`,
`score`, `due`) so each suggestion is explainable: "due for milk — bought weekly, last
9 days ago."

### Discovery threshold (auto-add)

A non-dictionary item is auto-added only if it is genuinely recurring, not a one-off:
`timesOrdered >= 2` AND `frequency >= 0.15` (tunable). One-time purchases are ignored.

## Output

Prints a `RESULT_JSON` block between `RESULT_JSON_START` / `RESULT_JSON_END`, matching the
other scripts' convention:

```json
{
  "suggestions": [
    { "name": "חלב בקרטון 3% שומן", "brand": "תנובה", "code": "P_4131074",
      "timesOrdered": 12, "totalOrders": 20, "daysSinceLast": 9,
      "cadence": 7, "cadenceLabel": "weekly", "overdue": 1.29, "score": 0.77, "due": true,
      "inDictionary": true, "autoAdded": false }
  ],
  "autoAdded": [
    { "name": "...", "code": "...", "aliases": ["..."], "needsCuration": true }
  ],
  "cache": { "scannedOrders": 20, "medianOrderSize": 14, "generatedAt": "2026-06-21",
             "stale": false }
}
```

The caller (Claude) presents this conversationally — e.g. "You're due for milk — you buy it
weekly and last got it 9 days ago" — and offers to add a chosen set via the existing
`add-to-cart.ts` runner. (Reliable bulk add depends on the separate chunking fix.)

## Error handling

- **No cache + no `--refresh`:** print guidance to run `--refresh`; exit 0 without erroring.
- **Stale cache:** suggest anyway, set `cache.stale = true`.
- **Scan failure (`--refresh`):** surface the error and exit non-zero, like the other
  scripts; do not write a partial cache.
- **Dictionary write:** auto-added entries are appended; never rewrite/reorder existing
  entries. If the dictionary is missing, follow the existing precondition flow (help the
  user create it first) rather than creating one implicitly.

## Testing

- Unit-test the cadence helpers (`cadence`, `cadenceLabel` bucketing, `overdue`, `due` with
  tolerance, median-order-size, discovery threshold) with fixture stats — no network.
- Unit-test cache read/write/staleness with a temp file.
- Verify the `build-dictionary.ts` refactor is behavior-preserving (same draft output for a
  given fixture).
- Manual smoke test: `suggest.ts --refresh` once, then `suggest.ts` reads cache and prints a
  ranked list; confirm a known recurring non-dictionary item gets auto-added with
  `needsCuration: true`.

## Bad-item handling (cross-feature)

When `add-to-cart.ts` isolates a genuinely-bad item (a chunk that fails down to a single
item, e.g. a discontinued product that 500s), it flags that entry in
`product-dictionary.json` as `"unavailable": { reason, since }` and includes it in the
result's `unavailable` array. The suggester **skips any entry flagged `unavailable`**.
SKILL.md guides Claude to offer a replacement search (`scripts/search.ts`, read-only) and,
on the user's pick, swap the entry's `id` and clear the flag. Shared helpers live in
`scripts/lib/dictionary.ts` (`flagUnavailable`, `isUnavailable`, `summarizeFailure`).

## Cart-aware suggestions

"What *else* should I add to my cart?" is handled at the SKILL.md orchestration level, not
inside `suggest.ts` (which stays cache-only): Claude first runs `view-cart.ts`, then
`suggest.ts`, and excludes suggestions whose `code` is already in the cart before presenting
them. Keeping the cart read out of `suggest.ts` preserves its instant, login-free path.

## Out of scope

- Alias enrichment of `needsCuration` entries (manual/later).
- A `--exclude-cart` flag inside `suggest.ts` (would add a login to the cached path; the
  cart-aware flow above lives in SKILL.md instead).
