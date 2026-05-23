/**
 * Multilingual phrase dictionary for job-listing expiration detection.
 *
 * Each ISO2 key maps to an array of lowercase phrases that, when found in a
 * listing page's text, indicate the job is no longer accepting applications.
 *
 * Strategy: country-hint first (use the job's stored ISO2 to pick ONE language
 * set), then always fall back to UNIVERSAL_EXPIRATION_PHRASES which work
 * regardless of language.
 *
 * Coverage: EN, DE (DE/AT/LI), ES, PT, FR, IT, NL, PL, SV, NB, DA, FI, CS,
 * RO, TR — plus a universal marker set tried on every page.
 */

export type ExpirationPhraseEntry = {
  /** BCP-47-style Accept-Language value to use when fetching pages for this country. */
  acceptLanguage: string;
  /** Lowercase phrases; any match → expired. */
  phrases: readonly string[];
};

/**
 * Phrases tried on every page regardless of language / country.
 *
 * Intentionally conservative — omit bare "404", "not found", "no longer
 * available" etc. because these appear in nav widgets, JS bundles, and auth
 * walls and cause false positives.  Every phrase here must be specific enough
 * that it could only appear on a genuinely expired/closed job page.
 */
export const UNIVERSAL_EXPIRATION_PHRASES: readonly string[] = [
  "no longer accepting",
  "not accepting applications",
  "this position is no longer",
  "job no longer available",
  "job expired",
  "expired listing",
  "position closed",
  "application closed",
  "applications closed",
  "listing not found",
  "this job is no longer",
];

/** LinkedIn-specific phrases that appear on closed listing pages. */
export const LINKEDIN_EXPIRATION_PHRASES: readonly string[] = [
  "no longer accepting applications",
  "this job is no longer available",
  "this job has been removed",
];

const EN: ExpirationPhraseEntry = {
  acceptLanguage: "en-US,en;q=0.9",
  phrases: [
    "no longer accepting applications",
    "this job is no longer available",
    "position has been filled",
    "job no longer exists",
    "job posting has been removed",
    "this position is no longer available",
    "this position has been filled",
    "position is closed",
    "position is no longer open",
    "applications are closed",
    "job has been removed",
  ],
};

const DE: ExpirationPhraseEntry = {
  acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
  phrases: [
    "nicht mehr verfügbar",
    "stelle nicht mehr verfügbar",
    "stelle besetzt",
    "seite nicht gefunden",
    "stellenanzeige abgelaufen",
    "stelle abgelaufen",
    "position ist nicht mehr aktiv",
    "stellenanzeige wurde geschlossen",
    "bewerbungen nicht mehr möglich",
    "diese stelle ist nicht mehr aktiv",
    "leider nicht mehr verfügbar",
    "anzeige abgelaufen",
  ],
};

const ES: ExpirationPhraseEntry = {
  acceptLanguage: "es-ES,es;q=0.9,en;q=0.8",
  phrases: [
    "ya no está disponible",
    "posición cerrada",
    "ya no acepta solicitudes",
    "oferta cerrada",
    "oferta expirada",
    "empleo ya no está disponible",
    "esta oferta ha caducado",
    "oferta de trabajo cerrada",
    "vacante cerrada",
    "esta posición ya no está disponible",
    "candidaturas cerradas",
  ],
};

const PT: ExpirationPhraseEntry = {
  acceptLanguage: "pt-PT,pt;q=0.9,en;q=0.8",
  phrases: [
    "vaga não encontrada",
    "não está mais disponível",
    "vaga encerrada",
    "oferta de emprego encerrada",
    "candidaturas encerradas",
    "esta vaga foi encerrada",
    "oferta expirada",
    "vaga expirada",
    "posição não disponível",
  ],
};

const FR: ExpirationPhraseEntry = {
  acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8",
  phrases: [
    "poste n'est plus disponible",
    "n'accepte plus les candidatures",
    "offre expirée",
    "ce poste n'est plus disponible",
    "annonce expirée",
    "offre d'emploi expirée",
    "cette offre n'est plus disponible",
    "poste fermé",
    "offre fermée",
    "candidatures closes",
  ],
};

