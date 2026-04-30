import type { ParsedRoleText, RoleFamilyHit } from "./types";
import {
  DEFAULT_GENERIC_TOKENS,
  DEFAULT_NOISE_STRONG,
  DEFAULT_NOISE_WEAK,
  DEFAULT_TOKEN_WEIGHT_BOOST,
} from "./defaultConfig";
import { collapseWs, tokenizeNormalized } from "./normalize";

function mergeSets(
  a: ReadonlySet<string>,
  b?: readonly string[] | ReadonlySet<string>,
): Set<string> {
  const out = new Set(a);
  if (b) {
    for (const x of b) {
      const t = x.trim().toLowerCase();
      if (t) out.add(t);
    }
  }
  return out;
}

function bigrams(tokens: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    s.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return s;
}

/**
 * Deterministic family inference from normalized tokens + bigrams.
 * Unknown titles may yield an empty list; the scorer still uses lexical evidence.
 */
export function inferRoleFamilies(
  tokens: readonly string[],
  extraGeneric?: ReadonlySet<string>,
): RoleFamilyHit[] {
  const generic = mergeSets(DEFAULT_GENERIC_TOKENS, extraGeneric);
  const set = new Set(tokens);
  const bg = bigrams(tokens);
  const byId = new Map<string, number>();

  const bump = (id: string, c: number) => {
    byId.set(id, Math.max(byId.get(id) ?? 0, c));
  };

  if (bg.has("customer success") || (set.has("customer") && set.has("success"))) {
    bump("customer_success", bg.has("customer success") ? 0.92 : 0.82);
  }
  if (bg.has("technical support") || (set.has("technical") && set.has("support"))) {
    bump("technical_support", 0.88);
  } else if (set.has("customer") && set.has("support")) {
    bump("customer_support", 0.88);
  } else if (set.has("support") && !set.has("technical")) {
    bump("customer_support", 0.55);
  }

  if (bg.has("key account") || (set.has("key") && set.has("account"))) {
    bump("account_management", 0.9);
  } else if (set.has("account") && generic.has("manager")) {
    bump("account_management", 0.72);
  } else if (set.has("account") && (set.has("executive") || set.has("director"))) {
    bump("account_management", 0.68);
  }

  if (set.has("sales") || bg.has("enterprise sales")) {
    bump("sales", 0.85);
  }
  if (bg.has("account executive")) {
    bump("sales", Math.max(byId.get("sales") ?? 0, 0.62));
  }

  if (set.has("onboarding")) bump("onboarding", 0.8);
  if (set.has("implementation")) bump("implementation", 0.82);
  if (set.has("integration") || set.has("integrations")) {
    bump("integration", 0.84);
  }
  if (set.has("workflow") && set.has("integration")) {
    bump("solutions_consulting", 0.55);
  }
  if (set.has("consultant") || set.has("consulting")) {
    bump("solutions_consulting", Math.max(byId.get("solutions_consulting") ?? 0, 0.62));
  }

  if (bg.has("product operations") || (set.has("product") && set.has("operations"))) {
    bump("product", 0.62);
    bump("operations", 0.65);
  } else if (set.has("product") && (generic.has("manager") || set.has("owner"))) {
    bump("product", 0.72);
  } else if (set.has("operations") && !set.has("product")) {
    bump("operations", 0.58);
  }

  if (bg.has("site reliability") || set.has("sre")) bump("devops_sre", 0.9);
  if (set.has("devops")) bump("devops_sre", Math.max(byId.get("devops_sre") ?? 0, 0.88));
  if (set.has("reliability") && generic.has("engineer")) {
    bump("devops_sre", Math.max(byId.get("devops_sre") ?? 0, 0.78));
  }

  if (bg.has("data engineer") || (set.has("data") && generic.has("engineer"))) {
    bump("data_engineering", 0.86);
  }
  if (set.has("platform") && generic.has("engineer")) {
    bump("platform_engineering", 0.82);
  }
  const hasEngFamily =
    (byId.get("data_engineering") ?? 0) > 0 ||
    (byId.get("platform_engineering") ?? 0) > 0 ||
    (byId.get("devops_sre") ?? 0) > 0;
  if (generic.has("engineer") && !hasEngFamily) {
    if (set.has("software") || set.has("backend") || set.has("frontend") || set.has("fullstack")) {
      bump("engineering", 0.78);
    } else if (set.has("engineer")) {
      bump("engineering", 0.55);
    }
  }

  if (bg.has("people operations") || (set.has("people") && set.has("operations"))) {
    bump("hr_people", 0.85);
  } else if (set.has("hr") || set.has("recruiter") || set.has("recruiting")) {
    bump("hr_people", set.has("hr") ? 0.8 : 0.72);
  }

  const joined = tokens.join(" ");
  if (joined.includes("fp a") || joined.includes("fpa") || set.has("fpa")) {
    bump("finance", Math.max(byId.get("finance") ?? 0, 0.78));
  }
  if (set.has("finance") && generic.has("analyst")) {
    bump("finance", Math.max(byId.get("finance") ?? 0, 0.72));
  }

  if (set.has("legal") || set.has("counsel")) {
    bump("legal", 0.78);
  }
  if (set.has("commercial") && set.has("contracts")) {
    bump("legal", Math.max(byId.get("legal") ?? 0, 0.65));
  }

  if (set.has("nurse") || set.has("nursing")) bump("nurse", 0.9);

  if (set.has("project") && (generic.has("manager") || set.has("management"))) {
    bump("project_management", 0.78);
  }

  const deduped: RoleFamilyHit[] = [...byId.entries()].map(([id, confidence]) => ({ id, confidence }));
  deduped.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  return deduped;
}

