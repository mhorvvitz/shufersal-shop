import fs from 'fs';

/**
 * Marks a dictionary entry whose product code Shufersal repeatedly rejected — almost
 * always a discontinued/unavailable product. Written by the add runner when it isolates
 * a genuinely-bad item; read by the suggester (to stop suggesting it) and surfaced to the
 * user so a replacement can be found.
 */
export interface UnavailableFlag {
  reason: string;
  since: string; // YYYY-MM-DD
}

export interface DictionaryEntry {
  id: string;
  name: string;
  brand: string;
  typicalQuantity: number;
  sellingMethod: string;
  aliases: string[];
  needsCuration?: boolean;
  unavailable?: UnavailableFlag;
}

export function readDictionary(dictPath: string): DictionaryEntry[] {
  return JSON.parse(fs.readFileSync(dictPath, 'utf-8')) as DictionaryEntry[];
}

/** True if the entry is flagged unavailable. */
export function isUnavailable(entry: Pick<DictionaryEntry, 'unavailable'>): boolean {
  return entry.unavailable != null;
}

/**
 * Shorten a raw add error — which may be a whole HTML error page — to a one-line reason
 * suitable for storing on the flag and showing the user.
 */
export function summarizeFailure(error: string): string {
  const status = error.match(/->\s*(\d{3})/);
  if (status) return `add rejected (HTTP ${status[1]})`;
  const firstLine = error.split('\n')[0]!.trim();
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
}

/**
 * Flag the entry with the given code as unavailable and persist the dictionary. Edits
 * only that entry — every other entry and the overall order are preserved. Returns true
 * if an entry with that code was found, false otherwise.
 */
export function flagUnavailable(
  dictPath: string,
  code: string,
  reason: string,
  since: string,
): boolean {
  const dict = readDictionary(dictPath);
  const entry = dict.find((e) => e.id === code);
  if (!entry) return false;
  entry.unavailable = { reason, since };
  fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2), 'utf-8');
  return true;
}
