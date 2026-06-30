/**
 * Where to get a Chrome instance from. `shufersal-automation`'s `ShufersalBot` already
 * supports both: `browserWSEndpoint` makes it `puppeteer.connect()` to an already-running
 * (e.g. hosted/remote) Chrome instead of `puppeteer.launch()`-ing a local one.
 */
export interface BrowserConnection {
  executablePath?: string;
  browserWSEndpoint?: string;
  headless?: boolean;
}

export interface Credentials {
  username: string;
  password: string;
}

export function loadCredentials(): Credentials {
  const username = process.env['SHUFERSAL_USERNAME'];
  const password = process.env['SHUFERSAL_PASSWORD'];
  if (!username || !password) {
    throw new Error('SHUFERSAL_USERNAME and SHUFERSAL_PASSWORD must be set in .env');
  }
  return { username, password };
}

/**
 * `CHROME_WS_ENDPOINT` (a hosted/remote Chrome's WebSocket debugger URL) takes
 * precedence over `CHROME_PATH` (a local Chrome executable) when both are set.
 */
export function loadBrowserConnection(): BrowserConnection {
  const browserWSEndpoint = process.env['CHROME_WS_ENDPOINT'];
  if (browserWSEndpoint) {
    return { browserWSEndpoint };
  }
  const executablePath = process.env['CHROME_PATH'];
  if (executablePath) {
    return { executablePath, headless: true };
  }
  throw new Error(
    'Set either CHROME_WS_ENDPOINT (hosted/remote Chrome) or CHROME_PATH (local Chrome) in .env',
  );
}
