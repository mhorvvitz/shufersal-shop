// Send a Telegram reply. Used by the routine to answer the person who texted the bot.
//
//   npx tsx scripts/telegram-send.ts <chatId> "your message"
//   echo "your message" | npx tsx scripts/telegram-send.ts <chatId>
//
// Reads TELEGRAM_BOT_TOKEN from the environment (or .env locally). Messages longer than
// Telegram's 4096-character cap are split across several sends.
import './lib/env';

const API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_CHARS = 4096;

function requireBotToken(): string {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN must be set (environment variable, or .env locally)');
  }
  return token;
}

/**
 * Split text into Telegram-sized chunks, preferring to break on a newline so a reply
 * doesn't get cut mid-word. Exported for tests.
 */
export function splitMessage(text: string, limit = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = window.lastIndexOf('\n');
    // Only break on a newline if it isn't so early that we'd send a near-empty chunk.
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

async function sendChunk(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
  });

  if (!res.ok) {
    // Telegram puts the useful reason in the body, not the status text.
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(`sendMessage failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

async function main(): Promise<void> {
  const [chatId, ...rest] = process.argv.slice(2);

  if (!chatId) {
    console.error('Usage: npx tsx scripts/telegram-send.ts <chatId> "message"');
    process.exit(1);
  }

  const text = rest.length > 0 ? rest.join(' ') : (await readStdin()).trim();
  if (!text) {
    console.error('Refusing to send an empty message.');
    process.exit(1);
  }

  const token = requireBotToken();
  for (const chunk of splitMessage(text)) {
    await sendChunk(token, chatId, chunk);
  }
  process.stderr.write(`Sent ${text.length} chars to chat ${chatId}\n`);
}

// Only run when invoked directly, so the test file can import splitMessage.
if (require.main === module) {
  main().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
