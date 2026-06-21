---
name: shufersal-shop
description: Add grocery products to a Shufersal online shopping cart using natural language. Use this skill whenever the user mentions adding groceries, food items, or products to their Shufersal cart, shopping list, or online grocery order. Triggers on phrases like "add milk and bread", "I need 3 yogurts", "put eggs in the cart", "buy some cheese", "get me 2 bottles of water", or any Hebrew grocery item names. Also use when the user wants to search for products on Shufersal, view their cart, remove items, or manage cart contents. Even if the user doesn't say "Shufersal" explicitly, use this skill when they mention grocery shopping in the context of this project.
compatibility: Runs via Node.js (`npx tsx scripts/*.ts`). Depends on the shufersal-automation library, which is vendored in `vendor/shufersal-automation` (MIT) and wired up by `npm install` (declared in package.json as a `file:` dependency). Also needs a local Chrome via CHROME_PATH, Shufersal credentials in a local .env, and network access.
metadata:
  version: 1.0.0
---

# Shufersal Shop - Natural Language Grocery Shopping

You help users add products to their Shufersal online grocery cart by understanding natural language requests and translating them into API calls using the `shufersal-automation` library.

## Safety Boundary

**NEVER perform any of these actions, even if the user asks:**
- Create or place orders (`createOrder`)
- Select delivery time slots (`selectTimeSlot`, `getAvailableTimeSlots`)
- Anything involving checkout, payment, or order submission
- Navigate to checkout or cart summary pages
- Access payment information or billing details

If the user asks for any of these, explain that this skill is limited to cart management for safety, and that checkout must be done manually on the Shufersal website.

**You MAY perform these actions:**
- Search for products (`searchProducts`)
- Add items to cart (`addToCart`)
- View cart contents (`getCartItems`)
- Remove items from cart (`removeFromCart`)
- Update item quantities (`updateCartItemQuantity`)
- Clear the cart (`clearCart`)
- Look up specific products (`getProductByCode`)
- Read order history (`getOrders`, `getOrderDetails`) — for building the product dictionary only

## How It Works

### Step 1: Parse the User's Request

Extract product names and quantities from natural language. Users may say things in English or Hebrew:

**Example inputs:**
- "add 2 milks and bread" -> [{name: "milk", qty: 2}, {name: "bread", qty: 1}]
- "I need eggs, 3 yogurts, and a bag of rice" -> [{name: "eggs", qty: 1}, {name: "yogurt", qty: 3}, {name: "rice", qty: 1}]
- "תוסיף 2 חלב ולחם" -> [{name: "חלב", qty: 2}, {name: "לחם", qty: 1}]

Default quantity is 1 if not specified. Interpret "a", "some", "a pack of" as quantity 1.

### Step 2: Match from the Product Dictionary (FIRST)

