/**
 * Structured summary — must stay consistent with the CV text below.
 * Location / authorization themes align with instructions.txt; employers and dates come only from the CV text passed in.
 */
export const BASELINE_PROFILE = {
  location: "Riga, Latvia",
  workAuthorization: "EU citizen",
  education: "No university degree",
  targetRoles: [
    "Technical Customer Success Manager",
    "Technical Account Manager",
    "Senior Customer Success Manager",
    "Solutions Consultant",
    "Product Operations Manager",
    "Implementation Consultant / Implementation Manager",
  ],
  backgroundThemes: [
    "telecom SaaS",
    "customer success",
    "key account management",
    "product improvement",
    "workflow automation",
    "Python",
    "Cloudflare Workers",
    "Zendesk",
    "technical troubleshooting",
    "API / integration-heavy work",
  ],
} as const;

/** @param cvText — from {@link getCvSourceText} (D1 cache or bundled extract). */
export function profileContextForPromptFromCv(cvText: string): string {
  return [
    "--- Full CV (source of truth — match employers, dates, metrics, tools, and education exactly; do not invent) ---",
    cvText,
    "--- Structured summary (must not contradict the CV) ---",
    `Location: ${BASELINE_PROFILE.location}`,
    `Work authorization: ${BASELINE_PROFILE.workAuthorization}`,
    `Education note: ${BASELINE_PROFILE.education}`,
    `Target roles: ${BASELINE_PROFILE.targetRoles.join("; ")}`,
    `Background themes: ${BASELINE_PROFILE.backgroundThemes.join("; ")}`,
    "",
    "When tailoring a CV or letter, only rephrase, reorder, and emphasize content supported by the CV above.",
  ].join("\n");
}
