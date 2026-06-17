# Shufersal Shop Skill

A Claude skill for adding grocery products to a [Shufersal](https://www.shufersal.co.il) online shopping cart using natural language.

Say things like **"add milk, eggs, and 2 pitas"** and the skill translates that into the correct API calls using the [shufersal-automation](https://github.com/eshaham/shufersal-automation) library.

## How It Works

1. **You speak naturally** — English, Hebrew, or a mix. "Add apples and shredded cheese" or "תוסיף חלב ופיתה".
2. **Dictionary-first matching** — Your request is matched against `product-dictionary.json`, a curated list of products you've ordered before. Each product has human-friendly aliases in English and Hebrew, so "milk" resolves instantly to חלב בקרטון 3% תנובה without searching.
3. **No guessing** — If a product isn't in your dictionary, the skill tells you instead of picking a random search result. You add it manually once, and it's there forever.
4. **Quantities from habit** — If you don't specify a quantity, the skill uses your typical order quantity (e.g., you always buy 2 pitas, so "add pita" adds 2).
5. **Verified adds** — Every add is checked against the cart afterward, so the skill reports what actually landed (not just what it tried), with a reason when something fails.

## Safety

The skill is limited to **cart management only**. It cannot:

- Place orders or go to checkout
- Select delivery time slots
- Access payment or billing information

Checkout must be done manually on the Shufersal website.

## Setup

The skill is self-contained. Its one external dependency,
[shufersal-automation](https://github.com/eshaham/shufersal-automation) (MIT), is vendored under
`vendor/shufersal-automation`, so `npm install` wires it up locally — no external checkout or
registry access required. (It's vendored rather than installed as a package because the library is
consumed as TypeScript source via an internal `~/*` path alias, which only resolves when the
library is treated as first-party source.)

### Prerequisites

- Node.js
- A local Chrome installation

### Install

```bash
git clone <this-repo>
cd shufersal-shop
npm install
cp .env.example .env   # then edit .env with your details
```

`.env` holds your credentials (it is gitignored):

```
SHUFERSAL_USERNAME=your-username
SHUFERSAL_PASSWORD=your-password
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Install as a Claude Skill

Place this directory under your Claude skills location (e.g. a `shufersal-shop` folder in
`.claude/skills/`, or a junction/symlink pointing to this repo). The skill is invoked by the
`name` in `SKILL.md` (`shufersal-shop`), so it's available as `/shufersal-shop`.

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run add -- "milk" "pita=3"` | Add items to cart (the runner); verifies each add |
| `npm run view` | Show the current cart contents (read-only) |
| `npm run build-dictionary -- 20` | Scan the last 20 orders into `dictionary-draft.json` to seed the dictionary |
| `npm run typecheck` | Type-check the scripts |

(You can also call the scripts directly, e.g. `npx tsx scripts/add-to-cart.ts "milk" "pita=3"`.)

## Product Dictionary

`product-dictionary.json` is the core of the skill. Each entry looks like:

```json
{
  "id": "P_4131074",
  "name": "חלב בקרטון 3% שומן",
  "brand": "תנובה",
  "typicalQuantity": 1,
  "sellingMethod": "UNIT",
  "aliases": ["milk", "חלב", "חלב 3%", "whole milk", "חלב תנובה"]
}
```

### Building the Dictionary

Run `npm run build-dictionary -- 20` to scan your last 20 orders and generate
`dictionary-draft.json` (auto-seeded with Hebrew aliases). Then curate it into
`product-dictionary.json` by adding English names and casual terms.

### Adding Products

When the skill can't find a product, add a new entry with:
- `id` — Shufersal product code (מק"ט), e.g., `P_4131074`
- `name` — Hebrew product name as it appears on Shufersal
- `brand` — Brand name
- `typicalQuantity` — How many you usually buy
- `sellingMethod` — `"UNIT"` or `"WEIGHT"`
- `aliases` — Ways you might ask for it (English, Hebrew, brand names, shorthand)

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Claude skill instructions — how to parse requests, match products, add to cart |
| `product-dictionary.json` | Curated product list with aliases, built from your order history |
| `scripts/add-to-cart.ts` | The runner — matches items, adds them, and verifies each add |
| `scripts/view-cart.ts` | Read-only cart viewer (maps product codes back to dictionary names) |
| `scripts/build-dictionary.ts` | Scans order history to seed the dictionary |
| `logs/add-to-cart.log` | Per-run trace from the runner, for debugging adds (gitignored) |
| `vendor/shufersal-automation/` | Bundled library source (MIT) — the only external dependency |
| `evals/` | Test cases for skill evaluation |
| `.env.example` | Template for credentials; copy to `.env` |