export function tokenBaseWeight(token: string, overrides?: Record<string, number>): number {
  const o = overrides?.[token];
  if (typeof o === "number" && Number.isFinite(o)) return Math.max(0.05, o);
  const b = DEFAULT_TOKEN_WEIGHT_BOOST[token];
  if (typeof b === "number" && Number.isFinite(b)) return Math.max(0.05, b);
  return 1;
}

export function parseRoleText(
  normalized: string,
  opts?: { extraNoise?: readonly string[]; extraGeneric?: readonly string[] },
): ParsedRoleText {
  const noiseStrong = mergeSets(DEFAULT_NOISE_STRONG, opts?.extraNoise);
  const noiseWeak = DEFAULT_NOISE_WEAK;
  const generic = mergeSets(DEFAULT_GENERIC_TOKENS, opts?.extraGeneric);

  const tokens = tokenizeNormalized(normalized);
  const ignoredTokens: string[] = [];
  const genericTokens: string[] = [];
  const modifiers: string[] = [];
  const seniorityHints: string[] = [];
  const industryHints: string[] = [];
  const coreTokens: string[] = [];

  const seniority = new Set([
    "junior",
    "senior",
    "sr",
    "principal",
    "staff",
    "lead",
    "entry",
    "mid",
    "midlevel",
    "intern",
  ]);

  for (const t of tokens) {
    if (t.length <= 1) {
      ignoredTokens.push(t);
      continue;
    }
    if (noiseStrong.has(t)) {
      ignoredTokens.push(t);
      if (seniority.has(t)) seniorityHints.push(t);
      continue;
    }
    if (noiseWeak.has(t)) {
      modifiers.push(t);
      continue;
    }
    if (generic.has(t)) {
      genericTokens.push(t);
      continue;
    }
    if (t.length >= 18) {
      industryHints.push(t);
    }
    coreTokens.push(t);
  }

  const roleFamilies = inferRoleFamilies(tokens, generic);

  return {
    normalized: collapseWs(normalized),
    tokens,
    coreTokens,
    genericTokens,
    ignoredTokens,
    roleFamilies,
    industryHints,
    seniorityHints,
    modifiers,
  };
}
