/**
 * Tests for the deterministic engine.
 *
 * This module is the last line of defence — when every model is down, these
 * rules are what still catch a lie. So the bar here is higher than elsewhere:
 * the exact demo utterances must be caught, and safe statements must NOT be.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ProductTerms, RequiredDisclosure } from "@/lib/domains/schema";
import { getDomain } from "@/lib/domains/registry";
import {
  buildFallbackAudit,
  checkContradiction,
  diffOmissions,
  matchDisclosures,
} from "./heuristics";
import {
  containsCue,
  containsNegator,
  extractPercentages,
  extractYears,
  findAssertedCue,
  normalize,
  parseRangeUpperBound,
} from "./text";

// The demo product: a market-linked ULIP that guarantees nothing.
const ULIP: ProductTerms = {
  domain: "insurance",
  guaranteed: false,
  returnsRange: "6-8% illustrative",
  lockInYears: 5,
  surrenderCharges: "Up to 30% of fund value in the first 3 years",
  freeLookDays: 15,
  exclusions: ["Suicide within 12 months", "Undisclosed pre-existing conditions"],
  liquidityTerms: "No withdrawal permitted during lock-in",
};

const DISCLOSURES: RequiredDisclosure[] = getDomain("insurance").baselineDisclosures;

// ── text utilities ───────────────────────────────────────────────────────────

test("normalize strips punctuation and case but preserves Indic script", () => {
  assert.equal(normalize("Guaranteed!! 12%"), "guaranteed 12%");
  assert.equal(normalize("गारंटी, है"), "गारंटी है");
});

test("containsCue tolerates filler words between cue parts", () => {
  assert.ok(containsCue("guaranteed twelve percent return", "guaranteed return"));
  assert.ok(containsCue("this is a guaranteed return", "guaranteed return"));
  assert.equal(containsCue("returns vary with the market", "guaranteed return"), false);
});

test("extractPercentages handles %, 'percent' and Devanagari", () => {
  assert.deepEqual(extractPercentages("12% guaranteed"), [12]);
  assert.deepEqual(extractPercentages("twelve is 12 percent"), [12]);
  assert.deepEqual(extractPercentages("15 प्रतिशत"), [15]);
  assert.deepEqual(extractPercentages("no numbers here"), []);
});

test("extractYears handles English and transliterated Hindi", () => {
  assert.deepEqual(extractYears("5 years"), [5]);
  assert.deepEqual(extractYears("2 saal"), [2]);
  assert.deepEqual(extractYears("3 साल"), [3]);
});

test("parseRangeUpperBound finds the top of a documented range", () => {
  assert.equal(parseRangeUpperBound("6-8% illustrative"), 8);
  assert.equal(parseRangeUpperBound("up to 9%"), 9);
  assert.equal(parseRangeUpperBound(undefined), null);
});

// ── negation: the subtlest logic in the engine ───────────────────────────────

test("negation is detected after the claim (Indic SOV word order)", () => {
  assert.equal(findAssertedCue("guarantee nahi hai", ["guarantee"]), null);
  assert.equal(findAssertedCue("गारंटी नहीं है", ["गारंटी"]), null);
  assert.equal(findAssertedCue("returns guaranteed nahi hain", ["guaranteed"]), null);
});

test("negation is detected before the claim (English word order)", () => {
  assert.equal(findAssertedCue("this is not guaranteed", ["guaranteed"]), null);
  assert.equal(findAssertedCue("there is no guarantee here", ["guarantee"]), null);
});

test("an asserted claim is still caught when a negator sits in another clause", () => {
  // "nahi" here belongs to "tension nahi", not to the guarantee.
  const hit = findAssertedCue(
    "guaranteed return milega sir, aap tension mat lijiye nahi",
    ["guaranteed"],
  );
  assert.equal(hit, "guaranteed", "a distant negator must not cancel the claim");
});

test("a cue that is itself negative stays a claim", () => {
  // "koi risk nahi" = "no risk" — that IS the promise, not a denial of one.
  assert.ok(containsNegator("koi risk nahi"));
  assert.equal(findAssertedCue("isme koi risk nahi hai", ["koi risk nahi"]), "koi risk nahi");
});

test("the honest disclosure sentence is never flagged as a contradiction", () => {
  for (const honest of [
    "Returns market se linked hain, guarantee nahi hai",
    "इसमें गारंटी नहीं है, बाजार जोखिम है",
    "These returns are not guaranteed",
  ]) {
    const f = checkContradiction(honest, ULIP);
    assert.equal(f.supported, true, `wrongly flagged: ${honest}`);
  }
});

// ── Check A: contradictions ──────────────────────────────────────────────────

test("catches a guaranteed-return claim against a non-guaranteed product", () => {
  const f = checkContradiction("Sir, aapko guaranteed 12% return milega", ULIP);
  assert.equal(f.isClaim, true);
  assert.equal(f.supported, false);
  assert.equal(f.severity, "high");
  assert.ok(f.suggestedCorrection.length > 0, "must offer a correction the agent can say");
});

test("catches the same claim written in Devanagari", () => {
  const f = checkContradiction("इसमें गारंटी है, पैसा डूबेगा नहीं", ULIP);
  assert.equal(f.supported, false);
  assert.equal(f.severity, "high");
});

test("catches 'withdraw anytime' against a 5-year lock-in", () => {
  const f = checkContradiction("Aap kabhi bhi paisa nikaal sakte ho", ULIP);
  assert.equal(f.supported, false);
  assert.match(f.contradictedBy, /5/);
});

test("catches 'no charges' against documented surrender charges", () => {
  const f = checkContradiction("Koi charge nahi lagega bilkul", ULIP);
  assert.equal(f.supported, false);
  assert.match(f.contradictedBy.toLowerCase(), /surrender|charge/);
});

test("catches a return above the documented range even without a guarantee word", () => {
  const f = checkContradiction("Yeh policy 15% tak return degi", ULIP);
  assert.equal(f.supported, false);
  assert.equal(f.ruleId, "numeric_overreach");
});

test("catches an understated lock-in period", () => {
  const f = checkContradiction("Lock in sirf 2 years ka hai", ULIP);
  assert.equal(f.supported, false);
  assert.equal(f.ruleId, "lockin_understated");
  assert.match(f.suggestedCorrection, /5/);
});

test("does NOT flag an accurate statement", () => {
  const f = checkContradiction(
    "Returns market se linked hain, guarantee nahi hai",
    ULIP,
  );
  assert.equal(f.supported, true, "an honest statement must not be flagged");
});

test("does NOT flag small talk", () => {
  const f = checkContradiction("Namaste sir, kaise hain aap?", ULIP);
  assert.equal(f.isClaim, false);
  assert.equal(f.supported, true);
});

test("does NOT flag a return quoted inside the documented range", () => {
  const f = checkContradiction("Historically isne 7% diya hai", ULIP);
  assert.equal(f.supported, true, "7% is within the 6-8% documented range");
});

test("generalizes: catches a lending contradiction with no engine change", () => {
  const loan: ProductTerms = {
    domain: "lending",
    attributes: { processing_fee: "2% of loan amount", rate_type: "floating" },
  };
  const fee = checkContradiction("Sir isme koi charge nahi hai", loan, "lending");
  assert.equal(fee.supported, false);

  const rate = checkContradiction("Aapki EMI fixed rate pe rahegi", loan, "lending");
  assert.equal(rate.supported, false);
  assert.match(rate.suggestedCorrection, /floating/i);
});

test("generalizes: catches a mutual-fund guarantee claim", () => {
  const mf: ProductTerms = {
    domain: "mutual_funds",
    guaranteed: false,
    attributes: { exit_load: "1% before 12 months" },
  };
  const f = checkContradiction("Yeh fund guaranteed return dega", mf, "mutual_funds");
  assert.equal(f.supported, false);
});

// ── Check B: disclosures and omissions ───────────────────────────────────────

test("recognizes a lock-in disclosure being made", () => {
  const ids = matchDisclosures("Is policy mein 5 saal ka lock in period hai", DISCLOSURES);
  assert.ok(ids.includes("lock_in"), `expected lock_in, got ${ids.join(",")}`);
});

test("recognizes the not-guaranteed disclosure", () => {
  const ids = matchDisclosures("Returns market linked hain, guarantee nahi hai", DISCLOSURES);
  assert.ok(ids.includes("returns_not_guaranteed"));
});

test("does not credit a disclosure that was never made", () => {
  const ids = matchDisclosures("Yeh bahut acchi policy hai sir", DISCLOSURES);
  assert.equal(ids.length, 0, "vague praise must not satisfy any disclosure");
});

test("omission diff reports exactly what was never said", () => {
  const said = new Set<string>();
  for (const u of [
    "Is policy mein 5 saal ka lock in hai",
    "Returns market linked hain, guarantee nahi",
  ]) {
    for (const id of matchDisclosures(u, DISCLOSURES)) said.add(id);
  }

  const missing = diffOmissions(said, DISCLOSURES).map((d) => d.id);
  assert.ok(missing.includes("free_look"), "free-look was never mentioned");
  assert.ok(missing.includes("surrender_charges"), "surrender charges were never mentioned");
  assert.equal(missing.includes("lock_in"), false, "lock-in WAS mentioned");
});

test("omission diff returns everything when the agent disclosed nothing", () => {
  const missing = diffOmissions([], DISCLOSURES);
  assert.equal(missing.length, DISCLOSURES.length);
});

// ── Fallback audit ───────────────────────────────────────────────────────────

test("fallback audit produces all three arrays with no model", () => {
  const omissions = diffOmissions(["lock_in"], DISCLOSURES);
  const audit = buildFallbackAudit(
    getDomain("insurance"),
    ULIP,
    ["Guaranteed 12% return milega"],
    omissions,
  );

  assert.equal(audit.promised.length, 1);
  assert.ok(audit.actual.length >= 3, "actual must restate the real document terms");
  assert.equal(audit.gaps.length, omissions.length);
  assert.ok(audit.summary.length > 0);
  assert.ok(
    audit.actual.some((a) => /not guaranteed/i.test(a)),
    "the audit must say plainly that returns are not guaranteed",
  );
});

test("fallback audit stays calm when nothing was missed", () => {
  const audit = buildFallbackAudit(getDomain("insurance"), ULIP, [], []);
  assert.equal(audit.gaps.length, 0);
  assert.doesNotMatch(audit.summary, /not told/i);
});
