import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  isUnavailable,
  summarizeFailure,
  flagUnavailable,
  readDictionary,
  type DictionaryEntry,
} from './dictionary';

function tmpDict(entries: DictionaryEntry[]): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dict-')), 'product-dictionary.json');
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), 'utf-8');
  return p;
}

const sample: DictionaryEntry[] = [
  { id: 'P_1', name: 'milk', brand: 'tnuva', typicalQuantity: 1, sellingMethod: 'UNIT', aliases: ['milk'] },
  { id: 'P_2', name: 'garlic', brand: 'katif', typicalQuantity: 1, sellingMethod: 'UNIT', aliases: ['garlic'] },
];

// ── isUnavailable ────────────────────────────────────────────────────────────

test('isUnavailable reflects the flag', () => {
  assert.equal(isUnavailable({ unavailable: undefined }), false);
  assert.equal(isUnavailable({ unavailable: { reason: 'x', since: '2026-06-21' } }), true);
});

// ── summarizeFailure ──────────────────────────────────────────────────────────

test('summarizeFailure extracts the HTTP status from a noisy error', () => {
  const err =
    'Error: Request failed: POST https://www.shufersal.co.il/online/he/cart/addGrid -> 500 . Response: <!DOCTYPE html>\n<html>...';
  assert.equal(summarizeFailure(err), 'add rejected (HTTP 500)');
});

test('summarizeFailure truncates a long non-status first line', () => {
  const out = summarizeFailure('x'.repeat(200));
  assert.ok(out.length <= 120);
  assert.ok(out.endsWith('...'));
});

// ── flagUnavailable ────────────────────────────────────────────────────────────

test('flagUnavailable marks the matching entry and preserves the rest', () => {
  const p = tmpDict(sample);
  const ok = flagUnavailable(p, 'P_2', 'add rejected (HTTP 500)', '2026-06-21');
  assert.equal(ok, true);

  const dict = readDictionary(p);
  assert.equal(dict.length, 2);
  assert.equal(dict[0]!.unavailable, undefined); // milk untouched
  assert.deepEqual(dict[1]!.unavailable, { reason: 'add rejected (HTTP 500)', since: '2026-06-21' });
  assert.equal(dict[1]!.name, 'garlic'); // entry otherwise intact
});

test('flagUnavailable returns false and leaves the file unchanged for an unknown code', () => {
  const p = tmpDict(sample);
  const before = fs.readFileSync(p, 'utf-8');
  const ok = flagUnavailable(p, 'P_NOPE', 'reason', '2026-06-21');
  assert.equal(ok, false);
  assert.equal(fs.readFileSync(p, 'utf-8'), before);
});
