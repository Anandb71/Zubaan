/**
 * Canonical entities, shared by the pipeline, the store, and the API.
 * Mirrors the Supabase schema (snake_case there, camelCase here — mapped once
 * in the Supabase store), so DB and code can never drift apart silently.
 */

import { DomainId } from "./domains/registry";
import { ProductTerms, RequiredDisclosure } from "./domains/schema";

export type CallStatus = "active" | "ended" | "audited" | "error";
export type ViolationKind = "contradiction" | "omission";
export type Severity = "low" | "high";
export type FeedbackLabel = "confirmed" | "dismissed";

/** The three permission tiers. Load-bearing, not decorative. */
export type Role = "agent" | "compliance" | "customer";

export interface Product {
  id: string;
  name: string;
  domain: DomainId;
  pdfUrl?: string;
  terms: ProductTerms;
  requiredDisclosures: RequiredDisclosure[];
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  branch: string;
}

export interface Utterance {
  /** ms since call start. */
  tsMs: number;
  text: string;
  language?: string;
  final?: boolean;
}

export interface Call {
  id: string;
  agentId: string;
  productId: string;
  customerName: string;
  /** Language the audit is delivered in — often NOT the language spoken. */
  customerLang: string;
  /** Language actually detected by STT. */
  detectedLang?: string;
  startedAt: string;
  endedAt?: string;
  status: CallStatus;
  transcript: Utterance[];
  /** Disclosure ids satisfied so far — the conversation-level state that
   *  makes the omission check possible at all. */
  satisfiedDisclosureIds: string[];
}

export interface Violation {
  id: string;
  callId: string;
  kind: ViolationKind;
  tsMs: number;
  /** What triggered it. Empty for omissions — nothing was said, that's the point. */
  utterance: string;
  claimMade?: string;
  contradictedBy?: string;
  severity: Severity;
  suggestedCorrection?: string;
  /** Set for omissions. */
  disclosureId?: string;
  /** For grouping "most common false promise" by language. */
  detectedLang?: string;
  /** Which path produced it: the model, the deterministic engine, or both. */
  source: "model" | "heuristic" | "both";
  createdAt: string;
}

export interface Audit {
  id: string;
  callId: string;
  summaryText: string;
  summaryLang: string;
  /** data: URL or storage URL. Empty when TTS degraded to text-only. */
  audioUrl?: string;
  promised: string[];
  actual: string[];
  gaps: string[];
  /** True when any stage ran in fallback mode. */
  degraded: boolean;
  createdAt: string;
}

/** A labeled outcome — the fuel for the self-learning loop. */
export interface Feedback {
  id: string;
  violationId: string;
  callId: string;
  productId: string;
  kind: ViolationKind;
  label: FeedbackLabel;
  utterance: string;
  claimMade?: string;
  contradictedBy?: string;
  suggestedCorrection?: string;
  detectedLang?: string;
  note?: string;
  by?: Role;
  createdAt: string;
}
