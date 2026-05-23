/**
 * LinkedIn login — runs via Browserbase (real Chromium with proper TLS
 * fingerprint + Stealth Mode + residential proxy).
 *
 * Previously this file implemented a plain HTTP login flow via an ISP proxy
 * (CONNECT + startTls), but Workers' BoringSSL ClientHello fingerprint is
 * rejected by LinkedIn's Cloudflare CDN regardless of the proxy used — every
 * such attempt fails with `step=response_read TLS Handshake Failed.` That
 * code path is preserved (commented in this module's history) but the public
 * `performLogin` now delegates to Browserbase, which runs the browser
 * server-side and returns once the `li_at` cookie has been extracted.
 *
 * `LoginOutcome` shape is unchanged so callers (`linkedinSessionService`)
 * keep working without modification.
 */

import { retryWithBackoff } from "./retryWithBackoff";
import { performBrowserbaseLogin } from "./browserbaseLogin";

export type LoginOutcome =
  | { kind: "ok"; cookies: Record<string, string>; liAtExpiresAt: number }
  | { kind: "challenged"; checkpointType: string; finalUrl: string; bodyPreview: string; cookieKeys: string[] }
  | { kind: "bad_credentials"; finalUrl: string; errorText: string }
  | { kind: "transient"; reason: string; attempts: number }
  | { kind: "unknown_state"; finalUrl: string; bodyPreview: string; title: string };

/**
 * Perform a full LinkedIn login via Browserbase and return a normalised
 * `LoginOutcome`. Transient browser-session errors are retried with the
 * standard backoff; fatal outcomes (challenged / bad_credentials /
 * unknown_state) are returned immediately without retry.
 */
export async function performLogin(env: Env): Promise<LoginOutcome> {
  const email = env.LINKEDIN_EMAIL;
  const password = env.LINKEDIN_PASSWORD;
  if (!email || !password) {
    return {
      kind: "unknown_state",
      finalUrl: "",
      bodyPreview: "",
      title: "LINKEDIN_EMAIL or LINKEDIN_PASSWORD not set",
    };
  }
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) {
    return {
      kind: "unknown_state",
      finalUrl: "",
      bodyPreview: "",
      title: "BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID not set",
    };
  }

  let attempts = 0;
  let lastTransientReason = "";

  // Default to 1 attempt so the user sees the underlying Browserbase error
  // immediately. Override via LINKEDIN_LOGIN_MAX_ATTEMPTS to retry transient
  // session / WS connection issues.
  const loginMaxAttempts = ((): number => {
    if (env.LINKEDIN_LOGIN_NO_RETRY === "true") return 1;
    const raw = String(env.LINKEDIN_LOGIN_MAX_ATTEMPTS ?? "").trim();
    if (!raw) return 1;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 5);
  })();

  try {
    return await retryWithBackoff(
      async () => {
        attempts++;
        const outcome = await performBrowserbaseLogin(env);

        if (outcome.kind === "challenged" || outcome.kind === "bad_credentials" || outcome.kind === "unknown_state") {
          // Fatal outcomes — don't retry, propagate immediately.
          const err = Object.assign(new Error(`login_${outcome.kind}`), { outcome, fatal: true });
          throw err;
        }

        if (outcome.kind === "transient") {
          lastTransientReason = outcome.reason;
          const err = Object.assign(new Error(`login_transient: ${outcome.reason}`), { retryable: true });
          throw err;
        }

        return { kind: "ok", cookies: outcome.cookies, liAtExpiresAt: outcome.liAtExpiresAt };
      },
      {
        name: "linkedin_login",
        classify: (err) => {
          if (err && typeof err === "object" && "fatal" in err) return "fatal";
          lastTransientReason = err instanceof Error ? err.message : String(err);
          return "retryable";
        },
        // A Browserbase session create + connect + page load + login can take
        // 30–60s on first attempt. Budget 90s per attempt.
        timeoutMs: 90_000,
        maxAttempts: loginMaxAttempts,
        onAttempt: (_attempt, err) => {
          lastTransientReason = err instanceof Error ? err.message : String(err);
        },
      },
    );
  } catch (err) {
    if (err && typeof err === "object" && "outcome" in err) {
      return (err as { outcome: LoginOutcome }).outcome;
    }
    return { kind: "transient", reason: lastTransientReason || String(err), attempts };
  }
}
