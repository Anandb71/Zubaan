/**
 * End-of-call path — Check B (omissions) + customer audit + TTS.
 * Reasoning path: sarvam-105b with deterministic fallback.
 */

import "server-only";

import { config } from "@/lib/config";
import { getDomain } from "@/lib/domains/registry";
import {
  buildFallbackAudit,
  diffOmissions,
} from "@/lib/engine/heuristics";
import { resolveLanguage, toBcp47 } from "@/lib/i18n/languages";
import { log } from "@/lib/kernel";
import type { Audit, Violation } from "@/lib/models";
import { chatAvailable, chatJson, synthesize, translate } from "@/lib/sarvam";
import { store } from "@/lib/store";
import { auditMessages } from "./prompts";
import {
  auditReasoningSchema,
  type AuditReasoningOutput,
  zodValidator,
} from "./schemas";

const auditLog = log.child({ mod: "pipeline.audit" });

export interface EndCallResult {
  audit: Audit;
  omissions: Violation[];
  degraded: boolean;
}

export async function endCall(callId: string): Promise<EndCallResult> {
  const call = await store.getCall(callId);
  if (!call) throw new Error(`call not found: ${callId}`);

  const product = await store.getProduct(call.productId);
  if (!product) throw new Error(`product not found: ${call.productId}`);

  await store.finishCall(callId);

  const domain = getDomain(product.domain);
  const prior = await store.listViolations(callId);
  const flaggedClaims = prior
    .filter((v) => v.kind === "contradiction")
    .map((v) => v.claimMade ?? v.utterance)
    .filter(Boolean);

  const heuristicOmissions = diffOmissions(
    call.satisfiedDisclosureIds,
    product.requiredDisclosures,
  );

  let promised = flaggedClaims.slice(0, 8);
  let actual: string[] = [];
  let gaps: string[] = [];
  let summary = "";
  let omissionIds = heuristicOmissions.map((d) => d.id);
  let degraded = false;

  if (chatAvailable() && config.sarvam.mode === "live") {
    const res = await chatJson(
      auditMessages(
        domain,
        product.terms,
        product.requiredDisclosures,
        call.satisfiedDisclosureIds,
        call.transcript,
        flaggedClaims,
      ),
      { tier: "reason", temperature: 0, maxTokens: 1200 },
      zodValidator(auditReasoningSchema),
    );

    if (res.ok) {
      const out = res.value as AuditReasoningOutput;
      promised = out.promised.length ? out.promised : promised;
      actual = out.actual;
      gaps = out.gaps;
      summary = out.summary;
      if (out.omissions.length) {
        omissionIds = [
          ...new Set([
            ...omissionIds,
            ...out.omissions.map((o) => o.disclosure_id),
          ]),
        ];
      }
    } else {
      degraded = true;
      auditLog.warn("reason model failed; using fallback audit", {
        message: res.error.message,
      });
    }
  } else {
    degraded = true;
  }

  if (!actual.length || !summary) {
    const fb = buildFallbackAudit(domain, product.terms, promised, heuristicOmissions);
    promised = promised.length ? promised : fb.promised;
    actual = actual.length ? actual : fb.actual;
    gaps = gaps.length ? gaps : fb.gaps;
    summary = summary || fb.summary;
    degraded = true;
  }

  const omissions: Violation[] = [];
  for (const id of omissionIds) {
    const disclosure = product.requiredDisclosures.find((d) => d.id === id);
    if (!disclosure) continue;
    const v = await store.saveViolation({
      callId,
      kind: "omission",
      tsMs: 0,
      utterance: "",
      contradictedBy: disclosure.whyRequired || disclosure.text,
      severity: disclosure.critical ? "high" : "low",
      disclosureId: disclosure.id,
      detectedLang: call.detectedLang,
      source: degraded ? "heuristic" : "both",
    });
    omissions.push(v);
  }

  // Translate + TTS into customer language (often different from spoken).
  let summaryLang = call.customerLang;
  let summaryText = summary;
  let audioUrl: string | undefined;

  if (config.features.translateAudit) {
    const translated = await translate({
      text: [
        summary,
        ...promised.map((p) => `Promised: ${p}`),
        ...actual.map((a) => `Actual: ${a}`),
        ...gaps.map((g) => `Gap: ${g}`),
      ].join("\n"),
      sourceLanguage: "auto",
      targetLanguage: call.customerLang,
    });
    if (translated.ok && !translated.value.degraded) {
      // Keep structured English arrays for UI cards; translate summary for voice.
      const onlySummary = await translate({
        text: summary,
        sourceLanguage: "auto",
        targetLanguage: call.customerLang,
      });
      if (onlySummary.ok) {
        summaryText = onlySummary.value.text;
        summaryLang = toBcp47(call.customerLang);
        if (onlySummary.value.degraded) degraded = true;
      }
    } else {
      degraded = true;
    }
  }

  const tts = await synthesize({
    text: `${summaryText}\n\n${gaps.slice(0, 3).join(". ")}`,
    languageCode: resolveLanguage(call.customerLang).code,
  });

  if (tts.ok && tts.value.audioBase64) {
    const uploaded = await store.uploadAudio(callId, tts.value.audioBase64);
    audioUrl = uploaded ?? `data:audio/wav;base64,${tts.value.audioBase64}`;
  } else {
    degraded = true;
  }

  const audit = await store.saveAudit({
    callId,
    summaryText,
    summaryLang,
    audioUrl,
    promised,
    actual,
    gaps,
    degraded,
  });

  return { audit, omissions, degraded };
}
