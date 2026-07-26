/**
 * Shapes shared by every regulated verbal-sale domain.
 *
 * The generalization trick: ProductTerms keeps the insurance fields the PRD
 * names as first-class (so the beachhead is exact and the prompts are precise),
 * but also carries an open `attributes` bag so lending, mutual funds, and
 * medical consent describe their own facts with no schema migration. A claim is
 * checkable whether the fact lives in a named field or in `attributes`.
 */

import { z } from "zod";
import { Result, err, ok } from "@/lib/kernel";

export const requiredDisclosureSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  whyRequired: z.string().default(""),
  category: z.string().optional(),
  /** Omitting this is a serious regulatory failure, not a nitpick. */
  critical: z.boolean().default(true),
});
export type RequiredDisclosure = z.infer<typeof requiredDisclosureSchema>;

const attributeValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const productTermsSchema = z
  .object({
    domain: z.string().default("insurance"),

    // Insurance-first primary fields (the PRD's terms_json).
    guaranteed: z.boolean().optional(),
    returnsRange: z.string().optional(),
    lockInYears: z.number().optional(),
    surrenderCharges: z.string().optional(),
    exclusions: z.array(z.string()).optional(),
    liquidityTerms: z.string().optional(),
    freeLookDays: z.number().optional(),

    // Open extension for every other domain.
    attributes: z.record(attributeValue).optional(),
  })
  .passthrough();
export type ProductTerms = z.infer<typeof productTermsSchema>;

export function parseTerms(value: unknown): Result<ProductTerms> {
  const r = productTermsSchema.safeParse(value);
  if (r.success) return ok(r.data);
  return err({
    kind: "validation",
    message: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    retriable: false,
  });
}

export function parseDisclosures(value: unknown): Result<RequiredDisclosure[]> {
  const r = z.array(requiredDisclosureSchema).safeParse(value);
  if (r.success) return ok(r.data);
  return err({
    kind: "validation",
    message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    retriable: false,
  });
}

/** Read a dotted path ("attributes.apr") out of terms. */
export function readTerm(terms: ProductTerms, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, terms);
}

/** Field descriptor driving the editable review table on /product. */
export interface TermsFieldSpec {
  key: string; // dotted path into ProductTerms
  label: string;
  type: "bool" | "text" | "number" | "list";
  help?: string;
}
