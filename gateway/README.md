# Telegram gateway

Lets someone who isn't in your Claude Code text the bot and have items land in your
Shufersal cart.

```
Telegram message
  → Cloudflare Worker      (authenticate, allowlist, forward)
  → POST /routines/{id}/fire
  → Claude Code cloud session   (reads SKILL.md, runs scripts/add-to-cart.ts)
  → scripts/telegram-send.ts    (replies)
```

Nothing here runs on your machine. The Worker is free-tier and stateless; the routine runs
on Anthropic's infrastructure and draws down your Claude Code subscription usage rather
than a separate API bill.

**Latency:** roughly one to three minutes end to end — most of it provisioning the session
container and driving a headless browser through Shufersal's login. The Worker sends an
immediate acknowledgement so nobody is left wondering.

---

## What you'll need

- A Telegram account (yours, plus whoever else will use the bot)
- A Cloudflare account — free tier is plenty
- Claude Code on the web enabled (Pro, Max, Team, or Enterprise)
- A hosted browser: [Browserless](https://browserless.io) or
  [Browserbase](https://browserbase.com). Cloud sessions have no desktop Chrome, so
  `BROWSER_PROVIDER=local` cannot work here.

---

## 1. Create the Telegram bot

Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts. Save the
token it gives you — that's `TELEGRAM_BOT_TOKEN`.

Then get the numeric user ID of everyone who should be allowed to use it. Each person
messages [@userinfobot](https://t.me/userinfobot) and sends you the number it replies with.
These become `ALLOWED_USER_IDS`, comma-separated.

Also generate a webhook secret now:

```bash
openssl rand -hex 32
```

That's `TELEGRAM_SECRET_TOKEN`. It's what proves an incoming request actually came from
Telegram and not from someone who found your Worker URL.

---

## 2. Configure the cloud environment

At [claude.ai/code](https://claude.ai/code), open your environment settings (or create a
new environment for this — recommended, since it will hold your Shufersal password).

**Environment variables:**

| Variable | Value |
| --- | --- |
| `SHUFERSAL_USERNAME` | your Shufersal login |
| `SHUFERSAL_PASSWORD` | your Shufersal password |
| `TELEGRAM_BOT_TOKEN` | from step 1 — the reply script needs it |
| `BROWSER_PROVIDER` | `browserless` |
| `BROWSERLESS_TOKEN` | your Browserless token |

**Network access:** the default **Trusted** allowlist does not include Telegram or
Shufersal, and requests to unlisted hosts fail with `403` and
`x-deny-reason: host_not_allowed`. Set network access to **Custom**, keep "include default
list of common package managers" checked (the SessionStart hook runs `npm install`), and
add:

```
api.telegram.org
www.shufersal.co.il
production-ams.browserless.io
```

Adjust the Browserless host if you picked a different region, or swap in
`connect.browserbase.com` if you're using Browserbase.

---

## 3. Create the routine

At [claude.ai/code/routines](https://claude.ai/code/routines), click **New routine**.

- **Instructions** — paste the fenced block from [`routine-prompt.md`](./routine-prompt.md)
- **Repositories** — add **both** `mhorvvitz/shufersal-shop` and
  `mhorvvitz/shufersal-shop-data`. The second holds `product-dictionary.json`, which is
  gitignored in the public repo; without it every request fails on a missing dictionary
- **Environment** — the one from step 2
- **Connectors** — remove all of them
- **Trigger** — choose **API**, then save

Now reopen the routine, click the pencil icon, and under **Select a trigger** →
**Add another trigger** → **API**, copy the URL and click **Generate token**.

- The `trig_...` segment of that URL is `ROUTINE_ID`
- The `sk-ant-oat01-...` value is `ROUTINE_TOKEN` — **shown once**, copy it now

Before wiring up Telegram, click **Run now** with some text like
`telegram_chat_id: <your id>` / `message: add milk` and watch the session. Getting the
environment right is the fiddly part, and it's much easier to debug in the session
transcript than through a webhook.

---

## 4. Deploy the Worker

```bash
cd gateway/worker
npm install
npx wrangler login

npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_SECRET_TOKEN
npx wrangler secret put ROUTINE_ID
npx wrangler secret put ROUTINE_TOKEN
npx wrangler secret put ALLOWED_USER_IDS   # e.g. 123456789,987654321

npx wrangler deploy
```

Deploy prints the Worker URL, something like
`https://shufersal-telegram-gateway.<subdomain>.workers.dev`.

---

## 5. Point Telegram at the Worker

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://shufersal-telegram-gateway.<subdomain>.workers.dev" \
  -d "secret_token=<TELEGRAM_SECRET_TOKEN>" \
  -d 'allowed_updates=["message"]'
```

Confirm it took:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

`pending_update_count` should be 0 and `last_error_message` absent. Then text your bot
"add milk" and watch the routine's run list.

---

## Security notes

**The allowlist is the whole access control.** Anyone can find a Telegram bot by username
and message it. Non-allowlisted senders are dropped silently — no reply, so the bot doesn't
confirm it exists. Keep `ALLOWED_USER_IDS` tight, and remember that adding someone gives
them your grocery cart, not a login.

**The bearer token is scoped to one routine.** It grants no read access, no access to other
routines, and no account access. Worst case for a leaked token is someone firing this
routine with arbitrary text — which is why the routine prompt reads only two named fields
and treats the message as a grocery request rather than instructions. Rotate it from the
same modal that generated it; generating a new token revokes the old one.

**Checkout stays manual.** The skill's safety boundary is unchanged: no order creation, no
delivery slots, no payment. The bot fills a cart. You still check out yourself.

**Edits are ignored.** Only new messages fire the routine. Editing a sent message won't
re-add the items.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| No reply at all, no run appears | Webhook not registered, or secret mismatch. Check `getWebhookInfo`, then `npx wrangler tail` while you send a message |
| "Couldn't reach the shopping assistant" | The fire call failed. `npx wrangler tail` shows the HTTP status: 401 = wrong token, 404 = wrong routine ID, 400 = missing beta header or routine paused, 429 = daily routine cap hit |
| Run appears but fails on the dictionary | The data repo isn't attached to the routine, or `link-personal-data.sh` didn't find it. Both repos must be selected |
| Run fails reaching Shufersal or Telegram | Network access still on **Trusted**. Look for `403` with `x-deny-reason: host_not_allowed` in the transcript |
| Run fails launching a browser | `BROWSER_PROVIDER` still `local`. There's no Chrome in a cloud session |
| Green run status but nothing happened | Green means the session exited without an infrastructure error, not that the task succeeded. Open the transcript |

## Cost

The Worker is free at this volume. Routine runs draw down your Claude Code subscription
usage and count against a per-account daily routine cap — visible at
[claude.ai/code/routines](https://claude.ai/code/routines). One message is one run, so a
chatty household can reach that cap; watch it for the first few days.
