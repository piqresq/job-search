import { franc } from "franc-min";

import { findSearchCountryByIso2, findSearchCountryByName } from "../../config/searchCountries";

/** Employment-type needles cover vendor copy in locales aligned with {@link DEFAULT_SEARCH_COUNTRIES} (`searchCountries.ts`). */

/** Canonical English labels stored on `NormalizedJob.employmentType` (dashboard `mapEmploymentToken` aligned). */
export type CanonicalEmploymentType = "Fulltime" | "Parttime" | "Temporary" | "Contract" | "Internship";

const LABELS = {
  fulltime: "Fulltime" as const,
  parttime: "Parttime" as const,
  temporary: "Temporary" as const,
  contract: "Contract" as const,
  intern: "Internship" as const,
};

/** NFKC + unify dashes + lowercase + single spaces for matching. */
export function normalizeEmploymentMatchKey(input: string): string {
  let s = input.normalize("NFKC").trim();
  // Sloppy copy from vendors (LinkedIn/JSearch) often includes zero-width space inside words.
  s = s.replace(/\u200b/g, "").replace(/\ufeff/g, "");
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  // Enum-style values like TIEMPO_COMPLETO or A_TIEMPO_COMPLETO must not miss phrase needles (space vs _).
  s = s.replace(/_/g, " ");
  s = s.replace(/\s+/g, " ").toLowerCase();
  return s;
}

type Bucket = keyof typeof LABELS;

