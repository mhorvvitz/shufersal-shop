/**
 * Telegram -> Claude Code routine bridge.
 *
 * Telegram POSTs an update here; we validate it, check the sender against an allowlist,
 * and fire the shufersal-shop routine with the message text. The routine does the actual
 * work in a Claude Code cloud session and replies via scripts/telegram-send.ts.
 *
 * This Worker deliberately does no shopping logic. It is a doorman: authenticate, filter,
 * forward, acknowledge.
 */

export interface Env {
  /** Bot token from @BotFather — used only to send the "on it" acknowledgement. */
  TELEGRAM_BOT_TOKEN: string;
  /** Shared secret registered with setWebhook; Telegram echoes it on every request. */
  TELEGRAM_SECRET_TOKEN: string;
  /** Routine ID from the API trigger modal. Prefixed `trig_`, despite the docs' param name. */
  ROUTINE_ID: string;
  /** Per-routine bearer token, prefixed `sk-ant-oat01-`. Shown once at generation. */
  ROUTINE_TOKEN: string;
  /** Comma-separated Telegram user IDs permitted to use the bot. */
  ALLOWED_USER_IDS: string;
}

const FIRE_BETA_HEADER = 'experimental-cc-routine-2026-04-01';
const ANTHROPIC_VERSION = '2023-06-01';
/** The /fire endpoint caps `text` at 65,536 chars; stay well under it. */
const MAX_FIRE_TEXT = 4000;

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { id?: number; first_name?: string; username?: string };
  };
}

/**
 * Compare two secrets without leaking length or content through timing. Worth the few
 * lines: this header is the only thing standing between the open internet and a routine
 * that can spend your Claude usage.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseAllowlist(raw: string): Set<number> {
  return new Set(
    raw
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id !== 0),
  );
}

/**
 * Build the payload the routine reads. Kept as simple labelled lines because the routine
 * receives it as an opaque string inside <routine-fire-payload> — there is no schema on
 * the other end, just a prompt reading these fields.
 */
function buildFireText(chatId: number, sender: string, message: string): string {
  const trimmed =
    message.length > MAX_FIRE_TEXT ? message.slice(0, MAX_FIRE_TEXT) + ' […truncated]' : message;
  return [`telegram_chat_id: ${chatId}`, `telegram_sender: ${sender}`, `message: ${trimmed}`].join(
    '\n',
  );
}

async function fireRoutine(env: Env, text: string): Promise<void> {
  const res = await fetch(
    `https://api.anthropic.com/v1/claude_code/routines/${env.ROUTINE_ID}/fire`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ROUTINE_TOKEN}`,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FIRE_BETA_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(`fire failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
}

async function sendMessage(env: Env, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Anything without the shared secret is not Telegram. Reject loudly.
    const presented = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!secretsMatch(presented, env.TELEGRAM_SECRET_TOKEN)) {
      return new Response('Unauthorized', { status: 401 });
    }

    // From here on, always answer 200. A non-2xx makes Telegram redeliver the same update,
    // which for us would mean firing the routine (and adding groceries) more than once.
    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response('ok', { status: 200 });
    }

    // Only fresh messages. Edits are ignored on purpose: re-firing on an edit would add
    // the same items to the cart a second time.
    const message = update.message;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id;
    const userId = message?.from?.id;

    if (!text || chatId === undefined || userId === undefined) {
      return new Response('ok', { status: 200 });
    }

    // Silent drop for anyone not on the allowlist — no reply, so the bot doesn't confirm
    // its own existence to a stranger who guessed the username.
    if (!parseAllowlist(env.ALLOWED_USER_IDS).has(userId)) {
      console.warn(`Rejected message from unlisted user ${userId}`);
      return new Response('ok', { status: 200 });
    }

    const sender = message?.from?.first_name ?? message?.from?.username ?? String(userId);

    try {
      await fireRoutine(env, buildFireText(chatId, sender, text));
      // The routine takes a minute or two to provision a container, so say something now.
      await sendMessage(env, chatId, '🛒 On it — I\'ll reply when the cart is updated.');
    } catch (err) {
      // Never surface the raw error to Telegram: it can contain the routine token.
      console.error(`Failed to fire routine: ${String(err)}`);
      await sendMessage(env, chatId, "Couldn't reach the shopping assistant. Try again shortly.");
    }

    return new Response('ok', { status: 200 });
  },
};
