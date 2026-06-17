# Shufersal Cart Skill

A Claude skill for adding grocery products to a [Shufersal](https://www.shufersal.co.il) online shopping cart using natural language.

Say things like **"add milk, eggs, and 2 pitas"** and the skill translates that into the correct API calls using the [shufersal-automation](https://github.com/eshaham/shufersal-automation) library.

## How It Works

1. **You speak naturally** — English, Hebrew, or a mix. "Add apples and shredded cheese" or "תוסיף חלב ופיתה".
2. **Dictionary-first matching** — Your request is matched against `product-dictionary.json`, a curated list of products you've ordered before. Each product has human-friendly aliases in English and Hebrew, so "milk" resolves instantly to חלב בקרטון 3% תנובה without searching.
3. **No guessing** — If a product isn't in your dictionary, the skill tells you instead of picking a random search result. You add it manually once, and it's there forever.
4. **Quantities from habit** — If you don't specify a quantity, the skill uses your typical order quantity (e.g., you always buy 2 pitas, so "add pita" adds 2).

## Safety

The skill is limited to **cart management only**. It cannot:

- Place orders or go to checkout
- Select delivery time slots
- Access payment or billing information

Checkout must be done manually on the Shufersal website.

## Setup

### Prerequisites

- [shufersal-automation](https://github.com/eshaham/shufersal-automation) installed and configured
- Environment variables: `SHUFERSAL_USERNAME`, `SHUFERSAL_PASSWORD`, `CHROME_PATH`

### Install as a Claude Skill

Place this directory where your Claude skills are configured, or point your skill path to it.

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

Run `build-cheatsheet.ts` in the shufersal-automation repo to scan your last N orders and generate a raw product list. Then curate it into `product-dictionary.json` by adding aliases.

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
| `evals/` | Test cases for skill evaluation |
