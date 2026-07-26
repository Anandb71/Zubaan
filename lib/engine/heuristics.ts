/**
 * The deterministic compliance engine — Zubaan's true backfall.
 *
 * Everything else in the system can fail: the key can be missing, the venue
 * wifi can die, the 30B can time out, the breaker can be open, the model can
 * return prose instead of JSON. This module has no dependencies on any of that.
 * It is pure functions over text and terms, so it ALWAYS produces an answer.
 *
 * It serves three roles:
 *   1. Primary checker in mock mode (no API key at all).
 *   2. Fallback when the model call fails or times out on the live path.
 *   3. Cross-check alongside the model — a rule-hit the model missed is still
 *      surfaced, which is how a "guaranteed 12%" never slips through because
 *      the LLM was feeling generous.
 *
 * Rules are declared per-domain in the registry, so extending coverage never
 * touches this file.
 */

import { DomainDef, getDomain } from "@/lib/domains/registry";
import { ProductTerms, RequiredDisclosure, readTerm } from "@/lib/domains/schema";
import {
  anyCue,
  containsCue,
  extractPercentages,
  extractYears,
  findAssertedCue,
  parseRangeUpperBound,
  tokenOverlap,
} from "./text";

export interface HeuristicFinding {
  isClaim: boolean;
  claimMade: string | null;
  supported: boolean;
  contradictedBy: string;
  severity: "low" | "high";
  suggestedCorrection: string;
  /** Which rule produced this, for debugging and for the compliance view. */
  ruleId: string | null;
}

const CLEAN: HeuristicFinding = {
  isClaim: false,
  claimMade: null,
  supported: true,
  contradictedBy: "",
  severity: "low",
  suggestedCorrection: "",
  ruleId: null,
};

/**
 * Check one utterance against product terms using declared rules only.
 * Deterministic: the same input always yields the same finding.
 */
export function checkContradiction(
  utterance: string,
  terms: ProductTerms,
  domainId?: string,
): HeuristicFinding {
  const text = utterance.trim();
  if (!text) return CLEAN;

  const domain = getDomain(domainId ?? terms.domain);

  // 1. Declared cue rules — the domain's known misrepresentations.
  //    `findAssertedCue` skips negated hits: "guarantee nahi hai" states that
  //    there is NO guarantee, which is the honest disclosure, not a violation.
  for (const rule of domain.rules) {
    const hit = findAssertedCue(text, rule.cues);
    if (!hit) continue;
    const termValue = readTerm(terms, rule.termPath);
    if (!rule.violatesWhen(termValue)) continue;

    return {
      isClaim: true,
      claimMade: text,
      supported: false,
      contradictedBy: rule.describe(termValue),
      severity: rule.severity,
      suggestedCorrection: rule.correction(termValue),
      ruleId: rule.id,
    };
  }

  // 2. Numeric overreach: a promised return above the documented range.
  const numeric = checkNumericOverreach(text, terms);
  if (numeric) return numeric;

  // 3. Lock-in understatement: "only 2 years" when the document says 5.
  const lockIn = checkLockInUnderstated(text, terms);
  if (lockIn) return lockIn;

  // Nothing matched. We deliberately do NOT claim "this is a safe statement" —
  // only that no rule fired. The model is what catches the subtle cases.
  return CLEAN;
}

function checkNumericOverreach(
  text: string,
  terms: ProductTerms,
): HeuristicFinding | null {
  const claimed = extractPercentages(text);
  if (claimed.length === 0) return null;

  const highest = Math.max(...claimed);
  const bound = parseRangeUpperBound(terms.returnsRange);

  // A specific percentage stated as guaranteed is a violation on its own when
  // the product does not guarantee returns. Negated mentions are excluded:
  // "12% mila hai lekin guarantee nahi" is an accurate statement.
  const guaranteeCue = findAssertedCue(text, [
    "guaranteed",
    "guarantee",
    "assured",
    "fixed",
    "गारंटी",
    "निश्चित",
    "pakka",
  ]);
  if (guaranteeCue && terms.guaranteed === false) {
    return {
      isClaim: true,
      claimMade: text,
      supported: false,
      contradictedBy:
        terms.returnsRange
          ? `The document states returns of ${terms.returnsRange} and does not guarantee them.`
          : "The document does not guarantee returns.",
      severity: "high",
      suggestedCorrection: terms.returnsRange
        ? `Illustrative returns are ${terms.returnsRange}, and they are not guaranteed.`
        : "Returns are market-linked and not guaranteed.",
      ruleId: "numeric_guaranteed",
    };
  }

  if (bound !== null && highest > bound) {
    return {
      isClaim: true,
      claimMade: text,
      supported: false,
      contradictedBy: `The document states returns of ${terms.returnsRange}; ${highest}% exceeds that.`,
      severity: "high",
      suggestedCorrection: `Illustrative returns are ${terms.returnsRange}, not ${highest}%.`,
      ruleId: "numeric_overreach",
    };
  }

  return null;
}

function checkLockInUnderstated(
  text: string,
  terms: ProductTerms,
): HeuristicFinding | null {
  if (typeof terms.lockInYears !== "number" || terms.lockInYears <= 0) return null;
  // Only interpret year counts when the sentence is actually about lock-in.
  const aboutLockIn = containsCue(text, "lock in") ||
    containsCue(text, "lock") ||
    containsCue(text, "withdraw") ||
    containsCue(text, "nikaal") ||
    containsCue(text, "निकाल") ||
    containsCue(text, "बंद");
  if (!aboutLockIn) return null;

  const years = extractYears(text);
  if (years.length === 0) return null;

  const stated = Math.min(...years);
  if (stated >= terms.lockInYears) return null;

  return {
    isClaim: true,
    claimMade: text,
    supported: false,
    contradictedBy: `The document specifies a ${terms.lockInYears}-year lock-in, not ${stated}.`,
    severity: "high",
    suggestedCorrection: `The lock-in period is ${terms.lockInYears} years.`,
    ruleId: "lockin_understated",
  };
}

