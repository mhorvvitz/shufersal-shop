import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserlessEndpoint,
  describeBrowserConfig,
  parseBrowserConfig,
  redactEndpoint,
} from './browser';

test('parse: defaults to local so existing .env files keep working', () => {
  const config = parseBrowserConfig({ CHROME_PATH: '/usr/bin/google-chrome' });
  assert.deepEqual(config, {
    provider: 'local',
    executablePath: '/usr/bin/google-chrome',
    args: [],
  });
});

test('parse: CHROME_ARGS splits on commas or whitespace and drops empties', () => {
  const bySpace = parseBrowserConfig({
    CHROME_PATH: '/usr/bin/chrome',
    CHROME_ARGS: '--no-sandbox --disable-gpu',
  });
  const byComma = parseBrowserConfig({
    CHROME_PATH: '/usr/bin/chrome',
    CHROME_ARGS: ' --no-sandbox, --disable-gpu ',
  });
  const expected = ['--no-sandbox', '--disable-gpu'];
  assert.deepEqual(bySpace.provider === 'local' && bySpace.args, expected);
  assert.deepEqual(byComma.provider === 'local' && byComma.args, expected);
});

test('parse: local without CHROME_PATH names the missing variable', () => {
  assert.throws(() => parseBrowserConfig({}), /CHROME_PATH/);
});

test('parse: provider name is case- and whitespace-insensitive', () => {
  const config = parseBrowserConfig({
    BROWSER_PROVIDER: '  BrowserLess ',
    BROWSERLESS_TOKEN: 't0ken',
  });
  assert.equal(config.provider, 'browserless');
});

test('parse: unknown provider lists the supported values', () => {
  assert.throws(
    () => parseBrowserConfig({ BROWSER_PROVIDER: 'selenium' }),
    /Supported values: local, browserless, browserbase, cdp/,
  );
});

test('parse: browserless defaults to the region nearest Israel and strips trailing slashes', () => {
  assert.deepEqual(parseBrowserConfig({ BROWSER_PROVIDER: 'browserless', BROWSERLESS_TOKEN: 'k' }), {
    provider: 'browserless',
    baseUrl: 'wss://production-ams.browserless.io',
    token: 'k',
  });

  assert.deepEqual(
    parseBrowserConfig({
      BROWSER_PROVIDER: 'browserless',
      BROWSERLESS_TOKEN: 'k',
      BROWSERLESS_URL: 'ws://localhost:3000/',
    }),
    { provider: 'browserless', baseUrl: 'ws://localhost:3000', token: 'k' },
  );
});

test('parse: browserless without a token names the missing variable', () => {
  assert.throws(
    () => parseBrowserConfig({ BROWSER_PROVIDER: 'browserless' }),
    /BROWSERLESS_TOKEN/,
  );
});

test('parse: browserbase requires both the key and the project', () => {
  assert.throws(
    () => parseBrowserConfig({ BROWSER_PROVIDER: 'browserbase', BROWSERBASE_PROJECT_ID: 'p' }),
    /BROWSERBASE_API_KEY/,
  );
  assert.throws(
    () => parseBrowserConfig({ BROWSER_PROVIDER: 'browserbase', BROWSERBASE_API_KEY: 'k' }),
    /BROWSERBASE_PROJECT_ID/,
  );
});

test('parse: browserbase normalizes the proxy country and treats blank as unset', () => {
  const base = {
    BROWSER_PROVIDER: 'browserbase',
    BROWSERBASE_API_KEY: 'k',
    BROWSERBASE_PROJECT_ID: 'p',
  };
  assert.deepEqual(parseBrowserConfig({ ...base, BROWSERBASE_PROXY_COUNTRY: ' il ' }), {
    provider: 'browserbase',
    apiKey: 'k',
    projectId: 'p',
    proxyCountry: 'IL',
  });
  assert.deepEqual(parseBrowserConfig({ ...base, BROWSERBASE_PROXY_COUNTRY: '   ' }), {
    provider: 'browserbase',
    apiKey: 'k',
    projectId: 'p',
    proxyCountry: undefined,
  });
});

test('parse: cdp passes the endpoint through', () => {
  assert.deepEqual(
    parseBrowserConfig({ BROWSER_PROVIDER: 'cdp', BROWSER_WS_ENDPOINT: 'ws://1.2.3.4:9222' }),
    { provider: 'cdp', endpoint: 'ws://1.2.3.4:9222' },
  );
  assert.throws(() => parseBrowserConfig({ BROWSER_PROVIDER: 'cdp' }), /BROWSER_WS_ENDPOINT/);
});

test('browserlessEndpoint: appends the token, respecting an existing query string', () => {
  assert.equal(
    browserlessEndpoint({ provider: 'browserless', baseUrl: 'wss://x.io', token: 'abc' }),
    'wss://x.io?token=abc',
  );
  assert.equal(
    browserlessEndpoint({
      provider: 'browserless',
      baseUrl: 'wss://x.io/chromium?timeout=60000',
      token: 'a b',
    }),
    'wss://x.io/chromium?timeout=60000&token=a%20b',
  );
});

test('redactEndpoint: hides token-shaped query parameters', () => {
  assert.equal(redactEndpoint('wss://x.io?token=secret'), 'wss://x.io?token=***');
  assert.equal(
    redactEndpoint('wss://connect.browserbase.com?apiKey=secret&sessionId=abc'),
    'wss://connect.browserbase.com?apiKey=***&sessionId=abc',
  );
  assert.equal(redactEndpoint('ws://localhost:9222'), 'ws://localhost:9222');
});

test('describeBrowserConfig: never echoes a secret', () => {
  const descriptions = [
    describeBrowserConfig({ provider: 'local', executablePath: '/usr/bin/chrome', args: [] }),
    describeBrowserConfig({ provider: 'browserless', baseUrl: 'wss://x.io', token: 'sEcReT' }),
    describeBrowserConfig({
      provider: 'browserbase',
      apiKey: 'sEcReT',
      projectId: 'proj',
      proxyCountry: 'IL',
    }),
    describeBrowserConfig({ provider: 'cdp', endpoint: 'wss://x.io?token=sEcReT' }),
  ];
  for (const description of descriptions) {
    assert.doesNotMatch(description, /sEcReT/);
  }
  assert.match(descriptions[3]!, /token=\*\*\*/);
});
