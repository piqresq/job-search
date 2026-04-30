import {
  DEFAULT_ADJACENCY,
  DEFAULT_FAMILY_ADJACENCY,
  DEFAULT_FAMILY_CONFLICT,
  DEFAULT_PENALTIES,
  DEFAULT_ROLE_HEAD_MISMATCH_RULES,
  DEFAULT_SYNONYMS,
} from "./defaultConfig";
import {
  adjacentFamilyStrength,
  familyConflictStrength,
  mergeFamilyAdjacency,
  mergeFamilyConflict,
} from "./familyConfig";
import { normalizeRoleText } from "./normalize";
import { inferRoleFamilies, parseRoleText, tokenBaseWeight } from "./parse";
import type {
  ParsedRoleText,
  RoleFamilyHit,
  RoleHeadMismatchRule,
  TitleQueryHealthBand,
  TitleQueryHealthResult,
  VendorTitleHealthOptions,
} from "./types";

const CONF_FAMILY = 0.45;

/** Role-tail tokens: generic bucket but stable enough to corroborate adjacency when a query core exists. */
const ADJACENCY_CORROBORATION_GENERIC_TOKENS = new Set<string>(["consultant", "specialist", "advisor"]);

/** When query carries an infra core token, these generics can corroborate adjacency (e.g. DevOps Engineer vs SRE title). */
const ADJACENCY_INFRA_CORE = new Set<string>(["devops", "sre", "kubernetes", "k8s", "terraform"]);
const ADJACENCY_INFRA_CORROB_GENERIC = new Set<string>(["engineer", "developer", "programmer"]);

const ADJACENCY_FINANCE_LEX = new Set<string>(["finance", "fpa", "fp"]);

/**
 * Maps the sum of positive components (phrase + coverage + family + expansion, max ~9 before penalties)
 * onto 0..10 after penalties are applied. Documented tuning knob — not hidden magic inside sub-formulas.
 */
const TITLE_HEALTH_POSITIVE_SUM_TARGET = 9.35;

function mergeSynonyms(
  base: Record<string, readonly string[]>,
  over?: Record<string, string[]>,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (k: string, vals: readonly string[]) => {
    const key = k.toLowerCase();
    let s = m.get(key);
    if (!s) {
      s = new Set();
      m.set(key, s);
    }
    s.add(key);
    for (const v of vals) s.add(v.toLowerCase());
  };
  for (const [k, vals] of Object.entries(base)) add(k, vals);
  if (over) for (const [k, vals] of Object.entries(over)) add(k, vals);
  return m;
}

function mergeAdjacency(
  base: Record<string, readonly string[]>,
  over?: Record<string, string[]>,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (k: string, vals: readonly string[]) => {
    const key = k.toLowerCase();
    let s = m.get(key);
    if (!s) {
      s = new Set();
      m.set(key, s);
    }
    for (const v of vals) {
      const t = v.toLowerCase();
      s.add(t);
      let r = m.get(t);
      if (!r) {
        r = new Set();
        m.set(t, r);
      }
      r.add(key);
    }
  };
  for (const [k, vals] of Object.entries(base)) add(k, vals);
  if (over) for (const [k, vals] of Object.entries(over)) add(k, vals);
  return m;
}

/** Title surface tokens plus one-hop synonym expansion (no adjacency). */
function expandSynonymsOnly(tokens: Set<string>, syn: Map<string, Set<string>>): Set<string> {
  const out = new Set(tokens);
  for (const t of tokens) {
    const s = syn.get(t);
    if (s) for (const x of s) out.add(x);
  }
  return out;
}

/** At least one query core token hits the title literally or via synonym (not adjacency). */
function hasCoreCorroboration(
  pq: ParsedRoleText,
  titleTok: Set<string>,
  syn: Map<string, Set<string>>,
): boolean {
  for (const t of pq.coreTokens) {
    if (titleTok.has(t)) return true;
    const alts = syn.get(t);
    if (alts) for (const x of alts) if (titleTok.has(x)) return true;
  }
  return false;
}