/** Longest / most specific phrases first (full-time before ambiguous substrings). */
const PHRASES: ReadonlyArray<{ bucket: Bucket; needles: readonly string[] }> = [
  {
    bucket: "fulltime",
    needles: [
      // English (gb, ie, us, mt)
      "full-time",
      "full time",
      "fulltime",
      // German (de, at, ch, li)
      "vollzeit",
      "teilzeitunabhängig",
      "in vollzeit",
      // French (fr, be, lu, ch)
      "temps plein",
      "temps complet",
      "à plein temps",
      "plein temps",
      "plein-temps",
      // Dutch (nl, be)
      "voltijd",
      "vol tijd",
      // Spanish (es) — include hyphen/slug forms; ASCII `-` is not normalized to space (see normalizeEmploymentMatchKey).
      "tiempo completo",
      "a tiempo completo",
      "tiempo-completo",
      "a-tiempo-completo",
      "jornada completa",
      "jornada de tiempo completo",
      // Portuguese (pt)
      "tempo integral",
      "a tempo inteiro",
      "tempo inteiro",
      "período integral",
      "periodo integral",
      // Italian (it, ch)
      "tempo pieno",
      "a tempo pieno",
      "orario pieno",
      // Nordic: Swedish (se)
      "heltidsanställning",
      "heltidsanstallning",
      "heltid",
      // Norwegian (no)
      "heltidsstilling",
      "full stilling",
      // Danish (dk)
      "fuldtidsstilling",
      "fuld tid",
      "fuldtid",
      // Finnish (fi)
      "kokoaikatyö",
      "kokopäivätyö",
      "kokopaivatyö",
      "kokoaikainen",
      // Icelandic (is)
      "fullt starf",
      "fullur vinnumaður",
      // Polish (pl)
      "pełny etat",
      "pelny etat",
      "na pełny etat",
      "na pelny etat",
      "pełen etat",
      // Czech (cz)
      "plný úvazek",
      "plny uvazek",
      "na plný úvazek",
      // Slovak (sk)
      "plný úväzok",
      "plny uvazok",
      // Hungarian (hu)
      "teljes munkaidő",
      "teljes munkaido",
      "teljes munkaidőben",
      // Romanian (ro)
      "normă întreagă",
      "norma intreaga",
      "cu normă întreagă",
      "timp complet",
      // Greek (gr, cy)
      "πλήρης απασχόληση",
      "πλήρη απασχόληση",
      // Bulgarian (bg)
      "пълен работен ден",
      "пълен работен",
      // Croatian (hr)
      "puno radno vrijeme",
      "puno radno",
      // Slovenian (si)
      "polni delovni čas",
      "polni delovni cas",
      // Estonian (ee)
      "täisajaga",
      "täistööaeg",
      "taistooaeg",
      // Latvian (lv)
      "pilna slodze",
      "pilnas slodzes",
      // Lithuanian (lt)
      "pilnas etatas",
      "visą etatą",
      "visa etata",
    ],
  },
  {
    bucket: "parttime",
    needles: [
      // English
      "part-time",
      "part time",
      "parttime",
      "half-time",
      // German
      "teilzeit",
      "teilzeitbeschäftigung",
      "in teilzeit",
      "halbtags",
      // French
      "temps partiel",
      "à temps partiel",
      "mi-temps",
      "mi temps",
      // Dutch
      "deeltijd",
      "deeltijds",
      "half tijd",
      // Spanish
      "medio tiempo",
      "tiempo parcial",
      "jornada parcial",
      "media jornada",
      // Portuguese
      "meio período",
      "meio periodo",
      "parcial",
      "meio tempo",
      // Italian
      "part time",
      "orario ridotto",
      "mezza giornata",
      "tempo parziale",
      // Swedish
      "deltid",
      "deltidsanställning",
      // Norwegian
      "deltidsstilling",
      // Danish
      "deltid",
      "deltidsstilling",
      // Finnish
      "osa-aikainen",
      "osa-aikatyö",
      // Icelandic
      "hluta starf",
      "hlutfallslega",
      // Polish
      "niepełny etat",
      "niepelny etat",
      "część etatu",
      "czesc etatu",
      // Czech
      "zkrácený úvazek",
      "zkraceny uvazek",
      // Slovak
      "skrátený úväzok",
      "skrateny uvazok",
      // Hungarian
      "részmunkaidő",
      "reszmunkaido",
      "részmunkaidőben",
      // Romanian
      "cu fracțiune de normă",
      "cu fractiune de norma",
      "timp partial",
      "în regim part-time",
      // Greek
      "μερική απασχόληση",
      "μερικής απασχόλησης",
      // Bulgarian
      "непълен работен ден",
      "непълен",
      // Croatian
      "nepuno radno vrijeme",
      "nepuno radno",
      // Slovenian
      "krajši delovni čas",
      "kratsi delovni cas",
      "polovični delovni čas",
      // Estonian
      "osaajaga",
      "osakoormusega",
      // Latvian
      "nepilna slodze",
      // Lithuanian
      "ne pilnas etatas",
      "nevisa darbo diena",
    ],
  },
  {
    bucket: "temporary",
    needles: [
      // English
      "temporary",
      "fixed-term",
      "fixed term",
      "short-term",
      "seasonal",
      // German
      "befristet",
      "zeitbefristet",
      "auf zeit",
      "befristete",
      // French
      "cdd",
      "contrat à durée déterminée",
      "contrat a duree determinee",
      "intérim",
      "interim",
      "saisonnier",
      "temporaire",
      // Dutch
      "tijdelijk",
      "tijdelijke",
      "uitzend",
      "oproep",
      // Spanish
      "temporal",
      "contrato temporal",
      "de duración determinada",
      // Portuguese
      "temporário",
      "temporario",
      "contrato temporário",
      "por tempo determinado",
      // Italian (avoid bare "determinato" — substring of "indeterminato" permanent contracts)
      "temporaneo",
      "a tempo determinato",
      // Swedish
      "tidsbegränsad",
      "tidsbegransad",
      "visstidsanställning",
      "tillfällig",
      // Norwegian
      "midlertidig",
      "vikariat",
      "vikar",
      // Danish
      "tidsbegrænset",
      "tidsbegraenset",
      "midlertidig",
      // Finnish
      "määräaikainen",
      "maaraaikainen",
      "tilapäinen",
      "tilapainen",
      // Icelandic
      "tímabundið",
      "timabundid",
      // Polish
      "tymczasowy",
      "na czas określony",
      "na czas okreslony",
      "umowa na czas określony",
      // Czech
      "na dobu určitou",
      "na dobu urcitou",
      "dočasný",
      "docasny",
      // Slovak
      "na určitú dobu",
      "na urcitu dobu",
      // Hungarian
      "határozott idejű",
      "hatarozott ideju",
      // Romanian
      "temporar",
      "cu durată determinată",
      "durata determinata",
      // Greek
      "συμβάσεις ορισμένου χρόνου",
      "προσωρινή",
      // Bulgarian
      "временен",
      "срочен",
      // Croatian
      "određeno vrijeme",
      "privremeni",
      // Slovenian
      "za določen čas",
      "za dolocen cas",
      // Estonian
      "ajutine",
      "tähtajaline",
      "tahtajaline",
      // Latvian
      "pagaidu",
      "īslaicīgs",
      // Lithuanian
      "terminuota",
      "laikinas",
    ],
  },
  {
    bucket: "contract",
    needles: [
      "independent contractor",
      "contractor",
      "freelance",
      "freiberuflich",
      "freiberufler",
      "werkvertrag",
      "auftragsarbeit",
      "zzp",
      "self-employed",
      "subcontract",
      "consultant",
      "beratervertrag",
      "prestataire",
      "contrat de prestation",
      "contrat prestation",
      "dienstvertrag",
      "project contract",
      "contract",
    ],
  },
  {
    bucket: "intern",
    needles: [
      "internship",
      "internships",
      "praktikum",
      "werkstudent",
      "stagiaire",
      "stage en entreprise",
      "estágio",
      "estagio",
      "estagiário",
      "estagiario",
      "prácticas",
      "practicas",
      "becario",
      "tirocinio",
      "tirocinio formativo",
      "stagista",
      "traineeship",
      "trainee",
      "graduate programme",
      "graduate program",
      "summer intern",
      "summer internship",
      "praktikant",
      "praktik",
      "lærling",
      "laerling",
      "harjoittelija",
      "harjoittelu",
      "staż",
      "staz",
      "stáž",
      "stážista",
      "odborná praxe",
      "szakmai gyakorlat",
      "gyakornok",
      "stagiu",
      "internship program",
      "placement year",
    ],
  },
];

