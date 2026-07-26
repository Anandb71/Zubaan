/**
 * The domain registry — why Zubaan generalizes beyond insurance.
 *
 * The primitive never changes: audit spoken vernacular against a written
 * obligation. A domain supplies only the SHAPE of the obligation — its
 * regulator, what agents commonly overstate (steers the contradiction check),
 * what must legally be said (drives the omission check), and how its terms are
 * edited. Adding NBFC lending, SEBI mutual funds, or medical consent is one
 * entry in this file. No engine changes, no new prompts, no schema migration.
 */

import { RequiredDisclosure, TermsFieldSpec } from "./schema";

export type DomainId = "insurance" | "lending" | "mutual_funds" | "medical_consent";

/**
 * A pattern the deterministic engine can check without any model.
 * `cue` matches the claim; `violatesWhen` decides if the terms contradict it.
 */
export interface ContradictionRule {
  id: string;
  /** Multilingual cues — English + Devanagari + common code-mix spellings. */
  cues: string[];
  /** Which term this claim is about (dotted path). */
  termPath: string;
  /** Contradiction when the term equals/does not equal this. */
  violatesWhen: (termValue: unknown) => boolean;
  severity: "low" | "high";
  describe: (termValue: unknown) => string;
  correction: (termValue: unknown) => string;
}

export interface DomainDef {
  id: DomainId;
  label: string;
  regulator: string;
  productNoun: string;
  /** Instruction to the reasoning model when generating required disclosures. */
  disclosurePolicy: string;
  /** Safety-net disclosures used when the model can't generate them. */
  baselineDisclosures: RequiredDisclosure[];
  /** Natural-language hints injected into the fast contradiction prompt. */
  contradictionHints: string[];
  /** Deterministic rules — the model-free backstop. */
  rules: ContradictionRule[];
  termsFields: TermsFieldSpec[];
}

// Cue vocabularies reused across domains. Code-mix is the norm, not the
// exception, so English and Indic spellings sit in the same list.
const GUARANTEE_CUES = [
  "guaranteed",
  "guarantee",
  "guranteed",
  "assured",
  "fixed return",
  "confirm return",
  "pakka",
  "pakka return",
  "गारंटी",
  "गारंटीड",
  "निश्चित",
  "श्योर",
  "sure shot",
  "100%",
  "no risk",
  "risk free",
  "koi risk nahi",
  "उறுதி",
  "உறுதி",
  "நிச்சயம்",
  "కచ్చితంగా",
  "ಖಚಿತ",
  "নিশ্চিত",
];

const ANYTIME_WITHDRAW_CUES = [
  "anytime",
  "any time",
  "whenever you want",
  "withdraw anytime",
  "kabhi bhi",
  "jab chahe",
  "जब चाहे",
  "कभी भी",
  "no lock",
  "lock in nahi",
  "koi lock",
  "full money back",
  "pura paisa wapas",
  "पूरा पैसा वापस",
  "எப்போது வேண்டுமானாலும்",
];

const NO_CHARGES_CUES = [
  "no charges",
  "no charge",
  "zero charges",
  "koi charge nahi",
  "kuch charge nahi",
  "कोई चार्ज नहीं",
  "बिना शुल्क",
  "no fees",
  "no penalty",
  "free hai",
  "கட்டணம் இல்லை",
];

