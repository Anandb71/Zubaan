/**
 * Live window check — Check A (contradiction) + disclosure satisfaction.
 * Fast path: sarvam-30b with deterministic heuristic as primary/fallback.
 */

import "server-only";

import { config } from "@/lib/config";
import { getDomain } from "@/lib/domains/registry";
import {
  checkContradiction,
  matchDisclosures,
} from "@/lib/engine/heuristics";
import { log } from "@/lib/kernel";
import type { Utterance, Violation } from "@/lib/models";
import { chatJson, chatAvailable } from "@/lib/sarvam";
import { store } from "@/lib/store";
import { contradictionMessages, disclosureMatchMessages } from "./prompts";
import {
  contradictionSchema,
  disclosureMatchSchema,
  type ContradictionOutput,
  type DisclosureMatchOutput,
  zodValidator,
} from "./schemas";

const liveLog = log.child({ mod: "pipeline.live" });

export interface WindowInput {
  callId: string;
  utterances: Utterance[];
  detectedLang?: string;
}

export interface WindowResult {
  violations: Violation[];
  satisfiedIds: string[];
  source: "model" | "heuristic" | "both";
}

export async function processWindow(input: WindowInput): Promise<WindowResult> {
  const call = await store.getCall(input.callId);
  if (!call) throw new Error(`call not found: ${input.callId}`);

  const product = await store.getProduct(call.productId);
  if (!product) throw new Error(`product not found: ${call.productId}`);

  const text = input.utterances
    .map((u) => u.text.trim())
    .filter(Boolean)
    .join(" ");
  if (!text) {
    return { violations: [], satisfiedIds: [], source: "heuristic" };
  }

  const domain = getDomain(product.domain);
  const heuristic = checkContradiction(text, product.terms, product.domain);
  const heuristicSatisfied = matchDisclosures(text, product.requiredDisclosures);

  let modelFinding = heuristic;
  let modelSatisfied = heuristicSatisfied;
  let source: WindowResult["source"] = "heuristic";

  if (chatAvailable() && config.sarvam.mode === "live") {
    const [cRes, dRes] = await Promise.all([
      chatJson(
        contradictionMessages(domain, product.terms, text),
        { tier: "fast", temperature: 0, maxTokens: 400 },
        zodValidator(contradictionSchema),
      ),
      chatJson(
        disclosureMatchMessages(product.requiredDisclosures, text),
        { tier: "fast", temperature: 0, maxTokens: 200 },
        zodValidator(disclosureMatchSchema),
      ),
    ]);

    if (cRes.ok) {
      const c = cRes.value as ContradictionOutput;
      source = heuristic.isClaim && !heuristic.supported ? "both" : "model";
      modelFinding = {
        isClaim: c.is_claim,
        claimMade: c.claim_made,
        supported: c.supported,
        contradictedBy: c.contradicted_by,
        severity: c.severity,
        suggestedCorrection: c.suggested_correction,
        ruleId: null,
      };
      // Heuristic cross-check: never drop a rule hit the model missed.
      if (
        config.features.heuristicCrossCheck &&
        heuristic.isClaim &&
        !heuristic.supported &&
        modelFinding.supported
      ) {
        modelFinding = heuristic;
        source = "both";
      }
    } else {
      liveLog.warn("model contradiction failed; using heuristic", {
        message: cRes.error.message,
      });
    }

    if (dRes.ok) {
      const d = dRes.value as DisclosureMatchOutput;
      const ids = new Set([...heuristicSatisfied, ...d.satisfied_ids]);
      modelSatisfied = [...ids];
    }
  }

  await store.appendWindow(
    input.callId,
    input.utterances,
    modelSatisfied,
    input.detectedLang,
  );

  const violations: Violation[] = [];
  if (modelFinding.isClaim && !modelFinding.supported) {
    const v = await store.saveViolation({
      callId: input.callId,
      kind: "contradiction",
      tsMs: input.utterances[0]?.tsMs ?? 0,
      utterance: text,
      claimMade: modelFinding.claimMade ?? text,
      contradictedBy: modelFinding.contradictedBy,
      severity: modelFinding.severity,
      suggestedCorrection: modelFinding.suggestedCorrection,
      detectedLang: input.detectedLang ?? call.detectedLang,
      source,
    });
    violations.push(v);
  }

  return { violations, satisfiedIds: modelSatisfied, source };
}
