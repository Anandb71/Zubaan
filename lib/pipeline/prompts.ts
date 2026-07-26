/**
 * Prompt construction. One module owns every instruction sent to a model, so
 * tuning behaviour under stage pressure never means grepping across call sites.
 *
 * The self-learning hook lives here: `fewShot` examples — drawn from
 * human-confirmed violations for this exact product and language — are injected
 * into the contradiction check. The model sharpens on the mistakes this
 * product's agents actually make, with no retraining and no fine-tune.
 */

import { ChatMessage } from "@/lib/sarvam/types";
import { DomainDef } from "@/lib/domains/registry";
import { ProductTerms, RequiredDisclosure } from "@/lib/domains/schema";
import { Utterance } from "@/lib/models";

export interface FewShotExample {
  utterance: string;
  /** true = a confirmed violation; false = confirmed safe (dismissed flag). */
  isViolation: boolean;
  contradictedBy?: string;
  correction?: string;
}

const compact = (terms: ProductTerms): string => JSON.stringify(terms);

// ── Check A: contradiction (fast path, sarvam-30b) ───────────────────────────

export function contradictionMessages(
  domain: DomainDef,
  terms: ProductTerms,
  utterance: string,
  fewShot: FewShotExample[] = [],
): ChatMessage[] {
  const hints = domain.contradictionHints.map((h) => `- ${h}`).join("\n");

  const learned = fewShot.length
    ? `\nLEARNED EXAMPLES — real cases a human reviewer already ruled on for this ` +
      `product. Match this judgement:\n` +
      fewShot
        .map(
          (e) =>
            `UTTERANCE: ${e.utterance}\nRULING: ${
              e.isViolation ? "NOT SUPPORTED" : "SUPPORTED (do not flag)"
            }${e.contradictedBy ? `\nREASON: ${e.contradictedBy}` : ""}`,
        )
        .join("\n---\n") +
      "\n"
    : "";

  const system =
    `You are a ${domain.regulator} compliance checker for a ${domain.productNoun}. ` +
    `You receive PRODUCT_TERMS as JSON plus one sales utterance. The utterance may be in any ` +
    `Indian language and is often code-mixed with English.\n\n` +
    `Decide whether the utterance makes a factual claim about the ${domain.productNoun}. If it ` +
    `does, decide whether PRODUCT_TERMS support that claim. A claim that overstates a benefit, or ` +
    `presents as certain something the document does not guarantee, is NOT supported.\n\n` +
    `CRITICAL RULE: a NEGATED statement is not a claim of the positive. "There is no guarantee", ` +
    `"guarantee nahi hai", "गारंटी नहीं है" are all CORRECT disclosures — mark them supported. ` +
    `Only flag a statement that actually asserts the false thing.\n\n` +
    `Do not flag greetings, small talk, or questions.\n\n` +
    `Commonly misrepresented in this domain:\n${hints}\n${learned}\n` +
    `PRODUCT_TERMS = ${compact(terms)}\n\n` +
    `Return JSON only, no prose, no markdown:\n` +
    `{"is_claim":boolean,"claim_made":string|null,"supported":boolean,"contradicted_by":string,` +
    `"severity":"low"|"high","suggested_correction":string}\n\n` +
    `"contradicted_by" must quote the specific term that conflicts. ` +
    `"suggested_correction" must be a corrected sentence the agent can say aloud right now, in ` +
    `the SAME language as the utterance. If is_claim is false, set supported=true and leave the ` +
    `other string fields empty.`;

  return [
    { role: "system", content: system },
    { role: "user", content: utterance },
  ];
}

// ── Disclosure satisfaction tracking (fast path) ─────────────────────────────

export function disclosureMatchMessages(
  disclosures: RequiredDisclosure[],
  utterance: string,
): ChatMessage[] {
  const list = disclosures.map((d) => `- id="${d.id}": ${d.text}`).join("\n");

  const system =
    `You track which mandatory disclosures a sales agent has actually stated.\n\n` +
    `Given the required disclosures and one utterance (any Indian language, often code-mixed), ` +
    `return the ids of the disclosures this utterance SATISFIES — meaning the agent clearly ` +
    `conveyed that fact to the customer.\n\n` +
    `Be strict. A vague or passing mention does NOT satisfy a disclosure. If unsure, do not ` +
    `include the id — a missed disclosure that gets flagged later is far less harmful than a ` +
    `real omission being silently marked as covered.\n\n` +
    `Return JSON only: {"satisfied_ids":[string]}\n\n` +
    `REQUIRED_DISCLOSURES:\n${list}`;

  return [
    { role: "system", content: system },
    { role: "user", content: utterance },
  ];
}

