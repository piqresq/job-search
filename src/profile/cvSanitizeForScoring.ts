/**
 * Strips obvious PII and replaces employer names with neutral placeholders before the CV
 * is sent to OpenAI for **scoring** only (draft generation still uses the raw extract).
 */

const PLACEHOLDER_EMPLOYERS = [
  "Northbridge Software Group",
  "Aurora Digital Services",
  "Cedarline Systems",
  "Silvermap Technologies",
  "Bluefield Solutions",
  "Ridgeway Analytics",
  "Harborlight Labs",
  "Keystone Product Group",
] as const;

const SECTION_HEADER =
  /^(SUMMARY|PROFILE|OBJECTIVE|EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT|EDUCATION|ACADEMIC|PROJECTS|SELECTED PROJECTS|SKILLS|CORE SKILLS|TOOLS|TECHNOLOGIES|LANGUAGES|CERTIFICATIONS|CERTIFICATES|AWARDS|PUBLICATIONS|VOLUNTEER|REFERENCES)\b/i;

function placeholderEmployer(index: number): string {
  return PLACEHOLDER_EMPLOYERS[index % PLACEHOLDER_EMPLOYERS.length]!;
}

function isRoleOrHeadlineLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.includes("|") && t === t.toUpperCase() && t.length > 20) return true;
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(t)) return true;
  if (/^[-•*▪◦]\s/.test(t)) return true;
  if (/\b(?:Present|Current)\b/i.test(t) && /\d{4}/.test(t)) return true;
  return false;
}

function isProbableJobTitleLine(line: string): boolean {
  const t = line.trim();
  if (t.length > 140) return false;
  return (
    /(Manager|Director|Specialist|Representative|Lead|Engineer|Analyst|Consultant|Developer|Officer|Coordinator|Head|Associate|VP|President|Owner|Founder|Intern|Assistant|Administrator|Architect|Designer|Scientist)\b/i.test(
      t,
    ) || (t.includes("/") && !t.includes("|"))
  );
}

/** Lines that look like ALL-CAPS personal name header (single line). */
function nameVariantsFromCapsHeaderLine(raw: string): string[] {
  const line = raw.split(/\r?\n/)[0]?.trim() ?? "";
  if (!line || line.length > 70) return [];
  if (!/^[A-Z][A-Z\s.'-]+$/.test(line)) return [];
  const parts = line.split(/\s+/).filter((p) => p.replace(/[^A-Za-z]/g, "").length > 1);
  if (parts.length < 1 || parts.length > 5) return [];
  const variants = new Set<string>();
  for (const p of parts) {
    const clean = p.replace(/[^A-Za-z.'-]/g, "");
    if (clean.length < 2) continue;
    variants.add(clean);
    variants.add(clean.toLowerCase());
    variants.add(clean.charAt(0) + clean.slice(1).toLowerCase());
  }
  const fullTitle = parts
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase().replace(/[^a-z.'-]/gi, ""))
    .join(" ");
  if (fullTitle.length > 2) variants.add(fullTitle);
  return [...variants].sort((a, b) => b.length - a.length);
}

function nextNonEmptyLine(lines: readonly string[], start: number): string | undefined {
  for (let j = start; j < lines.length; j++) {
    const t = lines[j]?.trim() ?? "";
    if (t) return t;
  }
  return undefined;
}

function collectEmployerLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const found = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]?.trim() ?? "";
    if (!a) continue;
    const b = nextNonEmptyLine(lines, i + 1);
    if (!b) continue;
    if (SECTION_HEADER.test(a)) continue;
    if (isRoleOrHeadlineLine(a)) continue;
    if (a.includes("@")) continue;
    if (a.length < 2 || a.length > 72) continue;
    if (a.startsWith("-") || a.startsWith("•")) continue;
    if (!isProbableJobTitleLine(b)) continue;
    if (/^https?:\/\//i.test(a)) continue;
    found.add(a);
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/**
 * Redact emails, phones, LinkedIn handles, rough street addresses, location tokens,
 * education institution names, and replace detected employer headers with placeholders.
 */
export function sanitizeCvTextForAiScoring(cvText: string): string {
  let s = cvText;

  const nameVars = nameVariantsFromCapsHeaderLine(s);
  for (const nv of nameVars) {
    if (nv.length < 2) continue;
    const re = new RegExp(`\\b${nv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    s = s.replace(re, "Candidate");
  }
  s = s.replace(/^[A-Z][A-Z\s.'-]{2,70}\s*$/gm, (line) => {
    const t = line.trim();
    if (SECTION_HEADER.test(t)) return line;
    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 5) return line;
    return "Candidate";
  });

  s = s.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gi, "[email]");
  s = s.replace(/\bhttps?:\/\/(?:www\.)?linkedin\.com\/in\/[\w-]+\b/gi, "[linkedin-profile]");
  s = s.replace(/\blinkedin\.com\/in\/[\w-]+\b/gi, "[linkedin-profile]");

  s = s.replace(/\+?\d[\d\s().-]{7,18}\d\b/g, "[phone]");

  s = s.replace(
    /\b\d{1,5}\s+[A-Za-z0-9.,'#\s-]{1,48}(?:street|st\.?|avenue|ave|road|rd\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd|way|court|ct\.?|plaza|sq)\b[^.\n]*/gi,
    "[address]",
  );

  s = s.replace(/\b(?:Riga|Vilnius|Tallinn|Kaunas|Daugavpils),\s*(?:Latvia|Lithuania|Estonia)\b/gi, "[region]");
  s = s.replace(/\b(?:Latvia|Lithuania|Estonia)\b/g, "[country]");

  s = s.replace(
    /\b(?:University|College|Institute|School|Academy|Polytechnic)\s+[^|\n]{2,80}\b/gi,
    "[education institution]",
  );
  s = s.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4}\s+(?:University|College|Institute)\b/g, "[education institution]");

  const employers = collectEmployerLines(s);
  employers.forEach((company, idx) => {
    const esc = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ph = placeholderEmployer(idx);
    const reInline = new RegExp(`\\b${esc}\\b`, "g");
    s = s.replace(reInline, ph);
  });

  return s.replace(/\n{4,}/g, "\n\n\n").trimEnd();
}