function matchesInternPhrases(key: string): boolean {
  return (
    /\b(internship|internships|praktikum|stagiaire)\b/.test(key) ||
    /\bstage\b/.test(key) ||
    /\bintern\b/.test(key)
  );
}

function bucketForPhrase(key: string): Bucket | null {
  for (const { bucket, needles } of PHRASES) {
    for (const n of needles) {
      if (key.includes(n)) return bucket;
    }
  }
  if (matchesInternPhrases(key)) return "intern";
  return null;
}

/** Legacy / API tokens (uppercase collapsed, no spaces). */
function bucketFromAsciiToken(collapsed: string): Bucket | null {
  if (collapsed.includes("FULLTIME")) return "fulltime";
  if (collapsed.includes("PARTTIME")) return "parttime";
  if (collapsed.includes("INTERN")) return "intern";
  if (collapsed.includes("CONTRACT")) return "contract";
  if (collapsed.includes("TEMPORARY") || collapsed === "TEMP") return "temporary";
  return null;
}

/**
 * Language-specific employment hints (same rules as franc fallback, but keyed by a known language code).
 * Used for country-aware disambiguation before calling franc, and by {@link bucketFromFrancFallback}.
 */
function bucketForFrancLangCode(key: string, code: string): Bucket | null {
  if (code === "deu") {
    if (/\bvoll|vollzeit\b/.test(key)) return "fulltime";
    if (/\bteil|teilzeit\b/.test(key)) return "parttime";
    if (/\bbefrist\b/.test(key)) return "temporary";
  }
  if (code === "spa" || code === "glg" || code === "cat") {
    if (key.includes("tiempo") && key.includes("completo")) return "fulltime";
    if (key.includes("parcial") || key.includes("medio tiempo")) return "parttime";
    if (key.includes("temporal") && !key.includes("completo")) return "temporary";
  }
  if (code === "por") {
    if (key.includes("integral") || key.includes("inteiro")) return "fulltime";
    if (key.includes("parcial") || key.includes("meio")) return "parttime";
    if (key.includes("tempor")) return "temporary";
  }
  if (code === "fra") {
    if (key.includes("plein") || key.includes("complet")) return "fulltime";
    if (key.includes("partiel")) return "parttime";
    if (key.includes("cdd") || key.includes("intérim") || key.includes("interim")) return "temporary";
  }
  if (code === "nld") {
    if (/\bvoltijd\b/.test(key) || key.includes("fulltime")) return "fulltime";
    if (/\bdeeltijd\b/.test(key)) return "parttime";
    if (/\btijdelijk\b/.test(key) || /\buitzend\b/.test(key)) return "temporary";
  }
  if (code === "ita") {
    if (/\btempo\s+pieno\b/.test(key) || key.includes("full time") || key.includes("full-time")) return "fulltime";
    if (/\bpart[\s-]?time\b/.test(key) || /\bpart-time\b/.test(key) || /\bmezza giornata\b/.test(key)) return "parttime";
    if (/\btemporaneo\b/.test(key)) return "temporary";
    if (/\btempo\s+determinato\b/.test(key) && !key.includes("indeterminato")) return "temporary";
  }
  return null;
}