/**
 * Adjacency is gated: require a core literal/syn hit, OR a stable role-tail generic (consultant/specialist/advisor)
 * present on both sides while the query still has at least one core token (prevents manager-only overlap).
 */
function hasCorroborationForAdjacency(
  pq: ParsedRoleText,
  titleTok: Set<string>,
  syn: Map<string, Set<string>>,
): boolean {
  if (hasCoreCorroboration(pq, titleTok, syn)) return true;
  if (pq.coreTokens.length === 0) return false;
  for (const g of pq.genericTokens) {
    if (!ADJACENCY_CORROBORATION_GENERIC_TOKENS.has(g)) continue;
    if (titleTok.has(g)) return true;
    const alts = syn.get(g);
    if (alts) for (const x of alts) if (titleTok.has(x)) return true;
  }
  const queryInfra = pq.tokens.some((t) => ADJACENCY_INFRA_CORE.has(t));
  if (queryInfra) {
    for (const g of pq.genericTokens) {
      if (!ADJACENCY_INFRA_CORROB_GENERIC.has(g)) continue;
      if (titleTok.has(g)) return true;
      const alts = syn.get(g);
      if (alts) for (const x of alts) if (titleTok.has(x)) return true;
    }
  }
  const queryFin = pq.tokens.some((t) => ADJACENCY_FINANCE_LEX.has(t));
  const titleFin = [...titleTok].some((t) => ADJACENCY_FINANCE_LEX.has(t));
  if (queryFin && titleFin) return true;
  return false;
}

function tokenMatchKind(
  q: string,
  titleTok: Set<string>,
  titleSynOnly: Set<string>,
  syn: Map<string, Set<string>>,
  adj: Map<string, Set<string>>,
  allowAdjacent: boolean,
): "exact" | "synonym" | "adjacent" | "none" {
  if (titleTok.has(q)) return "exact";
  if (titleSynOnly.has(q)) return "synonym";
  if (!allowAdjacent) return "none";
  const neigh = adj.get(q);
  if (!neigh) return "none";
  for (const x of neigh) {
    if (titleSynOnly.has(x)) return "adjacent";
  }
  return "none";
}

function subsequenceScore(qTokens: string[], tTokens: string[]): number {
  let i = 0;
  for (const t of tTokens) {
    if (i < qTokens.length && t === qTokens[i]) i++;
  }
  return i / Math.max(1, qTokens.length);
}

function familySimilarityComponent(
  qf: RoleFamilyHit[],
  tf: RoleFamilyHit[],
  famAdj: readonly { a: string; b: string; strength: number }[],
): number {
  const qc = qf.filter((h) => h.confidence >= CONF_FAMILY);
  const tc = tf.filter((h) => h.confidence >= CONF_FAMILY);
  if (qc.length === 0 && tc.length === 0) return 0.55;
  if (qc.length === 0 || tc.length === 0) return 0.38;

  let best = 0;
  for (const a of qc.slice(0, 4)) {
    for (const b of tc.slice(0, 4)) {
      const c = Math.min(a.confidence, b.confidence);
      if (a.id === b.id) {
        best = Math.max(best, 2 * c);
        continue;
      }
      const adj = adjacentFamilyStrength(a.id, b.id, famAdj);
      if (adj > 0) best = Math.max(best, 2 * adj * c);
    }
  }
  return Math.min(2, best);
}

function bandFromScore(score: number): TitleQueryHealthBand {
  if (score >= 10) return "exact";
  if (score >= 9) return "strong";
  if (score >= 7) return "good";
  if (score >= 6) return "moderate";
  if (score >= 4) return "weak";
  if (score >= 2) return "poor";
  return "unrelated";
}

function parseSnapshot(p: ParsedRoleText) {
  return {
    normalized: p.normalized,
    tokens: [...p.tokens],
    coreTokens: [...p.coreTokens],
    genericTokens: [...p.genericTokens],
    ignoredTokens: [...p.ignoredTokens],
    modifiers: [...p.modifiers],
    industryHints: [...p.industryHints],
    seniorityHints: [...p.seniorityHints],
    roleFamilies: p.roleFamilies.map((h) => ({ id: h.id, confidence: h.confidence })),
  };
}

