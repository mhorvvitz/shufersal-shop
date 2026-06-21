// Pure, side-effect-free helpers for splitting a batch of items into chunks and
// for bisecting a failing chunk to isolate a genuinely bad item. These are kept
// free of any Shufersal / network concerns so they can be unit-tested in
// isolation (see chunk.test.ts).

/**
 * Split `items` into consecutive chunks of at most `size` elements, preserving
 * order. The final chunk may be smaller. Returns an empty array for an empty
 * input. `size` must be a positive integer.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk size must be a positive integer, got ${String(size)}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Split an array into two halves for failure-isolation. A single-element array
 * (or empty array) cannot be bisected further, signalled by `left`/`right`
 * being undefined — callers treat that as "this lone item is the bad one".
 * The left half gets the extra element when the length is odd.
 */
export function bisect<T>(
  items: readonly T[],
): { left: T[]; right: T[] } | null {
  if (items.length <= 1) {
    return null;
  }
  const mid = Math.ceil(items.length / 2);
  return { left: items.slice(0, mid), right: items.slice(mid) };
}
