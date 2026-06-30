# 🛒 Shufersal Shop — order Israeli groceries by just telling Claude what you need

**Fill your [Shufersal](https://www.shufersal.co.il) online cart by typing a sentence.** This is a
[Claude Code](https://claude.com/claude-code) skill that turns plain language — English, Hebrew, or
a mix — into a ready-to-review grocery cart.

> *"add milk, eggs, and 2 pitas"* → three items in your cart, the right brands, in seconds.
> *"what should I buy this week?"* → a smart restock list based on what you actually order.

If you've ever searched **how to order groceries from Shufersal faster**, wanted to **automate
Shufersal online shopping**, or wished your **Israeli supermarket** order could just *remember what
you buy* — this is that. No more hunting through thousands of products to re-find the same חלב,
קוטג', and פיתות every single week.

---

## Why people use it

Online grocery shopping in Israel is repetitive: every week you search the same products, scroll
past dozens of near-identical results, and rebuild basically the same basket. This skill does that
part for you.

- **🗣️ Order in one sentence** — say what you want the way you'd say it to a person, in Hebrew or English.
- **🎯 Gets *your* products** — it learns the exact brands and sizes you actually buy, so "milk" means *your* milk, not a guess.
- **🔁 Knows what you're due for** — it can look at your order history and suggest what to restock, by how often you really buy each thing.
- **🛡️ Safe by design** — it only manages your cart. It never checks out, pays, or books delivery. You always do the final review.
- **🧠 Powered by Claude** — runs as a skill inside Claude Code, so it's conversational, not another form to fill in.

## What you can say

```
"add milk, eggs, and 2 pitas"
"תוסיף קוטג' ולחם וחומוס"
"remove the olive oil and honey"
"here's my list — add it and remove anything in the cart that isn't on it"
"what should I buy this week?"
"what else should I add to my cart?"
"show me what's in my cart"
```

When something isn't on your product list, it doesn't guess — it offers to **search Shufersal,
show you real options, and remember your pick** for next time. And when a product you usually buy
has been discontinued, it tells you and offers to find a replacement, instead of silently adding
the wrong thing.

## Who it's for

- You shop at **Shufersal online** and want it to be faster and less repetitive.
- You use **Claude Code** (desktop app or CLI).
- **You don't need to be a developer.** If you're comfortable copying a few commands into a terminal
  once during setup, you're good — day to day, you just talk to Claude.

## What it will and won't do

For your safety and peace of mind, the skill is limited to **building your cart**:

| ✅ It can | ❌ It will never |
|----------|-----------------|
| Add, remove, and update items | Place an order or go to checkout |
| Show you what's in your cart | Enter payment or billing info |
| Suggest what to restock | Book a delivery slot |
| Find replacement products | Spend a single shekel without you |

You review the cart and check out yourself on the Shufersal website. The skill never touches money.

---

## Get started

You'll need [Node.js](https://nodejs.org), a local Google Chrome, and a Shufersal online account.
Setup is a few one-time commands; after that you just talk to Claude.

1. **Get the skill:**
   ```bash
   git clone https://github.com/mhorvvitz/shufersal-shop.git
   cd shufersal-shop
   npm install
   ```
2. **Add your Shufersal login** (kept locally in `.env`, never committed):
   ```bash
   cp .env.example .env   # then fill in your Shufersal username, password, and CHROME_PATH
   ```
3. **Set up your product list** — this is what lets "milk" map to the exact product you buy. It's
   personal, so it isn't shipped with the repo. Build it from your real order history (recommended)
   or start from the bundled sample:
   ```bash
   npm run build-dictionary -- 20   # reads your last 20 orders into a draft to curate
   #   — or —
   cp product-dictionary.sample.json product-dictionary.json   # 10-item starter
   ```
4. **Use it from Claude Code** — make the skill available (see
   [Install as a Claude skill](#install-as-a-claude-skill)) and just ask: *"add milk and 2 pitas"*,
   *"what should I buy?"*, *"what else should I add to my cart?"*

> **Want to see it work before connecting your account?** Try the suggester with sample data, no
> credentials needed:
> ```bash
> cp product-dictionary.sample.json product-dictionary.json
> npm run sample-stats && npm run suggest
> ```

You can also drive it from the terminal without Claude:

```bash
npm run add -- "milk" "pita=2"        # add items (verified against the cart)
npm run remove -- "honey" "olive oil" # remove items (by alias or product code), verified
npm run view                          # show current cart (read-only)
npm run suggest                       # what should I restock?
npm run search -- "חלב 3%"            # find a product (one or many queries)
```

---

## 💬 Feedback, ideas, and bug reports — please!

**This skill gets better with real-world use, and your input genuinely shapes it.** Whether you're a
weekly Shufersal shopper or just curious:

- 🐛 **Something didn't work?** [Open an issue](https://github.com/mhorvvitz/shufersal-shop/issues) —
  include what you said and what happened.
- 💡 **Idea or feature request?** We'd love to hear how you'd want to shop. Open an issue or start a
  discussion.
- ⭐ **Find it useful?** Star the repo — it helps other Israeli shoppers find it.
- 🛠️ **Want to contribute?** PRs welcome (see the reference below).

No feedback is too small. "I wish it did X" is exactly what we want to hear.

---

## How it works

1. **You speak naturally** — English, Hebrew, or a mix.
2. **It matches against your product list** (`product-dictionary.json`) — a curated set of the
   products *you* buy, each with friendly aliases, so "milk" resolves instantly to
   חלב בקרטון 3% תנובה without searching.
3. **It never guesses** — if something isn't on your list, it doesn't add a random search result.
   Instead it offers to search Shufersal, shows you real in-stock options to pick from, and saves
   your choice so it's matched directly next time.
4. **Quantities follow your habits** — skip the number and it uses your usual amount (always buy 2
   pitas? "add pita" adds 2).
5. **Every add is verified** — it checks the cart afterward and reports what actually landed, with a
   reason when something doesn't.
6. **Resilient and self-improving** — big adds are chunked and retried so one bad item can't sink the
   basket; discontinued products are flagged and dropped from suggestions; and recurring buys it
   spots in your history get folded into your list automatically.

---

## Reference

### Install as a Claude skill

Place this directory under your Claude skills location — a `shufersal-shop` folder in
`.claude/skills/`, or a junction/symlink pointing at this repo (so edits stay in one place). The
skill is invoked by the `name` in `SKILL.md`, so it shows up as `/shufersal-shop`.

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run add -- "milk" "pita=3"` | Add items to cart (the runner); chunks, retries, and verifies each add |
| `npm run remove -- "honey" "P_123"` | Remove items by dictionary alias or raw product code; verifies each item is actually gone |
| `npm run view` | Show the current cart contents (read-only) |
| `npm run suggest` | Suggest what to restock from the cached order scan (`-- N` caps the count, `-- --refresh` re-scans) |
| `npm run search -- "חלב 3%"` | Read-only product search; takes one or many queries in a single login (`-- --limit N "q1" "q2"`) |
| `npm run sample-stats` | Write a sample `order-stats.json` (aligned to the sample dictionary) to try the suggester without a scan |
| `npm run build-dictionary -- 20` | Scan the last 20 orders into `dictionary-draft.json` (also warms the suggester cache) |
| `npm run typecheck` | Type-check the scripts |

(You can also call scripts directly, e.g. `npx tsx scripts/add-to-cart.ts "milk" "pita=3"`.) Run the
unit tests with `npx tsx --test scripts/lib/*.test.ts scripts/*.test.ts`.

### Restock suggestions

Ask *"what should I buy?"* and the skill suggests items you're **due** to restock:

- It scans your order history once into a local cache (`order-stats.json`), then ranks each item by
  its **purchase cadence** — how often you buy it (weekly / biweekly / monthly / …) and how overdue
  it is.
- It favors reliable staples and ignores items you haven't bought in ~90 days, so brief past one-offs
  don't clutter the list. Default count is your **median order size** (`npm run suggest -- 10` to cap).
- **Cart-aware:** *"what else should I add to my cart?"* reads your current cart first and excludes
  what's already in it.

```bash
npm run suggest -- --refresh   # re-scan order history (one login), refresh the cache
npm run suggest                # read the cache (instant); prompts to --refresh if missing/stale
```

**Try it without your own data** (no credentials, no scan):

```bash
cp product-dictionary.sample.json product-dictionary.json
npm run sample-stats           # writes a sample order-stats.json, dated relative to today
npm run suggest
```

`sample-stats` **overwrites** `order-stats.json` — rebuild your real one anytime with
`npm run suggest -- --refresh`.

### When a product becomes unavailable

Shufersal product codes go stale as items get discontinued. When an add for a specific item keeps
failing, the skill flags that entry in your product list (`"unavailable": { reason, since }`), stops
suggesting it, and offers to find a replacement:

```bash
npm run search -- "חמאת בוטנים"   # read-only search for a replacement
```

Pick an in-stock result and the skill updates that entry's product code (מק"ט) and clears the flag.

### Removing items and cart cleanup

Ask to *"remove the olive oil"* and the skill takes it out — then double-checks the cart to confirm
it's actually gone, the same way adds are verified.

```bash
npm run remove -- "olive oil" "honey"     # by alias
npm run remove -- "P_8076800195057"       # by raw product code
```

It also handles *"add my list and remove anything in the cart that isn't on it."* It reads your
cart, works out what's on your list versus what isn't, and **shows you exactly what it will remove
before deleting anything** — removals are hard to undo, so it confirms first.

### When something isn't on your list

If you ask for something that isn't in your product list, the skill doesn't silently add a guess.
With your go-ahead it searches Shufersal (in Hebrew, where the catalogue lives), shows the in-stock
options, lets you pick, and **saves your choice to your list** so it matches directly next time. The
search runs every term in a single login:

```bash
npm run search -- --limit 6 "גבינת פטה" "עגבניות שרי" "מפיות"
```

### Your product list (`product-dictionary.json`)

This is the heart of the skill. Each entry looks like:

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

Entries may also carry two fields the skill manages automatically: `needsCuration: true` (auto-added
from your history — aliases still want a human pass) and `unavailable: { reason, since }` (the
product code repeatedly failed to add).

Your real `product-dictionary.json` is **personal and gitignored** — it reflects your shopping
habits, so it's never committed. The repo ships `product-dictionary.sample.json` (10 items) as a
shareable starter and format reference.

**Adding a product by hand:** create an entry with the Shufersal code (`id` / מק"ט), Hebrew `name`,
`brand`, `typicalQuantity`, `sellingMethod` (`"UNIT"` or `"WEIGHT"`), and `aliases` (the ways you'd
ask for it, in English and Hebrew).

### The vendored library (git subtree) — for maintainers

The skill is self-contained. Its one external dependency,
[shufersal-automation](https://github.com/eshaham/shufersal-automation) (MIT), is vendored under
`vendor/shufersal-automation` as a **git subtree**, so `npm install` wires it up locally — no
external checkout or registry access. (It's vendored rather than installed as a package because the
library is consumed as TypeScript source via an internal `~/*` path alias.)

**Golden rule: never edit anything under `vendor/shufersal-automation/`.** Local edits there turn
every upstream sync into a merge conflict. The adapters live *outside* the folder: `tsconfig.json`
(path aliases), `package.json` (the `file:` dependency), and `.npmrc` (`install-links=false`).

**Pull upstream updates** (needs an `upstream` remote —
`git remote add upstream https://github.com/eshaham/shufersal-automation.git`):

```bash
git subtree pull --prefix=vendor/shufersal-automation upstream main --squash
npm install
```

### Prerequisites

- [Node.js](https://nodejs.org)
- A Chrome instance — either a local Google Chrome install (`CHROME_PATH`) or a
  hosted/remote headless Chrome (`CHROME_WS_ENDPOINT`) — see below
- A Shufersal online account

`.env` holds your credentials and is gitignored:

```
SHUFERSAL_USERNAME=your-username
SHUFERSAL_PASSWORD=your-password
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Using a hosted headless Chrome instead of local Chrome

By default the scripts launch your local Chrome (`CHROME_PATH`). If you'd rather not
keep a Chrome install around — e.g. running the skill on a machine without a desktop,
or pointing it at an already-running browser — set `CHROME_WS_ENDPOINT` in `.env` to a
Chrome DevTools WebSocket URL instead:

```
CHROME_WS_ENDPOINT=ws://your-host:9222/devtools/browser/<id>
```

When set, it takes precedence over `CHROME_PATH`: the bot connects to that existing
Chrome (`puppeteer.connect()`) instead of launching a new one. Any Chrome that exposes
a remote-debugging WebSocket endpoint works — a self-hosted
[browserless](https://www.browserless.io/) or `chrome-headless-shell` container, or a
managed browser-as-a-service provider. You're responsible for keeping that Chrome
instance running and reachable from wherever you run the scripts; the skill itself
doesn't manage or provision it.

Most managed providers fold their auth token into the URL itself (e.g.
`wss://chrome.browserless.io?token=YOUR_API_KEY`) — copy whatever connection URL your
provider gives you as-is into `CHROME_WS_ENDPOINT`; there's no separate credential
field to fill in. Treat that URL as a secret, the same as your Shufersal password: keep
it out of version control (`.env` is already gitignored).

### Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Claude skill instructions — how to parse requests, match products, add/remove, suggest, find unmatched items, and handle unavailable ones |
| `product-dictionary.json` | Your curated product list with aliases — **personal, gitignored** (create it on first use) |
| `product-dictionary.sample.json` | 10-item starter (tracked) — copy to `product-dictionary.json` to begin |
| `scripts/add-to-cart.ts` | The add runner — matches items, adds them (chunked + retried), verifies each add, flags unavailable items |
| `scripts/remove-from-cart.ts` | The remove runner — removes by alias or product code, verifies each item is gone |
| `scripts/view-cart.ts` | Read-only cart viewer |
| `scripts/suggest.ts` | Cadence-based restock suggestions from the cached order scan |
| `scripts/search.ts` | Read-only product search; one or many queries per login (find a product not on your list, or a replacement) |
| `scripts/build-dictionary.ts` | Scans order history to seed the dictionary (and warm the suggester cache) |
| `scripts/sample-stats.ts` | Generates a sample `order-stats.json` to try the suggester with no scan |
| `scripts/lib/` | Shared helpers: `order-stats`, `dictionary`, `chunk`, `browser-connection` — each with unit tests |
| `order-stats.json` | Suggester cache — **personal, gitignored** |
| `logs/add-to-cart.log` | Per-run trace from the add runner (gitignored) |
| `logs/remove-from-cart.log` | Per-run trace from the remove runner (gitignored) |
| `vendor/shufersal-automation/` | Vendored library (MIT) as a git subtree — don't edit (see "The vendored library" above) |
| `evals/` | Test cases for skill evaluation |
| `.env.example` | Template for credentials; copy to `.env` |

---

*Not affiliated with or endorsed by Shufersal. Uses the open-source
[shufersal-automation](https://github.com/eshaham/shufersal-automation) library. Use it with your own
account, at your own discretion.*
