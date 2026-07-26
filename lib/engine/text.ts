/**
 * Multilingual text matching for the deterministic engine.
 *
 * Indian sales speech is code-mixed and transliterated inconsistently:
 * "guaranteed", "gurantee", "गारंटी", and "guranteed return" all carry the same
 * promise. So we normalize aggressively before comparing.
 *
 * Two subtleties this module exists to get right:
 *
 *  1. UNICODE MARKS. Devanagari (and every other Indic script) writes vowels as
 *     combining marks — ा ि ी ं — which are Unicode category M, not L. A naive
 *     `[^\p{L}\p{N}\s]` filter deletes them and turns गारंटी into "ग र ट".
 *     Marks must be preserved.
 *
 *  2. NEGATION. "guarantee nahi hai" means there is NO guarantee — it is the
 *     honest disclosure, not the violation. Indic languages are SOV, so the
 *     negator usually FOLLOWS the claim ("guarantee nahi"), while English puts
 *     it before ("not guaranteed"). We check both sides.
 */

/** Lowercase, drop punctuation, collapse whitespace — preserving Indic marks. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    // NFKC composes rather than decomposes, so Indic matras stay attached.
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}\s%]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CueMatch {
  /** Index into the NORMALIZED haystack. */
  start: number;
  end: number;
  cue: string;
}

/** Locate a cue in the text, tolerating spacing and filler-word drift. */
export function findCue(haystack: string, cue: string): CueMatch | null {
  const h = normalize(haystack);
  const c = normalize(cue);
  if (!c || !h) return null;

  const direct = h.indexOf(c);
  if (direct >= 0) return { start: direct, end: direct + c.length, cue: c };

  // Multi-word cues: allow up to two filler words between the parts, which
  // covers "guaranteed twelve percent return" for the cue "guaranteed return".
  const parts = c.split(" ").filter(Boolean);
  if (parts.length < 2) return null;

  const pattern = parts.map(escapeRegex).join("(?:\\s+\\S+){0,2}\\s+");
  const m = new RegExp(`\\b${pattern}`, "u").exec(h);
  return m ? { start: m.index, end: m.index + m[0].length, cue: c } : null;
}

export function containsCue(haystack: string, cue: string): boolean {
  return findCue(haystack, cue) !== null;
}

/** First cue that matches, or null. */
export function anyCue(haystack: string, cues: string[]): string | null {
  for (const cue of cues) if (containsCue(haystack, cue)) return cue;
  return null;
}

/**
 * Negators across the languages Zubaan supports, plus common romanizations.
 * Kept as whole tokens so "nahi" matches but "nahin-se" style noise does not
 * accidentally match a longer word.
 */
const NEGATORS = new Set([
  // English
  "not", "no", "never", "without", "none", "isnt", "arent", "doesnt", "dont", "wont",
  // Hindi / Urdu / Marathi (romanized + script)
  "nahi", "nahin", "nhi", "na", "naa", "mat", "bina", "बिना",
  "नहीं", "नही", "ना", "नाही", "मत",
  // Bengali
  "noy", "nei", "নয়", "নেই", "না",
  // Tamil
  "illai", "illa", "இல்லை",
  // Telugu
  "kadu", "ledu", "కాదు", "లేదు",
  // Kannada
  "ಇಲ್ಲ",
  // Malayalam
  "ഇല്ല",
  // Gujarati
  "nathi", "નથી",
  // Punjabi
  "ਨਹੀਂ",
]);

function isNegatorToken(token: string): boolean {
  return NEGATORS.has(token);
}

/** Does this phrase already contain a negator? (e.g. the cue "koi risk nahi") */
export function containsNegator(text: string): boolean {
  return normalize(text).split(" ").some(isNegatorToken);
}

/**
 * Is the matched cue negated by surrounding words?
 *
 * Window is deliberately tight (2 tokens each side). "guarantee nahi hai" is
 * negated; "guaranteed hai, koi risk nahi" is NOT — there the `nahi` belongs to
 * a different clause and the guarantee still stands as a claim.
 */
export function isCueNegated(haystack: string, match: CueMatch, window = 2): boolean {
  // A cue that is itself phrased negatively ("no risk", "koi risk nahi") is a
  // claim in its own right; an inner negator must not cancel it.
  if (containsNegator(match.cue)) return false;

  const h = normalize(haystack);
  const before = h.slice(0, match.start).split(" ").filter(Boolean);
  const after = h.slice(match.end).split(" ").filter(Boolean);

  const near = [...before.slice(-window), ...after.slice(0, window)];
  return near.some(isNegatorToken);
}

/** Convenience: find a cue that is present AND asserted (not negated). */
export function findAssertedCue(haystack: string, cues: string[]): string | null {
  for (const cue of cues) {
    const m = findCue(haystack, cue);
    if (m && !isCueNegated(haystack, m)) return cue;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract percentage claims ("12%", "12 percent", "15 प्रतिशत"). */
export function extractPercentages(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|per cent|pct|प्रतिशत|फीसदी|শতাংশ|சதவீதம்|శాతం)/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseFloat(m[1]!);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Extract year counts ("5 years", "5 saal", "3 साल"). */
export function extractYears(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,2})\s*(?:years?|yrs?|saal|sal|varsh|साल|वर्ष|বছর|ஆண்டு|సంవత్సర|ವರ್ಷ)/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseInt(m[1]!, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Upper bound of a documented range: "6-8%", "6 to 8 percent", "up to 9%". */
export function parseRangeUpperBound(range: string | undefined): number | null {
  if (!range) return null;
  const pct = extractPercentages(range);
  if (pct.length > 0) return Math.max(...pct);
  const bare = range.match(/\d{1,3}(?:\.\d+)?/g);
  if (!bare) return null;
  const nums = bare.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : null;
}

/** Token overlap ratio — used to detect a disclosure being restated. */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalize(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return hits / Math.min(ta.size, tb.size);
}
