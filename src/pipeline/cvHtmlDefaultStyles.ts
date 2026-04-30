/**
 * Default CV accent ("def color") and typography for tailored HTML → DOCX / preview.
 * Dark blue: readable on white and reliable in Word when applied inline.
 */
export const CV_DEFAULT_ACCENT = "#153e75";
/** Alias for docs / prompts — same as {@link CV_DEFAULT_ACCENT}. */
export const CV_DEF_COLOR = CV_DEFAULT_ACCENT;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeText(s: string): string {
  return stripTags(s).replace(/\s+/g, " ").trim();
}

function looksLikeSectionHeader(text: string): boolean {
  const t = normalizeText(text);
  if (!t || t.includes("|")) return false;
  if (t.length > 55) return false;
  if (
    /^(SUMMARY|EXPERIENCE|SELECTED PROJECTS|CORE SKILLS|SKILLS|TOOLS|LANGUAGES|EDUCATION)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return /^[A-Z][A-Z0-9\s&.]{2,50}$/.test(t);
}

function isLikelyCompanyLine(text: string): boolean {
  const s = normalizeText(text);
  if (s.length < 2 || s.length > 70) return false;
  if (/^[•\-–]/.test(s)) return false;
  if (/\d{4}\s*-\s*(Present|\d{4})/i.test(s)) return false;
  if (s.includes("|") && /\d/.test(s)) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  const lowerStart = words.filter((w) => /^[a-z]/.test(w)).length;
  return lowerStart <= 3;
}

function looksLikeDateLine(text: string): boolean {
  const s = normalizeText(text);
  return /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*-\s*(?:Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4})\b/i.test(
    s,
  );
}

function isLikelyJobTitleLine(text: string): boolean {
  const s = normalizeText(text);
  if (!s || s.length > 90) return false;
  if (s.includes("|")) return false;
  if (/^[•\-–]/.test(s)) return false;
  if (/\d/.test(s)) return false;
  if (looksLikeSectionHeader(s) || isLikelyCompanyLine(s)) return false;
  return /[A-Za-z]/.test(s);
}

function styleNameParagraph(html: string): string {
  return html.replace(/^\s*<p>([\s\S]*?)<\/p>/i, (full, inner: string) => {
    const textOnly = normalizeText(inner);
    if (!textOnly || textOnly.includes("|") || textOnly.length > 90) return full;
    return `<p style="margin:0 0 0.2em 0"><strong><span style="font-size:11pt;color:${CV_DEFAULT_ACCENT}">${escapeHtml(
      textOnly,
    )}</span></strong></p>`;
  });
}

function styleRolesLine(html: string): string {
  return html.replace(
    /<p>(?:<strong[^>]*>)?([^<]*\|[^<]*)(?:<\/strong>)?<\/p>/gi,
    (full, inner: string) => {
      const textOnly = normalizeText(inner);
      if (!textOnly.includes("|")) return full;
      if (/[a-z]/.test(textOnly)) return full;
      return `<p><span style="font-size:10pt;color:${CV_DEFAULT_ACCENT}">${escapeHtml(
        textOnly.toUpperCase(),
      )}</span></p>`;
    },
  );
}

function styleSectionHeaders(html: string): string {
  return html.replace(
    /<p>(?:<strong[^>]*>)?([^<]+)(?:<\/strong>)?<\/p>/gi,
    (full, inner: string) => {
      if (!looksLikeSectionHeader(inner)) return full;
      const textOnly = normalizeText(inner).toUpperCase();
      return `<p><strong><span style="font-size:10pt;color:${CV_DEFAULT_ACCENT}">${escapeHtml(
        textOnly,
      )}</span></strong></p>`;
    },
  );
}

function styleCompanyBeforeEm(html: string): string {
  return html.replace(
    /<p>([^<]+)<\/p>(\s*)(<p><em(?:\s[^>]*)?>)/g,
    (full, company: string, ws: string, next: string) => {
      if (!isLikelyCompanyLine(company)) return full;
      const textOnly = normalizeText(company);
      return `<p><span style="color:${CV_DEFAULT_ACCENT}">${escapeHtml(
        textOnly,
      )}</span></p>${ws}${next}`;
    },
  );
}

function stylePlainJobTitles(html: string): string {
  return html.replace(
    /<p>([^<]+)<\/p>(\s*)(<p>[^<]+<\/p>)/gi,
    (full, title: string, ws: string, nextPara: string) => {
      const titleText = normalizeText(title);
      const nextText = normalizeText(nextPara);
      if (!looksLikeDateLine(nextText)) return full;
      if (!isLikelyJobTitleLine(titleText)) return full;
      return `<p><i>${escapeHtml(titleText)}</i></p>${ws}${nextPara}`;
    },
  );
}

function styleEmphasisParagraphs(html: string): string {
  return html
    .replace(/<p><em([^>]*)>/gi, (_full, attrs: string) => `<p><i${attrs}>`)
    .replace(/<\/em>/gi, "</i>");
}

/**
 * Apply the requested hardcoded CV theme. Assumes extracted emphasis/structure
 * has already been restored and intentionally overwrites it where specified.
 */
export function applyDefaultCvStyles(html: string): string {
  const t = html.trim();
  if (t.includes('data-cv-themed="1"')) return html;

  let h = t;
  h = styleNameParagraph(h);
  h = styleRolesLine(h);
  h = styleSectionHeaders(h);
  h = styleCompanyBeforeEm(h);
  h = stylePlainJobTitles(h);
  h = styleEmphasisParagraphs(h);

  return `<div data-cv-themed="1">${h}</div>`;
}
