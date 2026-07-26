import type { Agent, Product, Violation } from "@/lib/models";
import type { ScriptedUtterance } from "@/lib/sarvam/stt-client";

/**
 * Explicit development/demo fixture. Production repositories and request
 * handlers must never import this module except routes under /api/demo.
 */
export const DEMO_PRODUCT: Product = {
  id: "suraksha-growth-plus",
  name: "Suraksha Growth Plus ULIP",
  domain: "insurance",
  pdfUrl: "/demo/suraksha-growth-plus.pdf",
  terms: {
    domain: "insurance",
    guaranteed: false,
    returnsRange: "6–8% illustrative; market-linked",
    lockInYears: 5,
    surrenderCharges: "Up to 30% of fund value in policy years 1–3",
    exclusions: [
      "Suicide within the first 12 months",
      "Claims involving material facts not disclosed at purchase",
    ],
    liquidityTerms: "No withdrawal is permitted during the five-year lock-in",
    freeLookDays: 15,
  },
  requiredDisclosures: [
    {
      id: "lock_in",
      text: "State the five-year lock-in period.",
      whyRequired: "The customer must understand when their money cannot be withdrawn.",
      category: "liquidity",
      critical: true,
    },
    {
      id: "surrender_charges",
      text: "State the surrender charges and loss on early exit.",
      whyRequired: "Early-exit charges can materially reduce the customer's savings.",
      category: "charges",
      critical: true,
    },
    {
      id: "returns_not_guaranteed",
      text: "State that returns are market-linked and not guaranteed.",
      whyRequired: "Projected returns cannot be presented as certain.",
      category: "returns",
      critical: true,
    },
    {
      id: "free_look",
      text: "State the 15-day free-look window.",
      whyRequired: "The customer has a cooling-off right after receiving the policy.",
      category: "rights",
      critical: true,
    },
    {
      id: "exclusions",
      text: "State the major claim exclusions.",
      whyRequired: "The customer must know when the insurer may not pay a claim.",
      category: "coverage",
      critical: false,
    },
  ],
  createdAt: "2026-07-26T06:00:00.000Z",
};

export const DEMO_AGENTS: Agent[] = [
  { id: "agt-meera", name: "Meera Singh", branch: "Patna Main" },
  { id: "agt-arjun", name: "Arjun Nair", branch: "Kochi MG Road" },
  { id: "agt-sana", name: "Sana Sheikh", branch: "Pune Camp" },
  { id: "agt-vikram", name: "Vikram Patel", branch: "Ahmedabad West" },
  { id: "agt-kavya", name: "Kavya Reddy", branch: "Hyderabad Central" },
  { id: "agt-rahul", name: "Rahul Das", branch: "Kolkata North" },
];

export const DEMO_SCRIPT: ScriptedUtterance[] = [
  {
    atMs: 700,
    text: "Namaste Sunita ji. Aaj main aapko Suraksha Growth Plus policy samjhaunga.",
    language: "hi-IN",
  },
  {
    atMs: 4_800,
    text: "Is plan mein aapko guaranteed 12 percent return milega, bilkul pakka.",
    language: "hi-IN",
  },
  {
    atMs: 9_000,
    text: "Aur lock in sirf 2 years ka hai, uske baad paisa nikaal sakte hain.",
    language: "hi-IN",
  },
  {
    atMs: 13_200,
    text: "Main exact terms clear kar doon: policy ka official lock in 5 saal hai.",
    language: "hi-IN",
  },
  {
    atMs: 17_400,
    text: "Returns market linked hain aur guarantee nahi hai.",
    language: "hi-IN",
  },
  {
    atMs: 21_600,
    text: "Pehle teen saal surrender karne par fund value ka 30 percent tak charge lag sakta hai.",
    language: "hi-IN",
  },
  {
    atMs: 25_800,
    text: "Major exclusions mein pehle 12 months mein suicide aur undisclosed facts shamil hain.",
    language: "hi-IN",
  },
];

const languages = ["hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN"] as const;
const promises = [
  "Guaranteed 12% return",
  "Withdraw anytime",
  "No surrender charge",
  "Risk-free investment",
] as const;

export function seedViolations(): Violation[] {
  return Array.from({ length: 40 }, (_, index) => {
    const language = languages[index % languages.length]!;
    const promise = promises[index % promises.length]!;
    const omission = index % 5 === 4;
    return {
      id: `seed-v-${String(index + 1).padStart(2, "0")}`,
      callId: `seed-call-${String(Math.floor(index / 2) + 1).padStart(2, "0")}`,
      kind: omission ? "omission" : "contradiction",
      tsMs: omission ? 0 : 4_000 + index * 250,
      utterance: omission ? "" : promise,
      claimMade: omission ? undefined : promise,
      contradictedBy: omission
        ? "The required disclosure was never stated."
        : "The official product document does not support this promise.",
      severity: index % 7 === 0 ? "low" : "high",
      suggestedCorrection: omission
        ? undefined
        : "Use the exact documented term and explain that projected returns are not guaranteed.",
      disclosureId: omission ? "free_look" : undefined,
      detectedLang: language,
      source: "both",
      createdAt: new Date(
        Date.UTC(2026, 6, 20 + (index % 6), 9 + (index % 7)),
      ).toISOString(),
    };
  });
}

export const SEED_CALL_AGENT = Object.fromEntries(
  Array.from({ length: 50 }, (_, index) => [
    `seed-call-${String(index + 1).padStart(2, "0")}`,
    DEMO_AGENTS[index % DEMO_AGENTS.length]!.id,
  ]),
) as Record<string, string>;
