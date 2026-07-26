/**
 * Structured contracts between Zubaan and the models.
 *
 * Every model output is validated before it touches the rest of the system.
 * A hallucinated field, a missing key, or a string where a bool belongs
 * degrades to a safe default instead of corrupting a live call. Models are
 * treated as untrusted input — because that is exactly what they are.
 */

import { z } from "zod";
import { Result, err, ok } from "@/lib/kernel";

const severity = z.enum(["low", "high"]).catch("low");

/** Coerce a model's loose truthiness into a real boolean. */
const looseBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|1)$/i.test(v.trim());
  if (typeof v === "number") return v === 1;
  return false;
}, z.boolean());

const nullableText = z.preprocess(
  (v) => (v === null || v === undefined ? "" : v),
  z.string().catch(""),
);

/** Check A — one utterance vs product terms (fast path, sarvam-30b). */
export const contradictionSchema = z.object({
  is_claim: looseBool,
  claim_made: z.preprocess(
    (v) => (v === null || v === undefined ? null : String(v)),
    z.string().nullable(),
  ),
  supported: looseBool,
  contradicted_by: nullableText,
  severity,
  suggested_correction: nullableText,
});
export type ContradictionOutput = z.infer<typeof contradictionSchema>;

/** Which required disclosures an utterance satisfies (fast path). */
export const disclosureMatchSchema = z.object({
  satisfied_ids: z.preprocess(
    (v) => (Array.isArray(v) ? v.map(String) : []),
    z.array(z.string()),
  ),
});
export type DisclosureMatchOutput = z.infer<typeof disclosureMatchSchema>;

/** Check B + audit — end-of-call reasoning (sarvam-105b). */
const stringArray = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []),
  z.array(z.string()),
);

export const auditReasoningSchema = z.object({
  promised: stringArray,
  actual: stringArray,
  gaps: stringArray,
  omissions: z
    .preprocess(
      (v) => (Array.isArray(v) ? v : []),
      z.array(
        z.object({
          disclosure_id: z.string(),
          severity,
        }),
      ),
    )
    .catch([]),
  summary: nullableText,
});
export type AuditReasoningOutput = z.infer<typeof auditReasoningSchema>;

/** Ingest — a document structured into terms + required disclosures. */
export const ingestSchema = z.object({
  terms: z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
    z.record(z.unknown()),
  ),
  required_disclosures: z
    .preprocess(
      (v) => (Array.isArray(v) ? v : []),
      z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          why_required: nullableText,
          category: z.string().optional(),
        }),
      ),
    )
    .catch([]),
});
export type IngestOutput = z.infer<typeof ingestSchema>;

/** Adapt a zod schema into the validator shape `chatJson` expects. */
export function zodValidator<T>(schema: z.ZodType<T>): (value: unknown) => Result<T> {
  return (value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return ok(parsed.data);
    return err({
      kind: "validation" as const,
      message: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
      retriable: false,
    });
  };
}