// ── Check B + audit: end-of-call reasoning (sarvam-105b) ─────────────────────

export function auditMessages(
  domain: DomainDef,
  terms: ProductTerms,
  disclosures: RequiredDisclosure[],
  satisfiedIds: string[],
  transcript: Utterance[],
  flaggedClaims: string[],
): ChatMessage[] {
  const convo = transcript
    .map((u) => `[${Math.round(u.tsMs / 1000)}s] ${u.text}`)
    .join("\n");
  const unsatisfied = disclosures.filter((d) => !satisfiedIds.includes(d.id));

  const system =
    `You are a neutral ${domain.regulator} compliance auditor reviewing a completed sales ` +
    `conversation for a ${domain.productNoun}. You are writing FOR THE CUSTOMER, who will read ` +
    `or hear this before deciding whether to sign.\n\n` +
    `Do two things:\n` +
    `1) OMISSIONS. For every required disclosure not in ALREADY_SATISFIED_IDS, emit an entry in ` +
    `"omissions" with its disclosure_id. Do not invent ids; use only ids from REQUIRED_DISCLOSURES.\n` +
    `2) AUDIT. Write three arrays:\n` +
    `   "promised" — what the agent told this customer, in the customer's words.\n` +
    `   "actual"   — what the official document actually says about those same points.\n` +
    `   "gaps"     — the differences, plus anything required that was never mentioned.\n\n` +
    `Style rules: plain language at a 6th-grade reading level. Short sentences. No jargon, no ` +
    `regulatory citations, no hedging. Never accuse the agent of lying — state what was said and ` +
    `what the document says, and let the difference speak.\n\n` +
    `Also write "summary": one short paragraph the customer can understand immediately.\n\n` +
    `Return JSON only, no prose, no markdown:\n` +
    `{"promised":[string],"actual":[string],"gaps":[string],` +
    `"omissions":[{"disclosure_id":string,"severity":"low"|"high"}],"summary":string}`;

  const user =
    `PRODUCT_TERMS = ${compact(terms)}\n\n` +
    `REQUIRED_DISCLOSURES = ${JSON.stringify(
      disclosures.map((d) => ({ id: d.id, text: d.text })),
    )}\n\n` +
    `ALREADY_SATISFIED_IDS = ${JSON.stringify(satisfiedIds)}\n` +
    `NOT_SATISFIED_IDS = ${JSON.stringify(unsatisfied.map((d) => d.id))}\n\n` +
    (flaggedClaims.length
      ? `CLAIMS ALREADY FLAGGED LIVE:\n${flaggedClaims.map((c) => `- ${c}`).join("\n")}\n\n`
      : "") +
    `TRANSCRIPT:\n${convo || "(no speech was captured)"}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Ingest: document -> structured terms + disclosures (sarvam-105b) ─────────

export function ingestMessages(domain: DomainDef, documentText: string): ChatMessage[] {
  const system =
    `You convert a ${domain.productNoun} document into structured compliance data.\n\n` +
    `First extract PRODUCT_TERMS. Use these keys when the document supports them: ` +
    `guaranteed (boolean — true ONLY if the document explicitly guarantees returns), ` +
    `returnsRange (string), lockInYears (number), surrenderCharges (string), ` +
    `exclusions (string[]), liquidityTerms (string), freeLookDays (number). ` +
    `Put any other domain-specific facts under "attributes" as flat key/value pairs. ` +
    `Omit a key entirely rather than guessing at its value.\n\n` +
    `Then generate REQUIRED_DISCLOSURES: the facts an agent is legally obligated to state when ` +
    `selling this product. ${domain.disclosurePolicy}\n\n` +
    `Return JSON only, no prose, no markdown:\n` +
    `{"terms":{...},"required_disclosures":[{"id":string,"text":string,"why_required":string,` +
    `"category":string}]}\n\n` +
    `Disclosure ids must be lowercase snake_case and stable (e.g. "lock_in", "free_look").`;

  return [
    { role: "system", content: system },
    // Clamp: a long policy PDF must not blow the context or the latency budget.
    { role: "user", content: documentText.slice(0, 14_000) },
  ];
}
