import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, bisect } from './chunk';

test('chunk: empty input yields no chunks', () => {
  assert.deepEqual(chunk([], 8), []);
});

test('chunk: fewer items than size yields a single chunk', () => {
  assert.deepEqual(chunk([1, 2, 3], 8), [[1, 2, 3]]);
});

test('chunk: exact multiple of size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [
    [1, 2],
    [3, 4],
  ]);
});

test('chunk: ragged final chunk preserves order', () => {
  // The 19-item case from the bug report, at the default MAX_CHUNK of 8.
  const items = Array.from({ length: 19 }, (_, i) => i + 1);
  const chunks = chunk(items, 8);
  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((c) => c.length),
    [8, 8, 3],
  );
  // Flattening must reproduce the original order exactly.
  assert.deepEqual(chunks.flat(), items);
});

test('chunk: size of 1 yields singletons', () => {
  assert.deepEqual(chunk([1, 2, 3], 1), [[1], [2], [3]]);
});

test('chunk: rejects non-positive or non-integer sizes', () => {
  assert.throws(() => chunk([1], 0));
  assert.throws(() => chunk([1], -2));
  assert.throws(() => chunk([1], 1.5));
});

test('bisect: single element cannot be split further', () => {
  assert.equal(bisect([1]), null);
});

test('bisect: empty array cannot be split', () => {
  assert.equal(bisect([]), null);
});

test('bisect: even length splits evenly', () => {
  assert.deepEqual(bisect([1, 2, 3, 4]), { left: [1, 2], right: [3, 4] });
});

test('bisect: odd length puts the extra element on the left', () => {
  assert.deepEqual(bisect([1, 2, 3]), { left: [1, 2], right: [3] });
});

test('bisect: recursively narrows to a single offending item', () => {
  // Simulate isolating item `4` as the only one that fails, by always
  // following the half that still contains it down to size 1.
  let current: number[] = [1, 2, 3, 4, 5, 6, 7];
  const bad = 4;
  let guard = 0;
  while (current.length > 1) {
    const halves = bisect(current);
    assert.ok(halves, 'should be able to bisect while length > 1');
    current = halves!.left.includes(bad) ? halves!.left : halves!.right;
    assert.ok(guard++ < 10, 'bisection must terminate');
  }
  assert.deepEqual(current, [bad]);
});
