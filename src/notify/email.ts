/**
 * Outbound email helpers. The search pipeline no longer sends review mail (use GET /dashboard).
 * `POST /test-email` and `sendReviewEmail` remain for optional re-enable.
 */
import { log } from "../logging/appLog";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildReviewHtml(opts: {
  jobTitle: string;
  company: string;
  summaryLines: string[];
  reviewUrl: string;
}): string {
  return [
    `<p><strong>${escapeHtml(opts.jobTitle)}</strong> at ${escapeHtml(opts.company)}</p>`,
    "<ul>",
    ...opts.summaryLines.map((l) => `<li>${escapeHtml(l)}</li>`),
    "</ul>",
    `<p><a href="${escapeHtml(opts.reviewUrl)}">Open review</a></p>`,
  ].join("\n");
}

function buildReviewText(opts: {
  jobTitle: string;
  company: string;
  summaryLines: string[];
  reviewUrl: string;
}): string {
  const lines = [
    `${opts.jobTitle} @ ${opts.company}`,
    "",
    ...opts.summaryLines.map((l) => `- ${l}`),
    "",
    `Open review: ${opts.reviewUrl}`,
  ];
  return lines.join("\n");
}

/** Prefer Cloudflare Email Routing `send_email` binding; fall back to Resend if configured. */
export async function sendReviewEmail(
  env: Env,
  opts: {
    to: string;
    from: string;
    subject: string;
    jobTitle: string;
    company: string;
    summaryLines: string[];
    reviewUrl: string;
  },
): Promise<{ ok: boolean; error?: string; via?: "cloudflare" | "resend" }> {
  const html = buildReviewHtml(opts);
  const text = buildReviewText(opts);

  if (env.SEND_EMAIL) {
    try {
      await env.SEND_EMAIL.send({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        html,
        text,
      });
      return { ok: true, via: "cloudflare" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log.low(
        env,
        "email",
        "Cloudflare send_email failed; trying fallback",
        { error: msg.slice(0, 500) },
        {
          category: "system",
          eventType: "cloudflare_email_failed",
          phase: "sendReviewEmail",
          statusKind: "degraded",
        },
      );
      // Fall through to Resend if available
      if (!env.RESEND_API_KEY) {
        return { ok: false, error: `cloudflare_email: ${msg}` };
      }
    }
  }

  const key = env.RESEND_API_KEY;
  if (!key) {
    if (!env.SEND_EMAIL) {
      await log.low(
        env,
        "email",
        "No email transport configured; skipping send",
        { reviewUrl: opts.reviewUrl },
        {
          category: "system",
          eventType: "email_transport_missing",
          phase: "sendReviewEmail",
          statusKind: "degraded",
          fingerprint: "email_transport_missing",
        },
      );
    }
    return { ok: false, error: env.SEND_EMAIL ? "resend_fallback_missing" : "no_email_transport" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 500) };
  }
  return { ok: true, via: "resend" };
}

/** Send a one-off test message through Cloudflare Email Routing only (no Resend). */
export async function sendCloudflareEmailTest(env: Env): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
}> {
  if (!env.SEND_EMAIL) {
    return { ok: false, error: "SEND_EMAIL binding is not configured" };
  }
  const to = env.REVIEW_EMAIL_TO?.trim();
  const from = env.REVIEW_EMAIL_FROM?.trim();
  if (!to || !from) {
    return { ok: false, error: "REVIEW_EMAIL_TO and REVIEW_EMAIL_FROM must be set" };
  }
  const subject = `[job-search] Email test ${new Date().toISOString()}`;
  const text = `This is a test message from the job-search Worker via Cloudflare send_email.\nTime: ${new Date().toISOString()}`;
  const html = `<p>This is a <strong>test</strong> from the job-search Worker (Cloudflare <code>send_email</code>).</p><p>Time: ${escapeHtml(new Date().toISOString())}</p>`;
  try {
    const result = await env.SEND_EMAIL.send({
      from,
      to,
      subject,
      text,
      html,
    });
    return { ok: true, messageId: result.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { sha256hex };
