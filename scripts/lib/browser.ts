import { ShufersalBot } from 'shufersal-automation';
import puppeteer from 'puppeteer-core';

/**
 * Where the Chrome the bot drives comes from.
 *
 * - `local`       — launch Chrome from CHROME_PATH on this machine (the original behaviour)
 * - `browserless` — connect to a Browserless instance (hosted or self-hosted)
 * - `browserbase` — create a Browserbase session over REST, then connect to it
 * - `cdp`         — connect to any CDP websocket endpoint you supply yourself
 */
export type ProviderName = 'local' | 'browserless' | 'browserbase' | 'cdp';

export const PROVIDERS: ProviderName[] = ['local', 'browserless', 'browserbase', 'cdp'];

export type BrowserConfig =
  | { provider: 'local'; executablePath: string; args: string[] }
  | { provider: 'browserless'; baseUrl: string; token: string }
  | {
      provider: 'browserbase';
      apiKey: string;
      projectId: string;
      proxyCountry?: string;
    }
  | { provider: 'cdp'; endpoint: string };

// Browserless runs in SFO, LON and AMS. Amsterdam is the closest to Israel, so it is the
// sane default for a Shufersal-only skill; override with BROWSERLESS_URL for another region.
const BROWSERLESS_DEFAULT_URL = 'wss://production-ams.browserless.io';
const BROWSERBASE_API = 'https://api.browserbase.com/v1/sessions';

function missing(varName: string, provider: ProviderName): Error {
  return new Error(
    `BROWSER_PROVIDER=${provider} requires ${varName} to be set in .env (see .env.example).`,
  );
}

/**
 * Read the browser configuration out of the environment. Pure and synchronous: it validates
 * and normalizes, but performs no network calls, so it can be unit-tested and so a
 * misconfiguration fails immediately instead of halfway through a login.
 *
 * Defaults to `local` when BROWSER_PROVIDER is unset, which keeps existing .env files working.
 */
export function parseBrowserConfig(env: NodeJS.ProcessEnv = process.env): BrowserConfig {
  const raw = (env['BROWSER_PROVIDER'] ?? 'local').trim().toLowerCase();
  if (!PROVIDERS.includes(raw as ProviderName)) {
    throw new Error(
      `Unknown BROWSER_PROVIDER "${raw}". Supported values: ${PROVIDERS.join(', ')}.`,
    );
  }
  const provider = raw as ProviderName;

  switch (provider) {
    case 'local': {
      const executablePath = env['CHROME_PATH'];
      if (!executablePath) throw missing('CHROME_PATH', provider);
      // Escape hatch for environments Chrome refuses to start in unaided — notably
      // containers and WSL, which usually need --no-sandbox.
      const args = (env['CHROME_ARGS'] ?? '').split(/[\s,]+/).filter(Boolean);
      return { provider, executablePath, args };
    }
    case 'browserless': {
      const token = env['BROWSERLESS_TOKEN'];
      if (!token) throw missing('BROWSERLESS_TOKEN', provider);
      const baseUrl = (env['BROWSERLESS_URL'] ?? BROWSERLESS_DEFAULT_URL).replace(/\/+$/, '');
      return { provider, baseUrl, token };
    }
    case 'browserbase': {
      const apiKey = env['BROWSERBASE_API_KEY'];
      if (!apiKey) throw missing('BROWSERBASE_API_KEY', provider);
      const projectId = env['BROWSERBASE_PROJECT_ID'];
      if (!projectId) throw missing('BROWSERBASE_PROJECT_ID', provider);
      const proxyCountry = env['BROWSERBASE_PROXY_COUNTRY']?.trim().toUpperCase() || undefined;
      return { provider, apiKey, projectId, proxyCountry };
    }
    case 'cdp': {
      const endpoint = env['BROWSER_WS_ENDPOINT'];
      if (!endpoint) throw missing('BROWSER_WS_ENDPOINT', provider);
      return { provider, endpoint };
    }
  }
}

/** Replace anything token-shaped in a URL with `***`, so endpoints are safe to log. */
export function redactEndpoint(endpoint: string): string {
  return endpoint.replace(
    /([?&](?:token|apiKey|api_key|key)=)[^&]+/gi,
    (_match, prefix: string) => `${prefix}***`,
  );
}

