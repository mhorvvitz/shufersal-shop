---
name: shufersal-cart
description: Add grocery products to a Shufersal online shopping cart using natural language. Use this skill whenever the user mentions adding groceries, food items, or products to their Shufersal cart, shopping list, or online grocery order. Triggers on phrases like "add milk and bread", "I need 3 yogurts", "put eggs in the cart", "buy some cheese", "get me 2 bottles of water", or any Hebrew grocery item names. Also use when the user wants to search for products on Shufersal, view their cart, remove items, or manage cart contents. Even if the user doesn't say "Shufersal" explicitly, use this skill when they mention grocery shopping in the context of this project.
---

# Shufersal Cart - Natural Language Grocery Shopping

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

Before searching Shufersal's API, check the product dictionary at `shufersal-cart-skill/product-dictionary.json`. This file contains products the user has ordered before, with their exact Shufersal product codes, brands, typical quantities, and human-friendly aliases in both English and Hebrew.

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

**Do not write a new script for each request.** There is one reusable runner at
`shufersal-automation/src/example/add-to-cart.ts`. It loads the dictionary, performs the
alias matching described above, adds matched items to the cart, and prints a JSON result.
Your job is just to translate the parsed request into arguments and run it.

Each argument is one requested item, in the form `alias` or `alias=qty` (quantity separated
with `=` so Hebrew names with spaces stay intact). Omit `=qty` to use the dictionary's
`typicalQuantity`.

Run it from the example directory:

```bash
cd shufersal-automation/src/example
npx tsx add-to-cart.ts "milk" "pita=3" "eggs" "shredded cheese"
```

The runner prints a block between `RESULT_JSON_START` and `RESULT_JSON_END`:

```json
{
  "added": [{ "name": "חלב בקרטון 3% שומן", "brand": "תנובה", "qty": 1 }],
  "unmatched": ["bread"],
  "ambiguous": [{ "query": "cheese", "options": [ ... ] }],
  "cart": { "itemCount": 12, "total": 187.5 }
}
```

Parse that JSON to write your reply. `unmatched` items aren't in the dictionary (tell the user
to add them manually); `ambiguous` items matched more than one entry (ask which they meant —
the runner does not add ambiguous items).

### Step 4: Confirm

After adding, show a concise summary:

1. **What was added** — list items just added with quantities (one line each)
2. **Not found** — list any items that weren't in the dictionary
3. **Cart summary** — total number of items in cart, total cost, and scheduled delivery time (if available)
4. **Link** — include the Shufersal cart URL: https://www.shufersal.co.il/online/he/checkout

Example response:
```
Added 3 items:
  ✓ חלב בקרטון 3% שומן (תנובה) × 1
  ✓ פיתה פיתה (אנג'ל מאפיה) × 2
  ✓ ביצי משק טריות L (לסר) × 1

Not in dictionary:
  ✗ bread — add it manually or tell me the מק"ט

Cart: 12 items | ₪187.50 | Delivery: Tuesday 10:00-12:00
🛒 https://www.shufersal.co.il/online/he/checkout
```

Do not list every item in the cart — only what was just added. The user can check the full cart on the website.

## The Runner Script

All cart additions go through the single reusable runner:
`shufersal-automation/src/example/add-to-cart.ts`. It:

1. Loads the product dictionary from `shufersal-cart-skill/product-dictionary.json`
2. Matches each CLI argument against dictionary aliases (exact, case-insensitive)
3. Separates results into matched / unmatched / ambiguous
4. Creates a bot (`headless: true`) and session from env vars (`SHUFERSAL_USERNAME`, `SHUFERSAL_PASSWORD`, `CHROME_PATH`)
5. Adds matched items via `session.addToCart()`, then reads the cart back
6. Prints the JSON result block and closes the session

You normally never edit this file — just call it with the right arguments. Only modify it if the
result format or matching behavior itself needs to change. If you find yourself wanting to write a
new one-off script to add items, stop: run this instead.

## Managing the Dictionary

### Rebuilding from Order History

To refresh the dictionary from recent orders, run the `build-cheatsheet.ts` script which scans the last 10 orders and outputs a raw `cheatsheet.json`. Then curate it into `product-dictionary.json` by adding human-friendly aliases.

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
