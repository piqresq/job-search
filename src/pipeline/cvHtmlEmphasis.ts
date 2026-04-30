/** Restore bold/italic on cv_html when the draft model returns plain <p> text. */

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectStrongParagraphLabels(sourceHtml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of sourceHtml.matchAll(/<p><strong>([^<]*)<\/strong><\/p>/gi)) {
    const n = normalizeLabel(m[1]);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function collectEmOnlyParagraphLabels(sourceHtml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of sourceHtml.matchAll(/<p><em>([^<]*)<\/em><\/p>/gi)) {
    const n = normalizeLabel(m[1]);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Project-style blocks: <p><em>Title</em> <br /> ... */
function collectEmLeadLabels(sourceHtml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of sourceHtml.matchAll(
    /<p><em>([^<]+)<\/em>\s*<br\s*\/?>/gi,
  )) {
    const n = normalizeLabel(m[1]);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** First plain paragraph: all-caps name (mammoth often omits <strong> though Word shows bold). */
function boldLeadingNameIfPlain(html: string): string {
  return html.replace(
    /^(\s*<p>)([^<]+)(<\/p>)/i,
    (full, open, inner: string, close) => {
      const t = inner.trim();
      if (!t || t.includes("|")) return full;
      if (/[a-z]/.test(t)) return full;
      if (t.length < 3 || t.length > 80) return full;
      return `${open}<strong>${t}</strong>${close}`;
    },
  );
}

/**
 * Roles line: all caps + pipes, no lowercase (skips contact line which includes email).
 * Mammoth does not emit bold for this paragraph in the source .docx.
 */
function boldAllCapsPipeRolesLine(html: string): string {
  let idx = 0;
  return html.replace(/<p>([^<]*)<\/p>/gi, (full, inner: string) => {
    idx++;
    if (idx <= 1) return full;
    const t = inner.trim();
    if (!t.includes("|")) return full;
    if (/[a-z]/.test(t)) return full;
    if (!/^[A-Z0-9|\s,.+]+$/.test(t)) return full;
    return `<p><strong>${t}</strong></p>`;
  });
}

function wrapPlainParagraph(html: string, label: string, tag: "strong" | "em"): string {
  const n = normalizeLabel(label);
  if (!n) return html;
  const esc = escapeRegExp(n);
  return html.replace(
    new RegExp(`<p>\\s*${esc}\\s*<\/p>`, "gi"),
    `<p><${tag}>${n}</${tag}></p>`,
  );
}

function wrapEmLeadAfterPlainTitle(html: string, label: string): string {
  const n = normalizeLabel(label);
  if (!n) return html;
  const esc = escapeRegExp(n);
  return html.replace(
    new RegExp(`<p>\\s*${esc}\\s*<br\\s*\\/?>`, "gi"),
    `<p><em>${n}</em><br />`,
  );
}

/**
 * Re-apply emphasis using the extracted Word HTML as a template for which lines are bold/italic.
 * Does not fix rephrased headings or titles (no matching plain paragraph).
 */
export function reapplyCvFormatting(cvHtml: string, sourceHtml: string): string {
  let html = cvHtml;

  html = boldLeadingNameIfPlain(html);

  for (const label of collectStrongParagraphLabels(sourceHtml)) {
    html = wrapPlainParagraph(html, label, "strong");
  }
  for (const label of collectEmOnlyParagraphLabels(sourceHtml)) {
    html = wrapPlainParagraph(html, label, "em");
  }
  for (const label of collectEmLeadLabels(sourceHtml)) {
    html = wrapEmLeadAfterPlainTitle(html, label);
  }

  html = boldAllCapsPipeRolesLine(html);

  return html;
}