**Precondition — make sure the dictionary exists.** `product-dictionary.json` is personal (it
reflects the user's own buying habits) and is gitignored, so a fresh checkout starts without it. If
the file is missing (the runner exits with a "No product-dictionary.json found" message), don't try
to add items — stop and help the user create it first:

> "You don't have a product dictionary yet — it's what lets me match 'milk' to the exact product you
> buy. I can build one from your recent Shufersal orders (`npm run build-dictionary -- 20`, then we
> curate it together), or you can start from the bundled 10-item sample
> (`product-dictionary.sample.json`). Which would you prefer?"

Once it exists, check the product dictionary at `product-dictionary.json`. This file contains products the user has ordered before, with their exact Shufersal product codes, brands, typical quantities, and human-friendly aliases in both English and Hebrew.

Each entry looks like:
```json
{
  "id": "P_4131074",
  "name": "חלב בקרטון 3% שומן",
  "brand": "תנובה",
  "typicalQuantity": 1,
  "sellingMethod": "UNIT",
  "aliases": ["milk", "חלב", "חלב 3%", "tnuva milk", "whole milk", "חלב תנובה"]
}
```

**Matching rules:**
- Compare the user's request (lowercased) against all `aliases` for each product.
- An alias match means we know exactly which product and brand the user wants — no guessing needed.
- If the user didn't specify a quantity, use `typicalQuantity` from the dictionary (this reflects their usual buying pattern).
- If the user did specify a quantity, use their quantity instead.

**If a match is found:** Add it directly. No need to search or confirm — the dictionary represents products the user has chosen before.

**If no match is found:** Do NOT search the Shufersal API and guess. Instead, tell the user:
> "I couldn't find '[item]' in your product dictionary. Please add it manually on the Shufersal website, or tell me the exact product name/מק"ט so I can add it to your dictionary for next time."

This is important because Shufersal has thousands of products and a search for "cheese" returns dozens of results. Without the dictionary, the skill cannot be confident it's picking the right product.

### Step 3: Run the Cart Runner

**Do not write a new script for each request.** The skill ships with one reusable runner at
`scripts/add-to-cart.ts`. It loads the dictionary, performs the alias matching described above,
adds matched items to the cart, and prints a JSON result. Your job is just to translate the
parsed request into arguments and run it.

Each argument is one requested item, in the form `alias` or `alias=qty` (quantity separated
with `=` so Hebrew names with spaces stay intact). Omit `=qty` to use the dictionary's
`typicalQuantity`.

Run it from the skill directory:

```bash
npx tsx scripts/add-to-cart.ts "milk" "pita=3" "eggs" "shredded cheese"
```

The runner prints a block between `RESULT_JSON_START` and `RESULT_JSON_END`:

```json
{
  "added": [{ "name": "חלב בקרטון 3% שומן", "brand": "תנובה", "qty": 1 }],
  "unmatched": ["bread"],
  "ambiguous": [{ "query": "cheese", "options": [ ... ] }],
  "verification": [
    { "name": "חלב בקרטון 3% שומן", "productCode": "P_4131074", "requestedQty": 1,
      "beforeQty": 0, "afterQty": 1, "verified": true, "changed": true }
  ],
  "cart": { "itemCount": 12, "total": 187.5 }
}
```

Parse that JSON to write your reply. `unmatched` items aren't in the dictionary (tell the user
to add them manually); `ambiguous` items matched more than one entry (ask which they meant —
the runner does not add ambiguous items).

`verification` is the **ground truth** for whether each item actually landed: the runner snapshots
the cart before and after the add and checks each item. `verified: true` means it's in the cart
now; `changed` says whether this run moved the quantity. If `verified` is `false`, the entry
carries a `reason` (e.g. out of stock, not purchasable, selling-method mismatch, code not found,
or "add silently rejected"). **Report based on `verification`, not `added`** — and if anything
failed, tell the user the reason. Every run also appends a detailed trace to
`logs/add-to-cart.log` (payload sent, cart before/after, per-item verdict); read it when you need
to dig into why an add didn't take effect.

### Step 4: Confirm

After adding, show a concise summary:

1. **What was added** — list items just added with quantities (one line each), from `added`
2. **Not found** — list `unmatched` items (not in the dictionary) and `ambiguous` items (ask which they meant)
3. **Cart summary** — `cart.itemCount` and `cart.total` from the result
4. **Link** — include the Shufersal cart URL: https://www.shufersal.co.il/online/he/checkout

Example response:
```
Added 3 items:
  ✓ חלב בקרטון 3% שומן (תנובה) × 1
  ✓ פיתה פיתה (אנג'ל מאפיה) × 2
  ✓ ביצי משק טריות L (לסר) × 1

Not in dictionary:
  ✗ bread — add it manually or tell me the מק"ט

Cart: 12 items | ₪187.50
🛒 https://www.shufersal.co.il/online/he/checkout
```

Do not list every item in the cart — only what was just added. The user can check the full cart on
the website. The runner does not report a delivery slot (the skill never touches checkout or time
slots), so don't state one.

