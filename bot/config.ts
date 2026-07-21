// Configuration for the Telegram bot front-end. All values come from the
// environment (see .env.example); nothing here is a secret literal.

export interface BotConfig {
  telegramToken: string;
  geminiApiKey: string;
  geminiModel: string;
  /** URL of the shufersal-shop MCP server's /mcp endpoint. */
  mcpServerUrl: string;
  /** Bearer token the MCP server expects (MCP_AUTH_TOKEN on the server side). */
  mcpAuthToken: string;
  /** Telegram chat IDs allowed to use the bot. Everyone else is ignored. */
  allowedChatIds: Set<number>;
  /** How many prior user/assistant turns to keep as context per chat. */
  historyTurns: number;
}

/**
 * Parse a comma-separated list of Telegram chat IDs (e.g. "123,-456") into a
 * set of numbers. Whitespace and empty entries are ignored. Throws if any entry
 * is not a valid integer, so a typo in the allowlist fails loudly rather than
 * silently letting no one (or the wrong someone) in.
 */
export function parseAllowedChatIds(raw: string | undefined): Set<number> {
  const ids = new Set<number>();
  if (!raw) return ids;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n)) {
      throw new Error(`Invalid chat ID in TELEGRAM_ALLOWED_CHAT_IDS: "${trimmed}"`);
    }
    ids.add(n);
  }
  return ids;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadBotConfig(env: NodeJS.ProcessEnv): BotConfig {
  const allowedChatIds = parseAllowedChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
  if (allowedChatIds.size === 0) {
    throw new Error(
      'TELEGRAM_ALLOWED_CHAT_IDS is empty. Refusing to start an open bot that anyone ' +
        'could use to drive your Shufersal cart. Set it to your own Telegram chat/user ID ' +
        '(message @userinfobot to find it).',
    );
  }
  return {
    telegramToken: required(env, 'TELEGRAM_BOT_TOKEN'),
    geminiApiKey: required(env, 'GEMINI_API_KEY'),
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    mcpServerUrl: env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp',
    mcpAuthToken: required(env, 'MCP_AUTH_TOKEN'),
    allowedChatIds,
    historyTurns: Number(env.BOT_HISTORY_TURNS) > 0 ? Number(env.BOT_HISTORY_TURNS) : 10,
  };
}
