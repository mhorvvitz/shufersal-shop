import { requireCredentials } from './lib/env';
import { createBot, parseBrowserConfig, describeBrowserConfig, probeBrowser } from './lib/browser';

// Connectivity check for whichever browser BROWSER_PROVIDER selects — the first thing to run
// after pointing the skill at a hosted service. Strictly read-only: it logs in and counts the
// cart, but never adds, removes, or touches checkout.
//
//   npx tsx scripts/check-browser.ts             (config + browser + Shufersal login)
//   npx tsx scripts/check-browser.ts --no-login  (config + browser reachability only)
async function main(): Promise<void> {
  const skipLogin = process.argv.slice(2).includes('--no-login');

  // Parse first: a bad provider or a missing token should fail here, not after a 30s connect.
  const config = parseBrowserConfig();
  console.log(`Provider:  ${config.provider}`);
  console.log(`Target:    ${describeBrowserConfig(config)}`);

  // Fail on missing credentials before spending time (and, on a hosted plan, money) connecting.
  const credentials = skipLogin ? null : requireCredentials();

  const startedAt = Date.now();
  const version = await probeBrowser(config);
  console.log(`Browser:   ${version} (reached in ${String(Date.now() - startedAt)}ms)`);

  if (!credentials) {
    console.log('\nBrowser reachable. Re-run without --no-login to also verify Shufersal login.');
    return;
  }

  const browser = await createBot();
  const session = await browser.bot.createSession(credentials.username, credentials.password);
  try {
    const items = await session.getCartItems();
    console.log(`Login:     ok (cart currently holds ${String(items.length)} item(s))`);
    console.log('\nAll good — this browser can drive Shufersal.');
  } finally {
    await session.close();
    await browser.close();
  }
}

/** Failure hints worth printing, chosen by which provider was actually in play. */
function troubleshooting(provider: string | null): string {
  switch (provider) {
    case null:
      return 'Fix the configuration in .env — see .env.example for every supported provider.';
    case 'local':
      return (
        'Local Chrome usually fails because CHROME_PATH points at the wrong binary, or because ' +
        'Chrome will not start unaided in this environment (containers and WSL typically need ' +
        'CHROME_ARGS=--no-sandbox). A hosted browser avoids both — see the "Hosted headless ' +
        'browser" section of the README.'
      );
    default:
      return (
        'Hosted providers commonly fail for one of: a wrong or expired token, a websocket URL ' +
        'the provider does not serve (Browserless v2 wants a /chromium path), or Shufersal ' +
        'refusing a non-Israeli exit IP — see the "Hosted headless browser" section of the README.'
      );
  }
}

main().catch((err: unknown) => {
  console.error('\nCheck failed:', err instanceof Error ? err.message : err);
  // parseBrowserConfig may itself be what failed, in which case there is no provider to blame.
  let provider: string | null = null;
  try {
    provider = parseBrowserConfig().provider;
  } catch {
    provider = null;
  }
  console.error(`\n${troubleshooting(provider)}`);
  process.exit(1);
});