/**
 * Primary franc language codes per job country (ISO 3166-1 alpha-2).
 * Only countries where {@link bucketForFrancLangCode} has rules (or CH/BE/LU multi-lingual) are listed;
 * others fall through to franc on the same string.
 */
const FRANC_CODES_BY_ISO2: Readonly<Record<string, readonly string[]>> = {
  de: ["deu"],
  at: ["deu"],
  li: ["deu"],
  ch: ["deu", "fra", "ita"],
  fr: ["fra"],
  be: ["nld", "fra", "deu"],
  lu: ["fra", "deu"],
  nl: ["nld"],
  es: ["spa"],
  pt: ["por"],
  it: ["ita"],
};

function resolveCountryIso2Hint(hint: string | undefined): string | undefined {
  const text = (hint ?? "").trim();
  if (!text) return undefined;
  if (/^[a-z]{2}$/i.test(text)) {
    return findSearchCountryByIso2(text)?.iso2;
  }
  return findSearchCountryByName(text)?.iso2;
}

/** If phrase/ASCII miss, try rules implied by job country before franc. */
function bucketFromCountryDisambiguation(key: string, countryIso2: string | undefined): Bucket | null {
  if (!countryIso2) return null;
  const codes = FRANC_CODES_BY_ISO2[countryIso2.toLowerCase()];
  if (!codes?.length) return null;
  for (const code of codes) {
    const b = bucketForFrancLangCode(key, code);
    if (b) return b;
  }
  return null;
}

/** If still unknown, use franc + language-tuned hints (deterministic). */
function bucketFromFrancFallback(key: string): Bucket | null {
  if (key.length < 3) return null;
  const code = franc(key, { minLength: 3 });
  return bucketForFrancLangCode(key, code);
}

function canonicalLabelForBucket(bucket: Bucket): CanonicalEmploymentType {
  return LABELS[bucket];
}

/**
 * Canonicalize a single employment-type fragment (one job type, no comma lists).
 * @param countryHint — ISO 3166-1 alpha-2 (e.g. `de`) or full country name from {@link findSearchCountryByName}; used before franc when phrase/ASCII miss. If unresolved or rules do not apply, falls back to franc.
 */
export function canonicalizeEmploymentFragment(
  raw: string,
  countryHint?: string,
): CanonicalEmploymentType | string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const key = normalizeEmploymentMatchKey(trimmed);
  if (!key) return trimmed;

  const phrase = bucketForPhrase(key);
  if (phrase) return canonicalLabelForBucket(phrase);

  const collapsed = key.toUpperCase().replace(/[\s_-]+/g, "");
  const ascii = bucketFromAsciiToken(collapsed);
  if (ascii) return canonicalLabelForBucket(ascii);

  const iso2 = resolveCountryIso2Hint(countryHint);
  const countryGuess = bucketFromCountryDisambiguation(key, iso2);
  if (countryGuess) return canonicalLabelForBucket(countryGuess);

  const francGuess = bucketFromFrancFallback(key);
  if (francGuess) return canonicalLabelForBucket(francGuess);

  return trimmed;
}

const SPLIT_RE = /[,;/|]+/;

/**
 * Normalize vendor employment strings to unified English labels.
 * Splits on comma / semicolon / slash, canonicalizes each token, dedupes, joins with ", ".
 * @param countryHint — optional job location country (ISO2 or full name); see {@link canonicalizeEmploymentFragment}.
 */
export function canonicalizeEmploymentType(raw: string | undefined, countryHint?: string): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;

  const parts = text
    .split(SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) {
    const one = canonicalizeEmploymentFragment(parts[0]!, countryHint);
    return typeof one === "string" && one ? one : undefined;
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const c = canonicalizeEmploymentFragment(p, countryHint);
    const label = typeof c === "string" ? c : String(c);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.length ? out.join(", ") : undefined;
}
