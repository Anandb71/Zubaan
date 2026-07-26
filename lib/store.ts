import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { config } from "@/lib/config";
import { log, uuid } from "@/lib/kernel";
import type { Agent, Audit, Call, Product, Utterance, Violation } from "@/lib/models";

const storeLog = log.child({ mod: "store" });

export interface CreateCallInput {
  agentId: string;
  productId: string;
  customerName: string;
  customerLang: string;
}

export interface SaveAuditInput {
  callId: string;
  summaryText: string;
  summaryLang: string;
  audioUrl?: string;
  promised: string[];
  actual: string[];
  gaps: string[];
  degraded: boolean;
}

interface State {
  products: Map<string, Product>;
  agents: Map<string, Agent>;
  calls: Map<string, Call>;
  violations: Map<string, Violation>;
  audits: Map<string, Audit>;
}

function initialState(): State {
  return {
    products: new Map(),
    agents: new Map(),
    calls: new Map(),
    violations: new Map(),
    audits: new Map(),
  };
}

class ZubaanStore {
  private readonly state = initialState();
  private readonly db: SupabaseClient | null;

  constructor() {
    // Legacy server store is privileged. Never silently use the browser key
    // for server writes; that masks broken RLS and misconfigured deployments.
    const key = config.storage.serviceKey;
    this.db =
      config.storage.url && key
        ? createClient(config.storage.url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
  }

  mode(): "supabase" | "memory" {
    return this.db ? "supabase" : "memory";
  }

  async listProducts(): Promise<Product[]> {
    if (this.db) {
      const { data, error } = await this.db
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        storeLog.warn("supabase product list failed", { message: error.message });
      } else {
        for (const row of data ?? []) {
          const product = productFromRow(row);
          this.state.products.set(product.id, product);
        }
      }
    }
    return [...this.state.products.values()].map((product) => structuredClone(product));
  }

