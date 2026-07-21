import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBrowserLock } from './mcp-tools';

test('withBrowserLock: runs calls one at a time, in arrival order', async () => {
  const events: string[] = [];
  let active = 0;
  let maxActive = 0;

  const task = (label: string, delayMs: number) =>
    withBrowserLock(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push(`start:${label}`);
      await new Promise((r) => setTimeout(r, delayMs));
      events.push(`end:${label}`);
      active--;
      return label;
    });

  // Kick off three at once; each should fully finish before the next starts.
  const results = await Promise.all([task('a', 20), task('b', 5), task('c', 1)]);

  assert.equal(maxActive, 1, 'never more than one running at a time');
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(events, [
    'start:a',
    'end:a',
    'start:b',
    'end:b',
    'start:c',
    'end:c',
  ]);
});

test('withBrowserLock: a failing call does not block later calls', async () => {
  const failing = withBrowserLock(async () => {
    throw new Error('boom');
  });
  await assert.rejects(failing, /boom/);

  // The queue must still accept and run work after a rejection.
  const after = await withBrowserLock(async () => 'ok');
  assert.equal(after, 'ok');
});