function penaltiesFor(
  pq: ParsedRoleText,
  pt: ParsedRoleText,
  queryCoreMatched: boolean,
  genericOnlyOverlap: boolean,
  po: VendorTitleHealthOptions["penaltyOverrides"],
  famConflict: readonly { a: string; b: string; weight: number }[],
  roleHeadRules: readonly RoleHeadMismatchRule[],
): { total: number; labels: string[]; phraseFloorsFromRoleHead: number[] } {
  const P = { ...DEFAULT_PENALTIES, ...po };
  let total = 0;
  const labels: string[] = [];
  const phraseFloorsFromRoleHead: number[] = [];

  const qf = new Set(pq.roleFamilies.filter((h) => h.confidence >= CONF_FAMILY).map((h) => h.id));
  const tf = new Set(pt.roleFamilies.filter((h) => h.confidence >= CONF_FAMILY).map((h) => h.id));

  const appliedRoleHeadIds = new Set<string>();
  for (const rule of roleHeadRules) {
    const qHit = rule.queryFamiliesAny.some((f) => qf.has(f));
    const tHit = rule.titleFamiliesAny.some((f) => tf.has(f));
    const lacksOk = !rule.titleMustLackToken || !pt.tokens.includes(rule.titleMustLackToken);
    if (qHit && tHit && lacksOk) {
      const amt = P[rule.penaltyKey];
      if (typeof amt === "number" && Number.isFinite(amt)) {
        total += amt;
        labels.push(rule.id);
        appliedRoleHeadIds.add(rule.id);
        if (typeof rule.phraseFloorWhenMatched === "number" && Number.isFinite(rule.phraseFloorWhenMatched)) {
          phraseFloorsFromRoleHead.push(rule.phraseFloorWhenMatched);
        }
      }
    }
  }

  const skipGenericOverlapPenalty =
    genericOnlyOverlap && (appliedRoleHeadIds.has("penalty_sales_vs_account") || appliedRoleHeadIds.has("penalty_account_vs_product"));

  if (genericOnlyOverlap && !skipGenericOverlapPenalty) {
    total += P.genericOnlyOverlap;
    labels.push("penalty_generic_only_overlap");
  }

  if (!queryCoreMatched && pt.coreTokens.length > 0 && pq.coreTokens.length > 0) {
    let maxConflict = 0;
    for (const a of qf) {
      for (const b of tf) {
        maxConflict = Math.max(maxConflict, familyConflictStrength(a, b, famConflict));
      }
    }
    const skipFamilyConflict =
      appliedRoleHeadIds.has("penalty_sales_vs_account") || appliedRoleHeadIds.has("penalty_account_vs_product");
    if (maxConflict >= 0.75 && !skipFamilyConflict) {
      total += P.unrelatedFunctionDrift ?? DEFAULT_PENALTIES.unrelatedFunctionDrift;
      labels.push("penalty_family_conflict");
    }
  }

  if (!queryCoreMatched && pq.coreTokens.length > 0 && !genericOnlyOverlap) {
    const skipWeakLexicalBecauseRoleHead =
      appliedRoleHeadIds.has("penalty_sales_vs_account") ||
      appliedRoleHeadIds.has("penalty_account_vs_product") ||
      appliedRoleHeadIds.has("penalty_product_vs_support") ||
      appliedRoleHeadIds.has("penalty_engineering_vs_customer_facing");
    if (!skipWeakLexicalBecauseRoleHead) {
      total += P.weakPhraseOnly ?? DEFAULT_PENALTIES.weakPhraseOnly;
      labels.push("penalty_weak_lexical_match");
    }
  }

  return { total, labels, phraseFloorsFromRoleHead };
}

/**
 * Deterministic, explainable score 0..10 for how well `title` matches intended role `query`.
 * Pass the **canonical** intended role string (not vendor-decorated transport query).
 */