  async getProduct(id: string): Promise<Product | null> {
    const local = this.state.products.get(id);
    if (local) return structuredClone(local);
    if (!this.db) return null;

    const { data, error } = await this.db.from("products").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      if (error) storeLog.warn("supabase product read failed", { message: error.message });
      return null;
    }
    const product = productFromRow(data);
    this.state.products.set(product.id, product);
    return structuredClone(product);
  }

  async saveProduct(product: Product): Promise<Product> {
    const clean = structuredClone(product);
    this.state.products.set(clean.id, clean);
    await this.mirror("products", productToRow(clean));
    return structuredClone(clean);
  }

  async listAgents(): Promise<Agent[]> {
    if (this.db) {
      const { data, error } = await this.db
        .from("agents")
        .select("id,name,branch")
        .order("name");
      if (error) {
        storeLog.warn("supabase agent list failed", { message: error.message });
      } else {
        for (const row of data ?? []) {
          const agent = agentFromRow(row);
          this.state.agents.set(agent.id, agent);
        }
      }
    }
    return [...this.state.agents.values()].map((agent) => ({ ...agent }));
  }

  async saveAgent(agent: Agent): Promise<Agent> {
    const clean = { ...agent };
    this.state.agents.set(clean.id, clean);
    await this.mirror("agents", clean);
    return { ...clean };
  }

  async createCall(input: CreateCallInput): Promise<Call> {
    const call: Call = {
      id: uuid(),
      ...input,
      startedAt: new Date().toISOString(),
      status: "active",
      transcript: [],
      satisfiedDisclosureIds: [],
    };
    this.state.calls.set(call.id, call);
    await this.mirror("calls", callToRow(call));
    return structuredClone(call);
  }

  async getCall(id: string): Promise<Call | null> {
    const local = this.state.calls.get(id);
    if (local) return structuredClone(local);
    if (!this.db) return null;

    const { data, error } = await this.db.from("calls").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      if (error) storeLog.warn("supabase call read failed", { message: error.message });
      return null;
    }
    const call = callFromRow(data);
    this.state.calls.set(call.id, call);
    return structuredClone(call);
  }

  async listCalls(): Promise<Call[]> {
    if (this.db) {
      const { data, error } = await this.db
        .from("calls")
        .select("*")
        .order("started_at", { ascending: false });
      if (error) {
        storeLog.warn("supabase call list failed", { message: error.message });
      } else {
        for (const row of data ?? []) {
          const call = callFromRow(row);
          this.state.calls.set(call.id, call);
        }
      }
    }
    return [...this.state.calls.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((call) => structuredClone(call));
  }

  async appendWindow(
    callId: string,
    utterances: Utterance[],
    satisfiedIds: string[],
    detectedLang?: string,
  ): Promise<Call | null> {
    const call = await this.getCall(callId);
    if (!call) return null;

    const seen = new Set(call.satisfiedDisclosureIds);
    for (const id of satisfiedIds) seen.add(id);
    call.transcript.push(...utterances.map((utterance) => structuredClone(utterance)));
    call.satisfiedDisclosureIds = [...seen];
    if (detectedLang) call.detectedLang = detectedLang;
    this.state.calls.set(call.id, call);
    await this.mirror("calls", callToRow(call));
    return structuredClone(call);
  }

  async finishCall(id: string): Promise<Call | null> {
    const call = await this.getCall(id);
    if (!call) return null;
    call.status = "ended";
    call.endedAt = new Date().toISOString();
    this.state.calls.set(id, call);
    await this.mirror("calls", callToRow(call));
    return structuredClone(call);
  }

  async markAudited(id: string): Promise<void> {
    const call = await this.getCall(id);
    if (!call) return;
    call.status = "audited";
    this.state.calls.set(id, call);
    await this.mirror("calls", callToRow(call));
  }

  async saveViolation(
    input: Omit<Violation, "id" | "createdAt"> & Partial<Pick<Violation, "id" | "createdAt">>,
  ): Promise<Violation> {
    const existing = [...this.state.violations.values()].find(
      (item) =>
        item.callId === input.callId &&
        item.kind === input.kind &&
        item.disclosureId === input.disclosureId &&
        item.utterance === input.utterance,
    );
    if (existing) return structuredClone(existing);

    const violation: Violation = {
      ...input,
      id: input.id ?? uuid(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.state.violations.set(violation.id, violation);
    await this.mirror("violations", violationToRow(violation));
    return structuredClone(violation);
  }

  async listViolations(callId?: string): Promise<Violation[]> {
    if (this.db) {
      let query = this.db
        .from("violations")
        .select("*")
        .order("created_at", { ascending: false });
      if (callId) query = query.eq("call_id", callId);
      const { data, error } = await query;
      if (error) {
        storeLog.warn("supabase violation list failed", { message: error.message });
      } else {
        for (const row of data ?? []) {
          const violation = violationFromRow(row);
          this.state.violations.set(violation.id, violation);
        }
      }
    }
    return [...this.state.violations.values()]
      .filter((violation) => !callId || violation.callId === callId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((violation) => structuredClone(violation));
  }

  async saveAudit(input: SaveAuditInput): Promise<Audit> {
    const audit: Audit = {
      id: uuid(),
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.state.audits.set(audit.id, audit);
    await this.mirror("audits", auditToRow(audit));
    await this.markAudited(input.callId);
    return structuredClone(audit);
  }

  async getAudit(id: string): Promise<Audit | null> {
    const local = this.state.audits.get(id);
    if (local) return structuredClone(local);
    if (!this.db) return null;

    const { data, error } = await this.db.from("audits").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      if (error) storeLog.warn("supabase audit read failed", { message: error.message });
      return null;
    }
    const audit = auditFromRow(data);
    this.state.audits.set(audit.id, audit);
    return structuredClone(audit);
  }

  async uploadAudio(callId: string, audioBase64: string): Promise<string | null> {
    if (!this.db || !audioBase64) return null;
    try {
      const bytes = Uint8Array.from(Buffer.from(audioBase64, "base64"));
      const path = `${callId}/${Date.now()}.wav`;
      const { error } = await this.db.storage.from("audit-audio").upload(path, bytes, {
        contentType: "audio/wav",
        upsert: true,
      });
      if (error) {
        storeLog.warn("audio upload failed", { message: error.message });
        return null;
      }
      const { data, error: signError } = await this.db.storage
        .from("audit-audio")
        .createSignedUrl(path, 60 * 60);
      if (signError) {
        storeLog.warn("audio signing failed", { message: signError.message });
        return null;
      }
      return data.signedUrl;
    } catch (cause) {
      storeLog.warn("audio upload threw", { cause: String(cause) });
      return null;
    }
  }

  private async mirror(table: string, row: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    const { error } = await this.db.from(table).upsert(row);
    if (error) {
      // Persistence failure cannot take down the live call. The in-process copy
      // stays usable and the health endpoint makes the degraded state visible.
      storeLog.warn("supabase mirror failed", { table, message: error.message });
    }
  }
}

declare global {
  var __zubaanStore: ZubaanStore | undefined;
}

export const store = globalThis.__zubaanStore ?? new ZubaanStore();
if (process.env.NODE_ENV !== "production") globalThis.__zubaanStore = store;

function agentFromRow(row: Record<string, unknown>): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    branch: String(row.branch),
  };
}

function productToRow(product: Product): Record<string, unknown> {
  return {
    id: product.id,
    name: product.name,
    domain: product.domain,
    pdf_url: product.pdfUrl ?? null,
    terms_json: product.terms,
    required_disclosures: product.requiredDisclosures.map((item) => ({
      id: item.id,
      text: item.text,
      why_required: item.whyRequired,
      category: item.category,
      critical: item.critical,
    })),
    created_at: product.createdAt,
  };
}

function productFromRow(row: Record<string, unknown>): Product {
  const disclosures = Array.isArray(row.required_disclosures) ? row.required_disclosures : [];
  return {
    id: String(row.id),
    name: String(row.name),
    domain: String(row.domain ?? "insurance") as Product["domain"],
    pdfUrl: row.pdf_url ? String(row.pdf_url) : undefined,
    terms: (row.terms_json ?? {}) as Product["terms"],
    requiredDisclosures: disclosures.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(item.id),
        text: String(item.text),
        whyRequired: String(item.why_required ?? item.whyRequired ?? ""),
        category: item.category ? String(item.category) : undefined,
        critical: item.critical !== false,
      };
    }),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function callToRow(call: Call): Record<string, unknown> {
  return {
    id: call.id,
    agent_id: call.agentId,
    product_id: call.productId,
    customer_name: call.customerName,
    customer_lang: call.customerLang,
    detected_lang: call.detectedLang ?? null,
    started_at: call.startedAt,
    ended_at: call.endedAt ?? null,
    status: call.status,
    transcript: call.transcript,
    satisfied_disclosure_ids: call.satisfiedDisclosureIds,
  };
}