export const DOMAINS: Record<DomainId, DomainDef> = {
  insurance: {
    id: "insurance",
    label: "Life & Investment Insurance",
    regulator: "IRDAI",
    productNoun: "policy",
    disclosurePolicy:
      "For an insurance product, an agent is obligated to clearly state: the lock-in period; " +
      "surrender charges and what the customer loses on early exit; that returns are NOT guaranteed " +
      "when the plan is market-linked; the free-look window; and any major exclusions. Generate one " +
      "disclosure per obligation, in plain language, each with why it is legally required.",
    baselineDisclosures: [
      {
        id: "lock_in",
        text: "State the lock-in period during which the policy cannot be surrendered without loss.",
        whyRequired:
          "IRDAI conduct norms require the customer to understand illiquidity before signing.",
        category: "liquidity",
        critical: true,
      },
      {
        id: "surrender_charges",
        text: "State the surrender charges and how much the customer loses on early exit.",
        whyRequired: "Early-exit penalties are a leading cause of mis-selling complaints.",
        category: "charges",
        critical: true,
      },
      {
        id: "returns_not_guaranteed",
        text: "State clearly that returns are not guaranteed for market-linked plans.",
        whyRequired:
          "Presenting projected returns as guaranteed is a prohibited unfair business practice.",
        category: "returns",
        critical: true,
      },
      {
        id: "free_look",
        text: "State the free-look window during which the policy can be returned for a refund.",
        whyRequired: "The free-look period is a mandatory cooling-off right.",
        category: "rights",
        critical: true,
      },
      {
        id: "exclusions",
        text: "State the major exclusions under which a claim would not be paid.",
        whyRequired: "Undisclosed exclusions cause claim rejection and are a top grievance driver.",
        category: "coverage",
        critical: false,
      },
    ],
    contradictionHints: [
      "returns described as 'guaranteed', 'fixed' or 'assured' when the plan is market-linked",
      "understating or omitting the lock-in period",
      "claiming 'full money back anytime' despite surrender charges",
      "promising a specific return percentage the document does not support",
      "describing the product as risk-free",
    ],
    rules: [
      {
        id: "guarantee_vs_nonguaranteed",
        cues: GUARANTEE_CUES,
        termPath: "guaranteed",
        violatesWhen: (v) => v === false,
        severity: "high",
        describe: () => "The document does not guarantee returns; they are market-linked.",
        correction: () =>
          "Returns are market-linked and not guaranteed. The figures shown are illustrative only.",
      },
      {
        id: "anytime_vs_lockin",
        cues: ANYTIME_WITHDRAW_CUES,
        termPath: "lockInYears",
        violatesWhen: (v) => typeof v === "number" && v > 0,
        severity: "high",
        describe: (v) => `The document specifies a lock-in period of ${String(v)} years.`,
        correction: (v) =>
          `This policy has a ${String(v)}-year lock-in. Money withdrawn before that is subject to surrender charges.`,
      },
      {
        id: "no_charges_vs_surrender",
        cues: NO_CHARGES_CUES,
        termPath: "surrenderCharges",
        violatesWhen: (v) => typeof v === "string" && v.trim().length > 0 && !/^none$/i.test(v),
        severity: "high",
        describe: (v) => `The document specifies surrender charges: ${String(v)}.`,
        correction: (v) => `Surrender charges apply on early exit: ${String(v)}.`,
      },
    ],
    termsFields: [
      { key: "guaranteed", label: "Returns guaranteed?", type: "bool" },
      { key: "returnsRange", label: "Returns range", type: "text", help: "e.g. 6–8% illustrative" },
      { key: "lockInYears", label: "Lock-in (years)", type: "number" },
      { key: "surrenderCharges", label: "Surrender charges", type: "text" },
      { key: "freeLookDays", label: "Free-look window (days)", type: "number" },
      { key: "liquidityTerms", label: "Liquidity terms", type: "text" },
      { key: "exclusions", label: "Exclusions", type: "list" },
    ],
  },

  lending: {
    id: "lending",
    label: "Loans & Credit (Bank / NBFC)",
    regulator: "RBI",
    productNoun: "loan",
    disclosurePolicy:
      "For a lending product, an agent is obligated to state: the all-inclusive Annual Percentage " +
      "Rate; processing and prepayment/foreclosure charges; whether the rate is fixed or floating; " +
      "the total amount repayable; and any collateral or guarantor obligation. One disclosure per " +
      "obligation, plain language, each with why it is required.",
    baselineDisclosures: [
      {
        id: "apr",
        text: "State the all-inclusive APR, not merely the flat or monthly rate.",
        whyRequired: "The RBI fair-practices code requires the effective annualized cost to be disclosed.",
        category: "cost",
        critical: true,
      },
      {
        id: "charges",
        text: "State processing fees and prepayment or foreclosure charges.",
        whyRequired: "Hidden charges are a primary source of lending grievances.",
        category: "charges",
        critical: true,
      },
      {
        id: "rate_type",
        text: "State whether the interest rate is fixed or floating.",
        whyRequired: "Floating rates change the EMI; the borrower must consent knowingly.",
        category: "terms",
        critical: true,
      },
      {
        id: "total_repayable",
        text: "State the total amount repayable over the full tenure.",
        whyRequired: "Borrowers routinely underestimate total cost from the EMI alone.",
        category: "cost",
        critical: false,
      },
    ],
    contradictionHints: [
      "quoting a flat or monthly rate as if it were the APR",
      "claiming 'no charges' when processing or prepayment fees apply",
      "describing a floating rate as fixed",
      "understating the total repayable amount",
    ],
    rules: [
      {
        id: "no_charges_vs_processing_fee",
        cues: NO_CHARGES_CUES,
        termPath: "attributes.processing_fee",
        violatesWhen: (v) => typeof v === "string" && v.trim().length > 0 && !/^(none|0|nil)$/i.test(v),
        severity: "high",
        describe: (v) => `The document specifies a processing fee: ${String(v)}.`,
        correction: (v) => `A processing fee of ${String(v)} applies to this loan.`,
      },
      {
        id: "fixed_vs_floating",
        cues: ["fixed rate", "rate fixed", "same emi", "emi nahi badlega", "ब्याज नहीं बदलेगा", "फिक्स्ड"],
        termPath: "attributes.rate_type",
        violatesWhen: (v) => typeof v === "string" && /float/i.test(v),
        severity: "high",
        describe: () => "The document specifies a floating interest rate.",
        correction: () => "This is a floating-rate loan; the EMI can change when benchmark rates move.",
      },
    ],
    termsFields: [
      { key: "attributes.apr", label: "APR (%)", type: "text" },
      { key: "attributes.processing_fee", label: "Processing fee", type: "text" },
      { key: "attributes.prepayment_penalty", label: "Prepayment penalty", type: "text" },
      { key: "attributes.rate_type", label: "Rate type", type: "text", help: "fixed | floating" },
      { key: "attributes.total_repayable", label: "Total repayable", type: "text" },
    ],
  },

  mutual_funds: {
    id: "mutual_funds",
    label: "Mutual Funds & Investments",
    regulator: "SEBI",
    productNoun: "scheme",
    disclosurePolicy:
      "For a mutual-fund product, a distributor is obligated to state: that investments are subject " +
      "to market risk and past performance does not guarantee future returns; the expense ratio; any " +
      "exit load and the holding period it applies to; and the scheme's risk category. One disclosure " +
      "per obligation, plain language, each with why it is required.",
    baselineDisclosures: [
      {
        id: "market_risk",
        text: "State that investments are subject to market risk and past performance does not indicate future returns.",
        whyRequired: "SEBI mandates this risk disclaimer for all mutual-fund solicitation.",
        category: "risk",
        critical: true,
      },
      {
        id: "expense_ratio",
        text: "State the scheme's expense ratio.",
        whyRequired: "Ongoing costs materially reduce net returns and must be disclosed.",
        category: "cost",
        critical: true,
      },
      {
        id: "exit_load",
        text: "State any exit load and the holding period it applies to.",
        whyRequired: "Exit loads reduce redemption value; investors must be informed.",
        category: "charges",
        critical: true,
      },
    ],
    contradictionHints: [
      "presenting past returns as assured future returns",
      "omitting the market-risk disclaimer",
      "claiming 'no charges' despite an exit load or expense ratio",
      "describing a fund as safer than its documented risk category",
    ],
    rules: [
      {
        id: "guaranteed_vs_market_risk",
        cues: GUARANTEE_CUES,
        termPath: "guaranteed",
        violatesWhen: (v) => v === false || v === undefined,
        severity: "high",
        describe: () => "Mutual fund returns are subject to market risk and are never guaranteed.",
        correction: () =>
          "Returns are subject to market risk. Past performance does not guarantee future returns.",
      },
      {
        id: "no_charges_vs_exit_load",
        cues: NO_CHARGES_CUES,
        termPath: "attributes.exit_load",
        violatesWhen: (v) => typeof v === "string" && v.trim().length > 0 && !/^(none|0|nil)$/i.test(v),
        severity: "high",
        describe: (v) => `The scheme carries an exit load: ${String(v)}.`,
        correction: (v) => `An exit load of ${String(v)} applies if you redeem early.`,
      },
    ],
    termsFields: [
      { key: "attributes.expense_ratio", label: "Expense ratio (%)", type: "text" },
      { key: "attributes.exit_load", label: "Exit load", type: "text" },
      { key: "attributes.risk_category", label: "Risk category", type: "text" },
      { key: "guaranteed", label: "Returns guaranteed?", type: "bool" },
    ],
  },

  medical_consent: {
    id: "medical_consent",
    label: "Medical Procedure Consent",
    regulator: "Informed-consent law",
    productNoun: "procedure",
    disclosurePolicy:
      "For a medical procedure, the clinician is obligated to state: the material risks and their " +
      "likelihood; the reasonable alternatives including choosing not to proceed; that the expected " +
      "benefit is not guaranteed; and the cost. One disclosure per obligation, plain language, each " +
      "with why it is required.",
    baselineDisclosures: [
      {
        id: "material_risks",
        text: "State the material risks of the procedure and their likelihood.",
        whyRequired: "Consent is not informed without disclosure of material risks.",
        category: "risk",
        critical: true,
      },
      {
        id: "alternatives",
        text: "State the reasonable alternatives, including choosing not to proceed.",
        whyRequired: "Patients must be able to weigh alternatives for consent to be meaningful.",
        category: "options",
        critical: true,
      },
      {
        id: "outcome_not_guaranteed",
        text: "State that the expected benefit is not guaranteed.",
        whyRequired: "Guaranteeing a clinical outcome invalidates informed consent.",
        category: "outcome",
        critical: true,
      },
    ],
    contradictionHints: [
      "guaranteeing a successful outcome",
      "downplaying or omitting known material risks",
      "failing to mention alternatives",
    ],
    rules: [
      {
        id: "guaranteed_outcome",
        cues: [...GUARANTEE_CUES, "definitely work", "100% success", "पक्का ठीक"],
        termPath: "guaranteed",
        violatesWhen: (v) => v === false || v === undefined,
        severity: "high",
        describe: () => "Clinical outcomes cannot be guaranteed.",
        correction: () =>
          "The procedure is expected to help, but the outcome cannot be guaranteed.",
      },
    ],
    termsFields: [
      { key: "attributes.material_risks", label: "Material risks", type: "list" },
      { key: "attributes.alternatives", label: "Alternatives", type: "list" },
      { key: "attributes.cost", label: "Cost", type: "text" },
    ],
  },
};

export const DEFAULT_DOMAIN: DomainId = "insurance";

export function getDomain(id: string | null | undefined): DomainDef {
  if (id && id in DOMAINS) return DOMAINS[id as DomainId];
  return DOMAINS[DEFAULT_DOMAIN];
}

export function listDomains(): DomainDef[] {
  return Object.values(DOMAINS);
}

export function isDomainId(id: string): id is DomainId {
  return id in DOMAINS;
}
