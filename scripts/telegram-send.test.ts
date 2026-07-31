import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from './telegram-send';

test('splitMessage: short text is a single chunk', () => {
  assert.deepEqual(splitMessage('added milk and bread'), ['added milk and bread']);
});

test('splitMessage: every chunk stays within the limit', () => {
  const text = 'x'.repeat(10_000);
  for (const part of splitMessage(text, 4096)) {
    assert.ok(part.length <= 4096, `chunk of ${part.length} exceeds limit`);
  }
});

test('splitMessage: no content is lost', () => {
  const lines = Array.from({ length: 500 }, (_, i) => `item ${i}`).join('\n');
  const rejoined = splitMessage(lines, 200).join('\n');
  // Splitting trims at the seams, so compare on non-whitespace content.
  assert.equal(rejoined.replace(/\s+/g, ''), lines.replace(/\s+/g, ''));
});

test('splitMessage: prefers breaking on a newline', () => {
  const text = 'a'.repeat(150) + '\n' + 'b'.repeat(150);
  const parts = splitMessage(text, 200);
  assert.equal(parts[0], 'a'.repeat(150));
  assert.equal(parts[1], 'b'.repeat(150));
});

test('splitMessage: falls back to a hard cut when the newline is too early', () => {
  // Newline at index 5 is well under half the limit — breaking there would waste a send.
  const text = 'aaaaa\n' + 'b'.repeat(300);
  const parts = splitMessage(text, 100);
  assert.equal(parts[0]!.length, 100);
});

test('splitMessage: handles Hebrew text without splitting mid-line', () => {
  const line = 'חלב תנובה 3% שומן';
  const text = Array.from({ length: 40 }, () => line).join('\n');
  const parts = splitMessage(text, 200);
  for (const part of parts) {
    assert.ok(part.length <= 200);
    // Each chunk should consist of whole lines.
    for (const l of part.split('\n')) assert.equal(l, line);
  }
});
