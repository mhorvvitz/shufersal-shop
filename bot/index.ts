#!/usr/bin/env node
import { Bot } from 'grammy';
import type { Content } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { loadBotConfig } from './config';
import { createAgent } from './agent';

// Load env from the project's .env (see .env.example). On a hosted deployment
// these usually come from the platform's env/secrets, which is fine — dotenv
// only fills in vars that aren't already set.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Telegram caps a message at 4096 chars; keep a margin.
const MAX_TELEGRAM_MESSAGE = 3800;

function log(message: string, data?: unknown): void {
  const suffix = data === undefined ? '' : ' ' + JSON.stringify(data);
  process.stderr.write(`[${new Date().toISOString()}] ${message}${suffix}\n`);
}

async function main(): Promise<void> {
  const config = loadBotConfig(process.env);
  const agent = await createAgent(config);
  const bot = new Bot(config.telegramToken);

  // One short conversation history per chat, kept in memory (bounded by
  // config.historyTurns). Restarting the bot forgets context — fine for a
  // personal grocery assistant.
  const histories = new Map<number, Content[]>();

  bot.command('start', (ctx) =>
    ctx.reply(
      'Shufersal shopping assistant. Tell me what to add — e.g. "add milk and 2 pitas", ' +
        '"what should I buy this week?", or "show my cart". I only manage the cart; you check ' +
        'out yourself on the Shufersal website.',
    ),
  );

  bot.command('reset', (ctx) => {
    histories.delete(ctx.chat.id);
    return ctx.reply('Cleared our conversation history.');
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;

    if (!config.allowedChatIds.has(chatId)) {
      // Not on the allowlist. Log the ID so the owner can add themselves, and
      // tell the sender plainly rather than leaving them wondering.
      log('rejected message from non-allowlisted chat', { chatId });
      await ctx.reply(
        `You're not authorized to use this bot. (Your chat ID is ${chatId}.)`,
      );
      return;
    }

    const text = ctx.message.text;
    try {
      await ctx.replyWithChatAction('typing');
      const history = histories.get(chatId) ?? [];
      const { reply, history: nextHistory } = await agent.respond(history, text);
      histories.set(chatId, nextHistory);
      await ctx.reply(reply.slice(0, MAX_TELEGRAM_MESSAGE));
    } catch (err) {
      log('failed to handle message', { chatId, error: String(err) });
      await ctx.reply('Something went wrong handling that. Please try again in a moment.');
    }
  });

  bot.catch((err) => {
    log('bot error', { error: String(err.error) });
  });

  const shutdown = async (signal: string): Promise<void> => {
    log(`received ${signal}, shutting down`);
    await bot.stop();
    await agent.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  log('starting Telegram bot (long polling)', {
    model: config.geminiModel,
    mcpServerUrl: config.mcpServerUrl,
    allowedChats: config.allowedChatIds.size,
  });
  await bot.start();
}

main().catch((err) => {
  log('fatal error starting bot', { error: String(err) });
  process.exit(1);
});