const IT: ExpirationPhraseEntry = {
  acceptLanguage: "it-IT,it;q=0.9,en;q=0.8",
  phrases: [
    "non più disponibile",
    "offerta scaduta",
    "posizione non disponibile",
    "annuncio scaduto",
    "questa offerta non è più disponibile",
    "la posizione è stata chiusa",
    "candidature chiuse",
    "offerta di lavoro scaduta",
  ],
};

const NL: ExpirationPhraseEntry = {
  acceptLanguage: "nl-NL,nl;q=0.9,en;q=0.8",
  phrases: [
    "vacature niet meer beschikbaar",
    "vacature gesloten",
    "niet meer beschikbaar",
    "vacature verlopen",
    "deze vacature is niet meer beschikbaar",
    "sollicitaties gesloten",
    "functie niet beschikbaar",
  ],
};

const PL: ExpirationPhraseEntry = {
  acceptLanguage: "pl-PL,pl;q=0.9,en;q=0.8",
  phrases: [
    "oferta pracy wygasła",
    "oferta wygasła",
    "nie znaleziono",
    "ta oferta jest nieaktualna",
    "oferta jest nieaktywna",
    "rekrutacja zakończona",
    "stanowisko zostało obsadzone",
    "oferta niedostępna",
  ],
};

const SV: ExpirationPhraseEntry = {
  acceptLanguage: "sv-SE,sv;q=0.9,en;q=0.8",
  phrases: [
    "tjänsten är inte längre tillgänglig",
    "annonsen har gått ut",
    "jobbet finns inte längre",
    "annonsen är stängd",
    "tjänsten är tillsatt",
    "ansökan stängd",
  ],
};

const NB: ExpirationPhraseEntry = {
  acceptLanguage: "nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7",
  phrases: [
    "stillingen er ikke lenger tilgjengelig",
    "annonsen er utløpt",
    "jobbet er ikke lenger tilgjengelig",
    "stillingen er besatt",
    "søknadsfristen er utløpt",
    "annonsen er lukket",
  ],
};

const DA: ExpirationPhraseEntry = {
  acceptLanguage: "da-DK,da;q=0.9,en;q=0.8",
  phrases: [
    "stillingen er ikke længere tilgængelig",
    "annoncen er udløbet",
    "jobbet er ikke længere tilgængeligt",
    "stillingen er besat",
    "ansøgningsfrist udløbet",
    "annoncen er lukket",
  ],
};

const FI: ExpirationPhraseEntry = {
  acceptLanguage: "fi-FI,fi;q=0.9,en;q=0.8",
  phrases: [
    "tehtävä ei ole enää auki",
    "ilmoitus on vanhentunut",
    "sivua ei löytynyt",
    "paikka on täytetty",
    "haku on päättynyt",
    "työpaikka ei ole enää saatavilla",
  ],
};

const CS: ExpirationPhraseEntry = {
  acceptLanguage: "cs-CZ,cs;q=0.9,en;q=0.8",
  phrases: [
    "nabídka práce vypršela",
    "pozice není k dispozici",
    "nabídka vypršela",
    "tato pozice již není dostupná",
    "přijímání přihlášek bylo ukončeno",
    "pozice je obsazena",
  ],
};

const RO: ExpirationPhraseEntry = {
  acceptLanguage: "ro-RO,ro;q=0.9,en;q=0.8",
  phrases: [
    "oferta a expirat",
    "postul nu mai este disponibil",
    "oferta nu mai este disponibilă",
    "pozitia a fost inchisa",
    "anunțul a expirat",
    "aplicatiile sunt inchise",
  ],
};

