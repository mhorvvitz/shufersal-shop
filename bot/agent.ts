import { GoogleGenAI, mcpToTool, type Content } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { BotConfig } from './config';
import { SYSTEM_PROMPT } from './system-prompt';

export interface Agent {
  /** Handle one user message, returning the reply text and the updated history. */
  respond(history: Content[], userText: string): Promise<{ reply: string; history: Content[] }>;
  close(): Promise<void>;
}

/**
 * Keep only the most recent `turns` user/model messages so per-chat context
 * stays bounded. History entries are plain text turns; the within-turn tool
 * calls are handled by the model's automatic function calling and are not
 * retained here.
 */
export function trimHistory(history: Content[], turns: number): Content[] {
  const max = Math.max(0, turns) * 2;
  return history.length > max ? history.slice(history.length - max) : history;
}

/**
 * Wire a Gemini model to the shufersal-shop MCP server. The model is given the
 * MCP tools via mcpToTool; the genai SDK's automatic function calling executes
 * the tool calls against the MCP client and loops until the model produces a
 * final text reply, so the whole "add milk and 2 pitas" flow works exactly as
 * it does in Claude Code.
 */
export async function createAgent(config: BotConfig): Promise<Agent> {
  const mcpClient = new Client({ name: 'shufersal-telegram-bot', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(config.mcpServerUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.mcpAuthToken}` } },
  });
  await mcpClient.connect(transport);

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  async function respond(
    history: Content[],
    userText: string,
  ): Promise<{ reply: string; history: Content[] }> {
    const contents: Content[] = [...history, { role: 'user', parts: [{ text: userText }] }];

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [mcpToTool(mcpClient)],
      },
    });

    const reply = response.text?.trim() || 'Sorry, I could not produce a response. Please try again.';
    const nextHistory = trimHistory(
      [...contents, { role: 'model', parts: [{ text: reply }] }],
      config.historyTurns,
    );
    return { reply, history: nextHistory };
  }

  async function close(): Promise<void> {
    await mcpClient.close();
  }

  return { respond, close };
}