/**
 * Which required disclosures does this utterance satisfy?
 *
 * Deliberately conservative: a false "satisfied" would suppress a real omission
 * flag, which is the more dangerous error. We require either a strong keyword
 * signal for that disclosure category or substantial token overlap with the
 * disclosure text itself.
 */
export function matchDisclosures(
  utterance: string,
  disclosures: RequiredDisclosure[],
): string[] {
  const text = utterance.trim();
  if (!text) return [];

  const satisfied: string[] = [];
  for (const d of disclosures) {
    if (satisfiesDisclosure(text, d)) satisfied.push(d.id);
  }
  return satisfied;
}

const CATEGORY_CUES: Record<string, string[]> = {
  lock_in: ["lock in", "lock-in", "lockin", "लॉक इन", "लॉक-इन", "band rahega", "बंद रहेगा"],
  surrender_charges: [
    "surrender charge",
    "surrender",
    "exit charge",
    "penalty",
    "सरेंडर",
    "शुल्क",
    "charges lagenge",
  ],
  returns_not_guaranteed: [
    "not guaranteed",
    "no guarantee",
    "market linked",
    "market risk",
    "guarantee nahi",
    "गारंटी नहीं",
    "बाजार जोखिम",
    "बाज़ार से जुड़ा",
  ],
  free_look: ["free look", "free-look", "cooling off", "15 days", "30 days", "फ्री लुक", "वापस कर सकते"],
  exclusions: ["exclusion", "not covered", "claim reject", "शामिल नहीं", "कवर नहीं"],
  apr: ["apr", "annual percentage", "effective rate", "वार्षिक दर"],
  charges: ["processing fee", "prepayment", "foreclosure", "प्रोसेसिंग", "शुल्क"],
  rate_type: ["floating", "fixed rate", "फ्लोटिंग", "ब्याज दर बदल"],
  market_risk: ["market risk", "subject to market", "past performance", "बाजार जोखिम"],
  expense_ratio: ["expense ratio", "एक्सपेंस"],
  exit_load: ["exit load", "एग्जिट लोड"],
  material_risks: ["risk", "side effect", "complication", "जोखिम"],
  alternatives: ["alternative", "another option", "विकल्प"],
  outcome_not_guaranteed: ["not guaranteed", "no guarantee", "cannot promise", "गारंटी नहीं"],
  total_repayable: ["total repayable", "total amount", "कुल राशि"],
};

function satisfiesDisclosure(text: string, d: RequiredDisclosure): boolean {
  const cues = CATEGORY_CUES[d.id];
  if (cues && anyCue(text, cues)) return true;
  // Fall back to overlap with the disclosure sentence itself. The threshold is
  // high on purpose: a passing mention must not count as a disclosure.
  return tokenOverlap(text, d.text) >= 0.6;
}

/**
 * Deterministic omission diff — Check B without any model.
 * Given everything said and the mandated list, return what was never stated.
 */
export function diffOmissions(
  satisfiedIds: Iterable<string>,
  disclosures: RequiredDisclosure[],
): RequiredDisclosure[] {
  const satisfied = new Set(satisfiedIds);
  return disclosures.filter((d) => !satisfied.has(d.id));
}

/**
 * Deterministic audit text. Used when the reasoning model is unavailable so the
 * customer still receives a real promised/actual/gaps breakdown.
 */
export function buildFallbackAudit(
  domain: DomainDef,
  terms: ProductTerms,
  claims: string[],
  omissions: RequiredDisclosure[],
): { promised: string[]; actual: string[]; gaps: string[]; summary: string } {
  const promised = claims.slice(0, 8);

  const actual: string[] = [];
  if (terms.guaranteed === false) {
    actual.push("Returns are not guaranteed. They depend on the market.");
  }
  if (terms.returnsRange) actual.push(`The document shows returns of ${terms.returnsRange}.`);
  if (typeof terms.lockInYears === "number" && terms.lockInYears > 0) {
    actual.push(`Your money is locked in for ${terms.lockInYears} years.`);
  }
  if (terms.surrenderCharges) {
    actual.push(`If you exit early, these charges apply: ${terms.surrenderCharges}.`);
  }
  if (typeof terms.freeLookDays === "number" && terms.freeLookDays > 0) {
    actual.push(`You can return this ${domain.productNoun} within ${terms.freeLookDays} days.`);
  }
  for (const [k, v] of Object.entries(terms.attributes ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    actual.push(`${humanize(k)}: ${Array.isArray(v) ? v.join(", ") : String(v)}.`);
  }

  const gaps = omissions.map((d) => `You were not told: ${d.text.replace(/^State /i, "")}`);

  const summary =
    gaps.length > 0
      ? `Before you sign, please read this. The agent made ${promised.length} claim(s) about this ${domain.productNoun}. ` +
        `There ${gaps.length === 1 ? "is 1 thing" : `are ${gaps.length} things`} you were not told that the ${domain.regulator} rules require. ` +
        `Please check the "Gap" section below before you sign anything.`
      : `Before you sign, please read this. The agent's claims about this ${domain.productNoun} match the official document, ` +
        `and the required points were explained. Please still read the "Actual" section so you know the exact terms.`;

  return { promised, actual, gaps, summary };
}

function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