export function scoreTitleToQueryHealth(
  query: string,
  title: string,
  options?: VendorTitleHealthOptions,
): TitleQueryHealthResult {
  const reasons: string[] = [];
  const rawQuery = options?.canonicalQueryExtractor ? options.canonicalQueryExtractor(query) : query;
  const nq = normalizeRoleText(rawQuery, new Set(options?.extraNoiseTokens ?? []));
  const nt = normalizeRoleText(title, new Set(options?.extraNoiseTokens ?? []));

  if (nq === nt && nq.length > 0) {
    const p = parseRoleText(nq, { extraNoise: options?.extraNoiseTokens });
    /** Same surface string but no discriminative cores (e.g. "manager" vs "manager") — not a meaningful query↔title match. */
    const identicalGenericOnly =
      p.coreTokens.length === 0 &&
      p.tokens.length > 0 &&
      p.tokens.every(
        (t) =>
          p.genericTokens.includes(t) ||
          p.ignoredTokens.includes(t) ||
          p.modifiers.includes(t) ||
          p.industryHints.includes(t) ||
          p.seniorityHints.includes(t),
      );
    if (identicalGenericOnly) {
      return {
        score: 2.8,
        band: "poor",
        reasons: ["identical_normalized_but_only_generic_role_tokens"],
        debug: {
          normalizedQuery: nq,
          normalizedTitle: nt,
          queryParse: parseSnapshot(p),
          titleParse: parseSnapshot(p),
          adjacencyAllowed: false,
          scoreScaleNote: "capped_generic_only_identity_match",
          queryCoreTokens: [...p.coreTokens],
          titleCoreTokens: [...p.coreTokens],
          queryGenericTokens: [...p.genericTokens],
          titleGenericTokens: [...p.genericTokens],
          matchedTokens: [...new Set(p.tokens)],
          synonymMatchedTokens: [],
          roleFamiliesQuery: p.roleFamilies.map((h) => `${h.id}:${h.confidence.toFixed(2)}`),
          roleFamiliesTitle: p.roleFamilies.map((h) => `${h.id}:${h.confidence.toFixed(2)}`),
          penalties: [],
          componentScores: {
            phraseMatch: 0.35,
            weightedCoverage: 0.9,
            familySimilarity: 0.55,
            expansionTolerance: 0.28,
            penalties: 0,
          },
        },
      };
    }
    return {
      score: 10,
      band: "exact",
      reasons: ["exact_normalized_match"],
      debug: {
        normalizedQuery: nq,
        normalizedTitle: nt,
        queryParse: parseSnapshot(p),
        titleParse: parseSnapshot(p),
        adjacencyAllowed: true,
        scoreScaleNote: "exact_normalized_string_match",
        queryCoreTokens: [...p.coreTokens],
        titleCoreTokens: [...p.coreTokens],
        queryGenericTokens: [...p.genericTokens],
        titleGenericTokens: [...p.genericTokens],
        matchedTokens: [...new Set(p.tokens)],
        synonymMatchedTokens: [],
        roleFamiliesQuery: p.roleFamilies.map((h) => `${h.id}:${h.confidence.toFixed(2)}`),
        roleFamiliesTitle: p.roleFamilies.map((h) => `${h.id}:${h.confidence.toFixed(2)}`),
        penalties: [],
        componentScores: {
          phraseMatch: 2,
          weightedCoverage: 4,
          familySimilarity: 2,
          expansionTolerance: 1,
          penalties: 0,
        },
      },
    };
  }

  if (!nq.trim() || !nt.trim()) {
    return {
      score: 0,
      band: "unrelated",
      reasons: ["empty_query_or_title"],
      debug: {
        normalizedQuery: nq,
        normalizedTitle: nt,
        queryParse: null,
        titleParse: null,
        queryCoreTokens: [],
        titleCoreTokens: [],
        queryGenericTokens: [],
        titleGenericTokens: [],
        matchedTokens: [],
        synonymMatchedTokens: [],
        roleFamiliesQuery: [],
        roleFamiliesTitle: [],
        penalties: ["empty_query_or_title"],
        componentScores: {
          phraseMatch: 0,
          weightedCoverage: 0,
          familySimilarity: 0,
          expansionTolerance: 0,
          penalties: 0,
        },
      },
    };
  }

  const pq = parseRoleText(nq, { extraNoise: options?.extraNoiseTokens });
  const pt = parseRoleText(nt, { extraNoise: options?.extraNoiseTokens });
  const syn = mergeSynonyms(DEFAULT_SYNONYMS, options?.synonymOverrides);
  const adj = mergeAdjacency(DEFAULT_ADJACENCY, options?.adjacencyOverrides);
  const famAdj = mergeFamilyAdjacency(DEFAULT_FAMILY_ADJACENCY, options?.familyAdjacencyOverrides ?? null);
  const famConflict = mergeFamilyConflict(DEFAULT_FAMILY_CONFLICT, options?.familyConflictOverrides ?? null);
  const roleHeadRules = [...DEFAULT_ROLE_HEAD_MISMATCH_RULES, ...(options?.extraRoleHeadMismatchRules ?? [])];

  const titleTokSet = new Set(pt.tokens);
  const titleSynOnly = expandSynonymsOnly(titleTokSet, syn);
  const queryHasCore = pq.coreTokens.length > 0;
  const allowAdjacent = queryHasCore && hasCorroborationForAdjacency(pq, titleTokSet, syn);

  /** Phrase / containment (0..2) */
  let phraseMatch = 0;
  if (nt.includes(nq) && nq.length >= 4) {
    phraseMatch = 1.88;
    reasons.push("full_query_substring_in_title");
  } else {
    const qNonIgn = pq.tokens.filter((t) => !pq.ignoredTokens.includes(t));
    const sub = subsequenceScore(qNonIgn, pt.tokens);
    if (sub >= 0.99) {
      phraseMatch = 1.65;
      reasons.push("ordered_token_subsequence");
    } else if (sub >= 0.66) {
      phraseMatch = 1.15 + 0.35 * sub;
      reasons.push("partial_subsequence");
    } else {
      const qset = new Set(qNonIgn);
      let hit = 0;
      for (const t of qset) {
        if (tokenMatchKind(t, titleTokSet, titleSynOnly, syn, adj, allowAdjacent) !== "none") hit++;
      }
      const ratio = hit / Math.max(1, qset.size);
      phraseMatch = 0.35 + ratio * 0.85;
      if (ratio > 0.5) reasons.push("token_overlap_phrase");
    }
  }

  /** Weighted coverage (0..4): exact > synonym > gated adjacent */
  const queryWeightedTokens = [...pq.coreTokens, ...pq.genericTokens, ...pq.modifiers].filter(
    (t) => !pq.ignoredTokens.includes(t),
  );
  const qwTokens = [...new Set(queryWeightedTokens.length ? queryWeightedTokens : pq.tokens)];

  let sumW = 0;
  let matchedW = 0;
  let coreExactSynW = 0;
  const matchedTokens: string[] = [];
  const synonymMatchedTokens: string[] = [];

  const coreW = pq.coreTokens.reduce((s, t) => s + tokenBaseWeight(t, options?.tokenWeightOverrides), 0);

  for (const t of qwTokens) {
    const w = tokenBaseWeight(t, options?.tokenWeightOverrides);
    sumW += w;
    const kind = tokenMatchKind(t, titleTokSet, titleSynOnly, syn, adj, allowAdjacent);
    if (kind === "exact") {
      matchedW += w;
      matchedTokens.push(t);
    } else if (kind === "synonym") {
      matchedW += w * 0.88;
      synonymMatchedTokens.push(t);
    } else if (kind === "adjacent") {
      matchedW += w * 0.55;
      synonymMatchedTokens.push(`${t}~adj`);
    }
    if (pq.coreTokens.includes(t)) {
      if (kind === "exact" || kind === "synonym") {
        coreExactSynW += kind === "exact" ? w : w * 0.88;
      }
    }
  }

  const coreRatio = coreW > 0 ? coreExactSynW / coreW : queryHasCore ? 0 : 1;
  const globalRatio = sumW > 0 ? matchedW / sumW : 0;

  let weightedCoverage = 4 * globalRatio * (0.45 + 0.55 * coreRatio);

  const coreHasAnyHit = pq.coreTokens.some(
    (t) => tokenMatchKind(t, titleTokSet, titleSynOnly, syn, adj, allowAdjacent) !== "none",
  );

  const genericOnlyOverlap =
    pq.coreTokens.length > 0 &&
    !coreHasAnyHit &&
    pq.genericTokens.some((g) => tokenMatchKind(g, titleTokSet, titleSynOnly, syn, adj, false) !== "none");

  if (genericOnlyOverlap) {
    weightedCoverage = Math.min(weightedCoverage, 1.15);
    phraseMatch = Math.min(phraseMatch, 0.52);
    reasons.push("generic_overlap_without_core");
  }

  if (!queryHasCore) {
    weightedCoverage = Math.min(weightedCoverage, 1.65);
    phraseMatch = Math.min(phraseMatch, 0.48);
    reasons.push("query_has_no_discriminative_core_tokens");
  }

  weightedCoverage = Math.max(0, Math.min(4, weightedCoverage));

  const queryCoreMatched =
    pq.coreTokens.length === 0 ? globalRatio >= 0.88 : coreRatio >= 0.42 || coreHasAnyHit;

  const famMultRaw = options?.familySimilarityMultiplier;
  const famMult =
    typeof famMultRaw === "number" && Number.isFinite(famMultRaw) ? Math.max(0, Math.min(2, famMultRaw)) : 1;
  const familySimilarity = famMult * familySimilarityComponent(pq.roleFamilies, pt.roleFamilies, famAdj);

  const extra = Math.max(0, pt.tokens.length - pq.tokens.length);
  const expansionTolerance = Math.min(
    1,
    0.28 + 0.45 * Math.min(1, weightedCoverage / 4) + 0.35 * Math.min(1, extra / (extra + 6)),
  );
  if (extra > 0 && weightedCoverage >= 2.5) reasons.push("tolerated_title_expansion");

  const pen = penaltiesFor(pq, pt, queryCoreMatched, genericOnlyOverlap, options?.penaltyOverrides, famConflict, roleHeadRules);
  const penaltyTotal = Math.max(-3, Math.min(0, pen.total));
  for (const lab of pen.labels) {
    if (!reasons.includes(lab)) reasons.push(lab);
  }

  if (pen.phraseFloorsFromRoleHead.length > 0) {
    const floor = Math.max(...pen.phraseFloorsFromRoleHead);
    if (floor > phraseMatch) {
      phraseMatch = Math.min(2, floor);
      reasons.push("phrase_floored_after_role_head_mismatch");
    }
  }

  const positiveLinear = phraseMatch + weightedCoverage + familySimilarity + expansionTolerance;
  const scaledPositive = (positiveLinear / TITLE_HEALTH_POSITIVE_SUM_TARGET) * 10;
  const score = Math.max(0, Math.min(10, Math.round((scaledPositive + penaltyTotal) * 10) / 10));

  const band = bandFromScore(score);

  const scoreScaleNote = `positive_linear=${positiveLinear.toFixed(3)} → ×(10/${TITLE_HEALTH_POSITIVE_SUM_TARGET}) → +penalties(${penaltyTotal.toFixed(2)})`;

  return {
    score,
    band,
    reasons,
    debug: {
      normalizedQuery: nq,
      normalizedTitle: nt,
      queryParse: parseSnapshot(pq),
      titleParse: parseSnapshot(pt),
      adjacencyAllowed: allowAdjacent,
      scoreScaleNote,
      queryCoreTokens: [...pq.coreTokens],
      titleCoreTokens: [...pt.coreTokens],
      queryGenericTokens: [...pq.genericTokens],
      titleGenericTokens: [...pt.genericTokens],
      matchedTokens,
      synonymMatchedTokens,
      roleFamiliesQuery: pq.roleFamilies.map((h) => `${h.id}:${h.confidence.toFixed(2)}`),
      roleFamiliesTitle: pt.roleFamilies.map((h) => `${h.id}:${h.confidence.toFixed(2)}`),
      penalties: pen.labels,
      componentScores: {
        phraseMatch,
        weightedCoverage,
        familySimilarity,
        expansionTolerance,
        penalties: penaltyTotal,
      },
    },
  };
}
