/**
 * Humanlike public-HTML fetcher for job-listing expiration checks.
 *
 * - Rotates User-Agent from a pool of modern desktop browser strings.
 * - Sets realistic browser headers (Accept, Accept-Language, Referer, Sec-Fetch-*).
 * - Hard 15 s timeout + 500 KB body cap.
 * - Classifies the result without any retries — callers decide retry policy.
 */

const FETCH_TIMEOUT_MS = 15_000;
const BODY_CAP_BYTES = 500 * 1024; // 500 KB

const USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

export type PublicFetchResult =
  | { kind: "ok"; status: number; html: string; finalUrl: string; durationMs: number }
  | { kind: "expired"; status: number; reason: string; finalUrl: string }
  | { kind: "blocked"; status: number; reason: "challenge" | "rate_limit" | "forbidden"; bodyPreview: string; retryAfterSec?: number }
  | { kind: "transient"; error: string }
  | { kind: "not_found"; status: number; finalUrl: string }
  | { kind: "auth_expired"; redirectUrl: string };

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function parseChallengeBody(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("cf-mitigated") ||
    lower.includes("are you a human") ||
    lower.includes("are you a robot") ||
    lower.includes("enable javascript") ||
    lower.includes("ddos-guard") ||
    lower.includes("checking if the site connection is secure") ||
    // Cloudflare Ray ID appears in challenge pages
    (lower.includes("cloudflare") && lower.includes("ray id"))
  );
}

function parseRetryAfterSec(headers: Headers): number | undefined {
  const h = headers.get("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n > 0) return n;
  const d = new Date(h);
  if (!Number.isNaN(d.getTime())) {
    const diff = Math.ceil((d.getTime() - Date.now()) / 1000);
    return diff > 0 ? diff : undefined;
  }
  return undefined;
}

async function readBodyCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    totalBytes += value.byteLength;
    if (totalBytes > BODY_CAP_BYTES) {
      // Only keep up to cap
      const remaining = BODY_CAP_BYTES - (totalBytes - value.byteLength);
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(chunks.reduce((a, b) => a + b.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(combined);
}

/**
 * Normalise a LinkedIn job URL to the www.linkedin.com subdomain.
 *
 * LinkedIn serves locale-specific text in the `rehydrate-data` script tag
 * based on the subdomain (es.linkedin.com → Spanish, nl.linkedin.com → Dutch,
 * etc.). Since LINKEDIN_EXPIRATION_PHRASES only contains English strings, we
 * must fetch from www.linkedin.com so the rehydration JSON uses English copy
 * (where "No longer accepting applications" appears literally).
 *
 * Only rewrites /jobs/view/ URLs on *.linkedin.com — all other URLs pass through.
 */
export function normalizeLinkedinJobUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("linkedin.com") && u.pathname.includes("/jobs/view/")) {
      u.hostname = "www.linkedin.com";
      return u.toString();
    }
  } catch {
    // ignore unparseable URLs
  }
  return url;
}

const AUTH_REDIRECT_PATHS = ["/login", "/authwall", "/checkpoint"];

function isLinkedinAuthRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return AUTH_REDIRECT_PATHS.some((p) => parsed.pathname.startsWith(p));
  } catch {
    return false;
  }
}

/**
 * Fetch a public job-listing URL and return a classified result.
 *
 * @param url            The page URL to fetch.
 * @param acceptLanguage BCP-47 Accept-Language header value (e.g. "de-DE,de;q=0.9,en;q=0.8").
 * @param cookieHeader   Optional `Cookie:` header value (e.g. from stored LinkedIn session).
 *                       When provided, `redirect: "manual"` is used so LinkedIn auth redirects
 *                       are detectable and returned as `auth_expired` instead of being followed.
 */
export async function fetchPublicListingHtml(
  url: string,
  acceptLanguage = "en-US,en;q=0.9",
  cookieHeader?: string,
): Promise<PublicFetchResult> {
  const withCookies = Boolean(cookieHeader);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("expiration_fetch_timeout"), FETCH_TIMEOUT_MS);

  const extraHeaders: Record<string, string> = {};
  if (cookieHeader) extraHeaders["Cookie"] = cookieHeader;

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": pickUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": acceptLanguage,
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://www.google.com/",
        "Cache-Control": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        ...extraHeaders,
      },
      // With cookies we use manual redirect so a 3xx to /login is detectable.
      redirect: withCookies ? "manual" : "follow",
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "transient", error: `fetch error: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - t0;
  const status = response.status;

  // When cookies were sent, a redirect to a login/authwall means the session expired.
  if (withCookies && status >= 300 && status < 400) {
    const location = response.headers.get("location") ?? "";
    // Resolve relative redirects against the original URL
    let redirectUrl = location;
    try {
      redirectUrl = new URL(location, url).toString();
    } catch { /* keep raw location */ }
    if (isLinkedinAuthRedirect(redirectUrl) || isLinkedinAuthRedirect(location)) {
      return { kind: "auth_expired", redirectUrl };
    }
    // Non-auth redirect while in manual mode — treat as transient so caller retries or follows.
    return { kind: "transient", error: `unexpected redirect ${status} to ${redirectUrl}` };
  }

  const finalUrl = response.url || url;

  if (status === 404 || status === 410) {
    return { kind: "not_found", status, finalUrl };
  }

  if (status === 429) {
    const retryAfterSec = parseRetryAfterSec(response.headers);
    return {
      kind: "blocked",
      status,
      reason: "rate_limit",
      bodyPreview: "",
      retryAfterSec,
    };
  }

  if (status === 403) {
    let preview = "";
    try {
      const text = await readBodyCapped(response);
      preview = text.slice(0, 300);
      if (parseChallengeBody(text)) {
        return { kind: "blocked", status, reason: "challenge", bodyPreview: preview };
      }
    } catch {
      // ignore body read errors for 403
    }
    return { kind: "blocked", status, reason: "forbidden", bodyPreview: preview };
  }

  if (status >= 500) {
    return { kind: "transient", error: `server error: HTTP ${status}` };
  }

  if (status < 200 || (status >= 300 && status < 400)) {
    return { kind: "transient", error: `unexpected status: ${status}` };
  }

  // 200-range — read body
  let html: string;
  try {
    html = await readBodyCapped(response);
  } catch (err) {
    return { kind: "transient", error: `body read error: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Check for challenge body on 200 (Cloudflare bot-management sometimes returns 200 + challenge)
  if (parseChallengeBody(html)) {
    return {
      kind: "blocked",
      status,
      reason: "challenge",
      bodyPreview: html.slice(0, 300),
    };
  }

  return { kind: "ok", status, html, finalUrl, durationMs };
}