function callFromRow(row: Record<string, unknown>): Call {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    productId: String(row.product_id),
    customerName: String(row.customer_name),
    customerLang: String(row.customer_lang),
    detectedLang: row.detected_lang ? String(row.detected_lang) : undefined,
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
    status: String(row.status) as Call["status"],
    transcript: (Array.isArray(row.transcript) ? row.transcript : []) as Utterance[],
    satisfiedDisclosureIds: Array.isArray(row.satisfied_disclosure_ids)
      ? row.satisfied_disclosure_ids.map(String)
      : [],
  };
}

function violationToRow(violation: Violation): Record<string, unknown> {
  return {
    id: violation.id,
    call_id: violation.callId,
    kind: violation.kind,
    ts_ms: violation.tsMs,
    utterance: violation.utterance,
    claim_made: violation.claimMade ?? null,
    contradicted_by: violation.contradictedBy ?? null,
    severity: violation.severity,
    suggested_correction: violation.suggestedCorrection ?? null,
    disclosure_id: violation.disclosureId ?? null,
    detected_lang: violation.detectedLang ?? null,
    source: violation.source,
    created_at: violation.createdAt,
  };
}

function violationFromRow(row: Record<string, unknown>): Violation {
  return {
    id: String(row.id),
    callId: String(row.call_id),
    kind: String(row.kind) as Violation["kind"],
    tsMs: Number(row.ts_ms ?? 0),
    utterance: String(row.utterance ?? ""),
    claimMade: row.claim_made ? String(row.claim_made) : undefined,
    contradictedBy: row.contradicted_by ? String(row.contradicted_by) : undefined,
    severity: String(row.severity ?? "high") as Violation["severity"],
    suggestedCorrection: row.suggested_correction
      ? String(row.suggested_correction)
      : undefined,
    disclosureId: row.disclosure_id ? String(row.disclosure_id) : undefined,
    detectedLang: row.detected_lang ? String(row.detected_lang) : undefined,
    source: String(row.source ?? "model") as Violation["source"],
    createdAt: String(row.created_at),
  };
}

function auditToRow(audit: Audit): Record<string, unknown> {
  return {
    id: audit.id,
    call_id: audit.callId,
    summary_text: audit.summaryText,
    summary_lang: audit.summaryLang,
    audio_url: audit.audioUrl ?? null,
    promised: audit.promised,
    actual: audit.actual,
    gaps: audit.gaps,
    degraded: audit.degraded,
    created_at: audit.createdAt,
  };
}

function auditFromRow(row: Record<string, unknown>): Audit {
  return {
    id: String(row.id),
    callId: String(row.call_id),
    summaryText: String(row.summary_text),
    summaryLang: String(row.summary_lang),
    audioUrl: row.audio_url ? String(row.audio_url) : undefined,
    promised: Array.isArray(row.promised) ? row.promised.map(String) : [],
    actual: Array.isArray(row.actual) ? row.actual.map(String) : [],
    gaps: Array.isArray(row.gaps) ? row.gaps.map(String) : [],
    degraded: Boolean(row.degraded),
    createdAt: String(row.created_at),
  };
}
