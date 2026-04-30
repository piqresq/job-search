export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reviewPageHtml(opts: {
  jobTitle: string;
  company: string;
  applyUrl: string;
  fitScore: number;
  priorityLabel: string;
  positives: string[];
  negatives: string[];
  cvDraft: string;
  coverLetter: string;
  token: string;
}): string {
  const t = encodeURIComponent(opts.token);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Review — ${escapeHtml(opts.jobTitle)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    .meta { color: #444; font-size: 0.95rem; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; background: #fafafa; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.9rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
    button, a.btn { padding: 0.5rem 0.9rem; border-radius: 6px; border: 1px solid #333; background: #fff; cursor: pointer; text-decoration: none; color: #111; font-size: 0.95rem; }
    a.btn.primary { background: #111; color: #fff; }
    ul { margin: 0.25rem 0 0 1.1rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(opts.jobTitle)}</h1>
  <p class="meta">${escapeHtml(opts.company)} · Score ${opts.fitScore}${opts.priorityLabel ? ` · Priority ${escapeHtml(opts.priorityLabel)}` : ""}</p>
  ${opts.applyUrl ? `<p><a href="${escapeHtml(opts.applyUrl)}" target="_blank" rel="noopener">Open application link</a></p>` : ""}
  <div class="box">
    <strong>Positives</strong>
    <ul>${opts.positives.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
  </div>
  <div class="box">
    <strong>Negatives</strong>
    <ul>${opts.negatives.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
  </div>
  <h2>Draft CV</h2>
  <div class="box"><pre>${escapeHtml(opts.cvDraft)}</pre></div>
  <h2>Draft cover note</h2>
  <div class="box"><pre>${escapeHtml(opts.coverLetter)}</pre></div>
  <div class="actions">
    <a class="btn" href="/review/edit?t=${t}">Edit drafts</a>
    <form method="post" action="/review/action" style="display:inline">
      <input type="hidden" name="t" value="${escapeHtml(opts.token)}"/>
      <input type="hidden" name="action" value="approve"/>
      <button type="submit" class="primary">Approve</button>
    </form>
    <form method="post" action="/review/action" style="display:inline">
      <input type="hidden" name="t" value="${escapeHtml(opts.token)}"/>
      <input type="hidden" name="action" value="reject"/>
      <button type="submit">Reject</button>
    </form>
  </div>
</body>
</html>`;
}

export function editPageHtml(opts: { cvDraft: string; coverLetter: string; token: string }): string {
  const t = escapeHtml(opts.token);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Edit drafts</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
    label { display: block; font-weight: 600; margin-top: 1rem; }
    textarea { width: 100%; min-height: 180px; font-family: ui-monospace, monospace; font-size: 0.9rem; padding: 0.5rem; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #333; background: #111; color: #fff; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Edit drafts</h1>
  <form method="post" action="/review/save">
    <input type="hidden" name="t" value="${t}"/>
    <label for="cv">CV (markdown)</label>
    <textarea id="cv" name="cv">${escapeHtml(opts.cvDraft)}</textarea>
    <label for="cl">Cover letter</label>
    <textarea id="cl" name="cover">${escapeHtml(opts.coverLetter)}</textarea>
    <button type="submit">Save</button>
  </form>
  <p><a href="/review?t=${encodeURIComponent(opts.token)}">Back to review</a></p>
</body>
</html>`;
}
