# Shufersal Shop Skill

A Claude skill for adding grocery products to a [Shufersal](https://www.shufersal.co.il) online shopping cart using natural language.

Say things like **"add milk, eggs, and 2 pitas"** and the skill translates that into the correct API calls using the [shufersal-automation](https://github.com/eshaham/shufersal-automation) library.

## Getting Started

Do these in order — **step 3 (your product dictionary) is what the skill needs before it can add anything.**

1. **Install** (Node.js + a local Chrome required — see [Prerequisites](#prerequisites)):
   ```bash
   git clone <this-repo>
   cd shufersal-shop
   npm install
   ```
2. **Add your credentials** — copy the template and fill it in (`.env` is gitignored):
   ```bash
   cp .env.example .env   # then edit with your Shufersal username, password, and CHROME_PATH
   ```
3. **Build your product dictionary (do this first).** The skill matches what you say against
   `product-dictionary.json` — a curated list of products *you* buy, with English/Hebrew aliases.
   It's personal (it reveals your shopping habits), so it's **gitignored and not included** — a fresh
   clone starts without one. Create it one of two ways:
   ```bash
   # Option A — build from your real order history, then curate the draft (recommended):
   npm run build-dictionary -- 20      # writes dictionary-draft.json from your last 20 orders
   #   ...then copy/curate entries into product-dictionary.json (add English names, casual terms)

   # Option B — start from the bundled 10-item sample:
   cp product-dictionary.sample.json product-dictionary.json
   ```
   If you skip this, the skill notices the file is missing and prompts you to create it before adding items.
4. **Use it.** Ask Claude *"add milk and 2 pitas"*, or run a script directly:
   ```bash
   npm run add -- "milk" "pita=2"
   npm run view                        # show current cart (read-only)
   ```

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

### The vendored library (git subtree)

`vendor/shufersal-automation` is a **git subtree** tracking
[eshaham/shufersal-automation](https://github.com/eshaham/shufersal-automation) on `main`, imported
with `--squash` (upstream history is collapsed into one commit per sync, not interleaved into ours).

**Golden rule: never edit anything under `vendor/shufersal-automation/`.** Local edits there turn
every upstream sync into a merge conflict. Everything the skill needs to adapt the library lives
*outside* the folder and should stay there:

- `tsconfig.json` — the `shufersal-automation` and `~/*` path aliases that resolve the library to its source
- `package.json` — the `file:vendor/shufersal-automation` dependency
- `.npmrc` — `install-links=false`, so `npm install` symlinks the vendored package instead of copying it

The subtree pulls the upstream repo in full (its `.github/`, `docs/`, configs, `package-lock.json`,
etc.), but only `src/` is ever used — `tsconfig.json` points the alias at `vendor/shufersal-automation/src/index.ts`.

**Pull upstream updates** (requires an `upstream` remote — add once with
`git remote add upstream https://github.com/eshaham/shufersal-automation.git`):

```bash
git subtree pull --prefix=vendor/shufersal-automation upstream main --squash
npm install   # re-link the package and refresh the library's own deps
```

### Prerequisites

- Node.js
- A local Chrome installation

### Install

See [Getting Started](#getting-started) above for the full ordered walkthrough (install →
credentials → build dictionary → use). `.env` holds your credentials and is gitignored:

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

The real `product-dictionary.json` is **personal and gitignored** — it's not committed, so each
checkout starts without one. The repo ships `product-dictionary.sample.json` (10 items) as a
tracked, shareable starter and format reference.

### Building the Dictionary

Two ways to create your `product-dictionary.json` (see [Getting Started](#getting-started) step 3):

- **From your orders (recommended):** `npm run build-dictionary -- 20` scans your last 20 orders and
  generates `dictionary-draft.json` (auto-seeded with Hebrew aliases). Then curate it into
  `product-dictionary.json` by adding English names and casual terms.
- **From the sample:** `cp product-dictionary.sample.json product-dictionary.json`, then extend it.

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
| `product-dictionary.json` | Your curated product list with aliases — **personal, gitignored** (create it on first use) |
| `product-dictionary.sample.json` | 10-item starter (tracked) — copy to `product-dictionary.json` to begin |
| `scripts/add-to-cart.ts` | The runner — matches items, adds them, and verifies each add |
| `scripts/view-cart.ts` | Read-only cart viewer (maps product codes back to dictionary names) |
| `scripts/build-dictionary.ts` | Scans order history to seed the dictionary |
| `logs/add-to-cart.log` | Per-run trace from the runner, for debugging adds (gitignored) |
| `vendor/shufersal-automation/` | Vendored library (MIT) as a git subtree of [eshaham/shufersal-automation](https://github.com/eshaham/shufersal-automation) — the only external dependency; don't edit (see [Setup](#the-vendored-library-git-subtree)) |
| `evals/` | Test cases for skill evaluation |
| `.env.example` | Template for credentials; copy to `.env` |
