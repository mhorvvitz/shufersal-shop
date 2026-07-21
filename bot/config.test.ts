import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedChatIds, loadBotConfig } from './config';
import { trimHistory } from './agent';
import type { Content } from '@google/genai';

test('parseAllowedChatIds: parses a comma-separated list, including negatives', () => {
  const ids = parseAllowedChatIds('123, -456 ,789');
  assert.deepEqual([...ids].sort((a, b) => a - b), [-456, 123, 789]);
});

test('parseAllowedChatIds: empty/undefined yields an empty set', () => {
  assert.equal(parseAllowedChatIds(undefined).size, 0);
  assert.equal(parseAllowedChatIds('').size, 0);
  assert.equal(parseAllowedChatIds('  ,  ').size, 0);
});

test('parseAllowedChatIds: throws on a non-integer entry', () => {
  assert.throws(() => parseAllowedChatIds('123,abc'), /Invalid chat ID/);
});

test('loadBotConfig: refuses to start with an empty allowlist', () => {
  assert.throws(
    () =>
      loadBotConfig({
        TELEGRAM_BOT_TOKEN: 't',
        GEMINI_API_KEY: 'k',
        MCP_AUTH_TOKEN: 'm',
      } as NodeJS.ProcessEnv),
    /TELEGRAM_ALLOWED_CHAT_IDS is empty/,
  );
});

test('loadBotConfig: throws when a required secret is missing', () => {
  assert.throws(
    () =>
      loadBotConfig({
        TELEGRAM_ALLOWED_CHAT_IDS: '123',
        GEMINI_API_KEY: 'k',
        MCP_AUTH_TOKEN: 'm',
      } as NodeJS.ProcessEnv),
    /Missing required environment variable: TELEGRAM_BOT_TOKEN/,
  );
});

test('loadBotConfig: fills defaults and parses the allowlist', () => {
  const cfg = loadBotConfig({
    TELEGRAM_BOT_TOKEN: 't',
    GEMINI_API_KEY: 'k',
    MCP_AUTH_TOKEN: 'm',
    TELEGRAM_ALLOWED_CHAT_IDS: '42',
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.geminiModel, 'gemini-2.5-flash');
  assert.equal(cfg.mcpServerUrl, 'http://localhost:3000/mcp');
  assert.equal(cfg.historyTurns, 10);
  assert.ok(cfg.allowedChatIds.has(42));
});

test('trimHistory: keeps only the last N turns (2 messages per turn)', () => {
  const mk = (i: number): Content => ({ role: 'user', parts: [{ text: `m${i}` }] });
  const history = Array.from({ length: 10 }, (_, i) => mk(i));
  const trimmed = trimHistory(history, 2); // keep last 4 messages
  assert.equal(trimmed.length, 4);
  assert.deepEqual(
    trimmed.map((c) => c.parts?.[0]?.text),
    ['m6', 'm7', 'm8', 'm9'],
  );
});

test('trimHistory: returns history unchanged when under the limit', () => {
  const history: Content[] = [{ role: 'user', parts: [{ text: 'hi' }] }];
  assert.equal(trimHistory(history, 10), history);
});
