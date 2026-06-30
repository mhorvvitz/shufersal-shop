import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCredentials, loadBrowserConnection } from './browser-connection';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test('loadCredentials: returns username/password when both set', () => {
  withEnv({ SHUFERSAL_USERNAME: 'u', SHUFERSAL_PASSWORD: 'p' }, () => {
    assert.deepEqual(loadCredentials(), { username: 'u', password: 'p' });
  });
});

test('loadCredentials: throws when either is missing', () => {
  withEnv({ SHUFERSAL_USERNAME: undefined, SHUFERSAL_PASSWORD: 'p' }, () => {
    assert.throws(() => loadCredentials());
  });
  withEnv({ SHUFERSAL_USERNAME: 'u', SHUFERSAL_PASSWORD: undefined }, () => {
    assert.throws(() => loadCredentials());
  });
});

test('loadBrowserConnection: CHROME_WS_ENDPOINT takes precedence over CHROME_PATH', () => {
  withEnv(
    { CHROME_WS_ENDPOINT: 'ws://remote:9222/devtools/browser/abc', CHROME_PATH: '/usr/bin/chrome' },
    () => {
      assert.deepEqual(loadBrowserConnection(), {
        browserWSEndpoint: 'ws://remote:9222/devtools/browser/abc',
      });
    },
  );
});

test('loadBrowserConnection: falls back to local CHROME_PATH', () => {
  withEnv({ CHROME_WS_ENDPOINT: undefined, CHROME_PATH: '/usr/bin/chrome' }, () => {
    assert.deepEqual(loadBrowserConnection(), {
      executablePath: '/usr/bin/chrome',
      headless: true,
    });
  });
});

test('loadBrowserConnection: throws when neither is set', () => {
  withEnv({ CHROME_WS_ENDPOINT: undefined, CHROME_PATH: undefined }, () => {
    assert.throws(() => loadBrowserConnection());
  });
});