const TR: ExpirationPhraseEntry = {
  acceptLanguage: "tr-TR,tr;q=0.9,en;q=0.8",
  phrases: [
    "ilan artık geçerli değil",
    "iş ilanı bulunamadı",
    "başvuru kabul edilmiyor",
    "pozisyon kapatıldı",
    "bu ilan artık aktif değil",
    "ilan süresi doldu",
  ],
};

/**
 * ISO2 → phrase entry map.
 * Countries sharing a language reuse the same entry object.
 * Fallback for unknown countries is EN.
 */
const PHRASES_BY_ISO2: Record<string, ExpirationPhraseEntry> = {
  // English
  GB: EN, US: EN, CA: EN, AU: EN, NZ: EN, IE: EN, ZA: EN, SG: EN, IN: EN,
  // German
  DE, AT: DE, LI: DE, CH: DE,
  // Spanish
  ES, MX: ES, AR: ES, CO: ES, CL: ES, PE: ES, VE: ES, EC: ES, UY: ES,
  // Portuguese
  PT, BR: PT, MZ: PT, AO: PT,
  // French
  FR, BE: FR, LU: FR, MC: FR, CH_FR: FR,
  // Italian
  IT, SM: IT, VA: IT,
  // Dutch
  NL, BE_NL: NL,
  // Polish
  PL,
  // Swedish
  SE: SV, FI_SV: SV,
  // Norwegian
  NO: NB,
  // Danish
  DK: DA,
  // Finnish
  FI,
  // Czech
  CZ: CS,
  // Romanian
  RO,
  // Turkish
  TR,
};

/**
 * Lookup phrases for a given ISO2 country code.
 * Falls back to English if the country is not in the map.
 */
export function getPhrasesForCountry(iso2: string | null | undefined): ExpirationPhraseEntry {
  if (iso2) {
    const upper = iso2.trim().toUpperCase();
    if (PHRASES_BY_ISO2[upper]) return PHRASES_BY_ISO2[upper];
  }
  return EN;
}

/**
 * Strip regions of HTML that frequently contain canned UI strings unrelated
 * to the actual listing body — most notably:
 *
 *   - <script>, <style>     — JS bundles often inline every i18n string
 *                             ("oferta expirada", "vaga expirada", etc.).
 *   - <form>                — "Report listing" / "Search" / "Save alert"
 *                             widgets carry radio-button labels like
 *                             "Vaga expirada", "Position closed", etc., on
 *                             every page regardless of listing state.
 *   - <noscript>            — Fallback messages for users without JS.
 *
 * A genuine expiration banner appears in page body text (<div>, <main>, <p>,
 * <h1>, <h2>) and is never inside one of these regions. Stripping them
 * eliminates a large class of false positives on aggregator sites
 * (trabajo.org, recruit.net, indeed-style mirrors, etc.) while keeping the
 * detector sensitive to real expiration notices.
 *
 * Uses a simple regex that covers the vast majority of real-world cases;
 * nested/malformed tags are left as-is (better a missed strip than corrupting
 * valid page text).
 */
function stripIrrelevantRegions(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "");
}

/**
 * Returns true if the HTML content contains any phrase from `phrases`.
 *
 * By default, strips script/style/form/noscript regions first so canned UI
 * strings inside those regions do not produce false-positive expiration
 * matches (important for aggregator sites whose JS bundles inline every i18n
 * string).
 *
 * Pass `skipStrip: true` for LinkedIn pages: LinkedIn embeds the closed-job
 * state ("No longer accepting applications") inside the React hydration
 * <script id="rehydrate-data"> tag — not in the visible body — so stripping
 * scripts removes the only reliable expiration signal. The
 * LINKEDIN_EXPIRATION_PHRASES are specific enough that false positives from
 * JS bundles are extremely unlikely.
 */
export function htmlContainsAnyPhrase(
  html: string,
  phrases: readonly string[],
  opts?: { skipStrip?: boolean },
): boolean {
  const text = opts?.skipStrip ? html : stripIrrelevantRegions(html);
  const lower = text.toLowerCase();
  return phrases.some((p) => lower.includes(p));
}