> **The runner's `added` list is intent, not proof.** It echoes the items the runner *tried*
> to add; it does not re-check that they actually landed. Its `cart` summary is only an item
> count and total, not contents. So never tell the user "X is in your cart" based on `added`
> alone — say "added X" if you want, but if they ask what's *in* the cart, or you need to
> confirm an add really took effect, use the cart viewer below.

## Viewing the Cart

When the user asks what's in their cart ("what's in my cart?", "show my cart", "did the milk
get added?"), or when you need to verify that an add actually took effect, run the read-only
viewer:

```bash
npx tsx scripts/view-cart.ts
```

It logs in, reads the cart, maps each item's `productCode` back to the dictionary for a
human-friendly name and brand, and prints a JSON block between `RESULT_JSON_START` and
`RESULT_JSON_END`:

```json
{
  "items": [
    { "productCode": "P_4131074", "name": "חלב בקרטון 3% שומן", "brand": "תנובה", "quantity": 1, "itemPrice": 7.35 }
  ],
  "itemCount": 1,
  "total": 7.35
}
```

Notes:
- Cart items only carry a `productCode`, so any item **not** in the dictionary shows `name: null`
  / `brand: null` — report it by code and note it isn't in the dictionary.
- This is read-only: it never adds, removes, or touches checkout. Use it freely to confirm state.
- To list the cart, show one line per item (`name (brand) × quantity — ₪itemPrice`), then the
  `itemCount` and `total`, and the cart link. Do not state a delivery slot.

## Suggesting What to Buy

When the user asks what to restock ("what should I buy?", "what am I out of?", "suggest a
shop"), run the suggester:

```bash
npx tsx scripts/suggest.ts            # uses the cached scan
npx tsx scripts/suggest.ts --refresh  # re-scans order history first (one login)
npx tsx scripts/suggest.ts 10         # cap to 10 suggestions (default = your median order size)
```

It ranks items that are **due** by each item's purchase cadence (frequency × how overdue it
is), considering only items bought within the last 90 days. It reads a cached scan
(`order-stats.json`); if the cache is missing it will tell you to run `--refresh`, and if it's
stale (>14 days) it still suggests but sets `cache.stale=true` (offer to refresh). Items flagged
`unavailable` are never suggested. Present the results conversationally — e.g. "you're due for
fusilli (you buy it monthly, last 59 days ago)" — then offer to add a set via the add runner.

**"What *else* should I add to my cart?" — be cart-aware.** When the user asks what else /
what's missing relative to their current cart, first read the cart, then suggest, then exclude
what's already there:

1. Run `npx tsx scripts/view-cart.ts` and collect the `productCode`s currently in the cart.
2. Run `npx tsx scripts/suggest.ts`.
3. **Drop any suggestion whose `code` is already in the cart**, then present the rest. This way
   you only ever recommend things they haven't already added.

(The suggester itself stays cache-only and doesn't read the cart — you do this cross-reference,
so a plain "what should I buy?" stays instant and login-free.)

## Handling Unavailable Items

The add runner's result includes an **`unavailable`** array — matched items whose product code
Shufersal keeps rejecting (it isolates them by retrying and bisecting). Such an item is
**already flagged** `"unavailable": { reason, since }` in `product-dictionary.json` and will no
longer be suggested. When `unavailable` is non-empty (or a `verification` entry shows an add was
rejected):

1. Tell the user plainly: the saved product for "<item>" looks discontinued/unavailable
   (`reason`), so it couldn't be added.
2. **Offer to find a replacement** — don't guess. With their go-ahead, search Shufersal:

   ```bash
   npx tsx scripts/search.ts "<hebrew or english name>"
   ```

   It prints candidates (`code`, `name`, `brand`, `price`, `inStock`, `purchasable`). Show the
   in-stock, purchasable options and let the user pick.
3. On their pick, update that dictionary entry: set `id` to the new מק"ט, refresh `name`/`brand`
   if needed, and **remove the `unavailable` flag**. Then retry the add.