/** One line describing the configured browser, with credentials redacted — safe for logs. */
export function describeBrowserConfig(config: BrowserConfig): string {
  switch (config.provider) {
    case 'local':
      return config.args.length > 0
        ? `local Chrome (${config.executablePath}, args: ${config.args.join(' ')})`
        : `local Chrome (${config.executablePath})`;
    case 'browserless':
      return `Browserless (${config.baseUrl})`;
    case 'browserbase':
      return config.proxyCountry
        ? `Browserbase (project ${config.projectId}, proxy ${config.proxyCountry})`
        : `Browserbase (project ${config.projectId})`;
    case 'cdp':
      return `remote CDP (${redactEndpoint(config.endpoint)})`;
  }
}

/** Build the websocket endpoint for a Browserless instance. */
export function browserlessEndpoint(config: Extract<BrowserConfig, { provider: 'browserless' }>) {
  const separator = config.baseUrl.includes('?') ? '&' : '?';
  return `${config.baseUrl}${separator}token=${encodeURIComponent(config.token)}`;
}

interface BrowserbaseSession {
  id: string;
  connectUrl: string;
}

/**
 * Ask Browserbase for a fresh browser session. Unlike Browserless, Browserbase has no static
 * websocket URL — you create a session over REST and connect to the URL it hands back.
 */
export async function createBrowserbaseSession(
  config: Extract<BrowserConfig, { provider: 'browserbase' }>,
): Promise<BrowserbaseSession> {
  const body: Record<string, unknown> = { projectId: config.projectId };
  if (config.proxyCountry) {
    // Shufersal serves (and sometimes gates) by region, so an Israeli exit IP matters.
    body['proxies'] = [
      { type: 'browserbase', geolocation: { country: config.proxyCountry } },
    ];
  }

  const response = await fetch(BROWSERBASE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Browserbase session creation failed: ${String(response.status)} ${response.statusText}${
        detail ? ` — ${detail.slice(0, 300)}` : ''
      }`,
    );
  }

  const session = (await response.json()) as Partial<BrowserbaseSession>;
  if (!session.connectUrl) {
    throw new Error('Browserbase session creation returned no connectUrl');
  }
  return { id: session.id ?? '(unknown)', connectUrl: session.connectUrl };
}

export interface BrowserHandle {
  bot: ShufersalBot;
  provider: ProviderName;
  /** Token-redacted description of what we connected to. */
  description: string;
  close(): Promise<void>;
}

/**
 * Create the ShufersalBot every runner drives, pointed at whichever browser the environment
 * selects. Callers must `await handle.close()` when done — for hosted providers that is what
 * ends (and stops billing for) the remote session.
 */
export async function createBot(env: NodeJS.ProcessEnv = process.env): Promise<BrowserHandle> {
  const config = parseBrowserConfig(env);
  const description = describeBrowserConfig(config);

  const bot =
    config.provider === 'local'
      ? new ShufersalBot({
          executablePath: config.executablePath,
          headless: true,
          chromiumArgs: config.args.length > 0 ? config.args : undefined,
        })
      : new ShufersalBot({ browserWSEndpoint: await resolveEndpoint(config) });

  return {
    bot,
    provider: config.provider,
    description,
    close: async () => {
      await bot.terminate();
    },
  };
}

/**
 * Actually reach the configured browser and report its version, then let it go.
 *
 * `createBot` deliberately connects lazily (ShufersalBot dials out on first use), so it proves
 * nothing on its own — this is what the doctor command uses to verify a hosted setup before
 * any Shufersal credentials are involved.
 */
export async function probeBrowser(config: BrowserConfig): Promise<string> {
  const browser =
    config.provider === 'local'
      ? await puppeteer.launch({
          executablePath: config.executablePath,
          headless: true,
          args: config.args,
        })
      : await puppeteer.connect({ browserWSEndpoint: await resolveEndpoint(config) });

  try {
    return await browser.version();
  } finally {
    // Close, not disconnect: for a hosted provider this is what ends the billed session.
    await browser.close();
  }
}

async function resolveEndpoint(config: BrowserConfig): Promise<string> {
  switch (config.provider) {
    case 'browserless':
      return browserlessEndpoint(config);
    case 'browserbase':
      return (await createBrowserbaseSession(config)).connectUrl;
    case 'cdp':
      return config.endpoint;
    case 'local':
      throw new Error('resolveEndpoint is not applicable to the local provider');
  }
}