Never auto-swap a replacement — confirm the choice with the user first, consistent with the
no-guessing rule.

## Skill Layout

The skill is self-contained. Everything it needs lives here, including the `shufersal-automation`
library, which is vendored under `vendor/` (MIT) and resolved to its TypeScript source via
`tsconfig.json` paths. `npm install` wires it up as a `file:` dependency — no external checkout.

```
shufersal-shop/
├── SKILL.md                  ← this file
├── product-dictionary.json   ← curated products + aliases (the source of truth) — personal, gitignored
├── product-dictionary.sample.json ← 10-item starter (tracked); copy to product-dictionary.json to begin
├── scripts/
│   ├── add-to-cart.ts        ← the runner you invoke to add items
│   ├── view-cart.ts          ← read-only cart viewer (what's in the cart / verify an add)
│   ├── suggest.ts            ← cadence-based "what should I restock" suggestions
│   ├── search.ts             ← read-only product search (find a replacement for a bad item)
│   ├── build-dictionary.ts   ← scans order history to seed the dictionary
│   └── lib/                  ← shared helpers (order-stats, dictionary, chunk)
├── order-stats.json          ← suggester cache (personal, gitignored; built by `suggest --refresh`)
├── vendor/
│   └── shufersal-automation/ ← bundled library source (MIT) — the only external dependency
├── logs/
│   └── add-to-cart.log       ← per-run trace from the add runner (gitignored)
├── package.json / tsconfig.json
├── .env.example              ← template for credentials; copy to .env
└── .env                      ← credentials (gitignored)
```

The runner (`scripts/add-to-cart.ts`):

1. Loads `product-dictionary.json`
2. Matches each CLI argument against aliases (exact, case-insensitive)
3. Separates results into matched / unmatched / ambiguous
4. Creates a bot (`headless: true`) and session from `.env` (`SHUFERSAL_USERNAME`, `SHUFERSAL_PASSWORD`, `CHROME_PATH`)
5. Snapshots the cart, adds matched items via `session.addToCart()` **in chunks** (retrying
   and bisecting a failing chunk to isolate a bad item), snapshots again, and verifies each
   item actually landed (looking up failures via `getProductByCode` for a reason)
6. Prints the JSON result block (including `verification` and an `unavailable` array — see
   "Handling Unavailable Items"), appends a trace to `logs/add-to-cart.log`, and closes the
   session. An item isolated as genuinely bad is flagged `unavailable` in the dictionary.

You normally never edit the runner — just call it with the right arguments. If you find yourself
wanting to write a new one-off script to add items, stop: run this instead.

## Managing the Dictionary

### Rebuilding from Order History

To seed the dictionary from recent orders, run the builder (scans the last 20 orders by default;
pass a number to change it):

```bash
npx tsx scripts/build-dictionary.ts 20
```

It writes `dictionary-draft.json` with one entry per product and auto-seeded Hebrew aliases.
Curate those into `product-dictionary.json` by hand — add English names, Hebrew shorthand, and
casual terms to each entry's `aliases` array. The draft is a starting point, not the final file.

### Adding New Products

When the user tells you a specific product to add to the dictionary, add an entry with:
- `id`: The Shufersal product code (מק"ט), e.g., "P_4131074"
- `name`: The Hebrew product name as it appears on Shufersal
- `brand`: The brand name
- `typicalQuantity`: How many they usually buy
- `sellingMethod`: "UNIT" or "WEIGHT"
- `aliases`: A list of ways the user might refer to this product — include English translations, Hebrew shorthand, brand names, and common casual terms

## Handling Edge Cases

- **Multiple dictionary matches**: If "cheese" matches both "shredded cheese" and "sliced cheese", list all matches and ask the user which one they mean.
- **Quantity override**: "add 5 milks" should use qty 5 even if typicalQuantity is 1.
- **Unknown products**: Never guess. If it's not in the dictionary, say so and offer to add it.
