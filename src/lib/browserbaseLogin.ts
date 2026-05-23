/**
 * Browserbase login for LinkedIn — hosted Chromium with proper TLS fingerprint
 * and built-in stealth mode that bypasses LinkedIn's bot detection.
 *
 * Why this exists
 * ────────────────
 * Cloudflare Workers' raw TCP socket + `startTls()` produces a TLS ClientHello
 * with a JA3 fingerprint that LinkedIn's CDN (Cloudflare) rejects with
 * "TLS Handshake Failed" — regardless of the proxy used. The TLS handshake
 * is between Workers and LinkedIn; the proxy just blindly forwards bytes.
 *
 * Browserbase runs a real Chromium server-side with a normal browser TLS
 * fingerprint, optional residential proxies, and an explicit Stealth Mode.
 * Workers connects to Browserbase via CDP over WebSocket, drives the browser
 * with puppeteer-core, performs the login flow, and extracts the `li_at`
 * cookie. The session is then closed.
 *
 * Required env / secrets:
 *   BROWSERBASE_API_KEY      — account API key (X-BB-API-Key)
 *   BROWSERBASE_PROJECT_ID   — project id (UUID) to bill the session to
 *   LINKEDIN_EMAIL           — already used by previous login attempts
 *   LINKEDIN_PASSWORD        — already used by previous login attempts
 *   LINKEDIN_AUTH_COUNTRY    — optional ISO2; pins residential proxy region
 *                              and helps avoid the geo-redirect issue
 *                              (e.g. `pl` keeps `/login` on `www.`)
 */

import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer-core";
import { log } from "../logging/appLog";

// ─── CDP helpers ──────────────────────────────────────────────────────────────
//
// puppeteer-core's high-level page methods (`waitForSelector`, `type`,
// `click`, `evaluate(fn)`, `title`) cannot run in Cloudflare Workers because
// they internally use `new Function()` / `eval()` to serialize JS into the
// page context — Workers forbids dynamic code evaluation and throws
// "Passed function cannot be serialized!". The CDP `Runtime.evaluate` method
// accepts a string expression directly, which works fine. Every interaction
// with the page below goes through this helper instead of the puppeteer
// page API.

/** Evaluate a JS expression string in the page; returns the resolved value. */
async function evalString<T = unknown>(cdp: CDPSession, expression: string): Promise<T> {
  const res = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result: { value: T } };
  return res.result.value;
}

/** Poll a boolean JS expression until it returns true or timeout. */
async function waitForCondition(
  cdp: CDPSession,
  expression: string,
  timeoutMs: number,
  pollMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await evalString<boolean>(cdp, expression).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

const SCOPE = "linkedin_auth";

const BROWSERBASE_API_BASE = "https://api.browserbase.com/v1";

type SessionCreateResponse = {
  id: string;
  connectUrl: string;
  status?: string;
};

export type BrowserbaseLoginOutcome =
  | { kind: "ok"; cookies: Record<string, string>; liAtExpiresAt: number }
  | { kind: "challenged"; checkpointType: string; finalUrl: string; bodyPreview: string; cookieKeys: string[] }
  | { kind: "bad_credentials"; finalUrl: string; errorText: string }
  | { kind: "transient"; reason: string }
  | { kind: "unknown_state"; finalUrl: string; bodyPreview: string; title: string };

// ─── Session lifecycle ────────────────────────────────────────────────────────

async function createSession(env: Env): Promise<SessionCreateResponse> {
  const apiKey = env.BROWSERBASE_API_KEY;
  const projectId = env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY not set");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID not set");

  // Build session config opt-in. Proxies and stealth advanced are paid-tier
  // features on Browserbase. Free tier gets a vanilla Chromium with a US
  // datacenter exit IP — that'll work for testing the plumbing, but LinkedIn
  // will likely send a checkpoint email since the account is normally used
  // from Poland.
  const useProxies = String(env.BROWSERBASE_USE_PROXIES ?? "").toLowerCase() === "true";
  const stealthMode = (env.BROWSERBASE_STEALTH ?? "").trim(); // "", "basic", "advanced"

  const body: Record<string, unknown> = { projectId };

  if (useProxies) {
    const country = (env.LINKEDIN_AUTH_COUNTRY ?? "pl").toUpperCase();
    body.proxies = [{ type: "browserbase", geolocation: { country } }];
  }

  if (stealthMode) {
    body.browserSettings = { stealth: { mode: stealthMode } };
  }

  const resp = await fetch(`${BROWSERBASE_API_BASE}/sessions`, {
    method: "POST",
    headers: {
      "X-BB-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Browserbase create session failed: HTTP ${resp.status} ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as SessionCreateResponse;
  if (!data.connectUrl) {
    throw new Error(`Browserbase create session returned no connectUrl: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function closeSession(env: Env, sessionId: string): Promise<void> {
  const apiKey = env.BROWSERBASE_API_KEY;
  if (!apiKey) return;
  await fetch(`${BROWSERBASE_API_BASE}/sessions/${sessionId}`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "REQUEST_RELEASE" }),
  }).catch(() => { /* best-effort */ });
}

// ─── WebSocket transport for puppeteer-core (Workers-compatible) ─────────────

/**
 * Open a WebSocket to `wsUrl` (which may include query-string credentials)
 * via Cloudflare's fetch() upgrade path, then wrap in a puppeteer-core
 * ConnectionTransport. This is the only WS pattern that works in Workers
 * because the global `WebSocket` constructor strips embedded credentials.
 */
async function openTransport(
  wsUrl: string,
  connectTimeoutMs = 20_000,
): Promise<{
  onmessage: ((msg: string) => void) | undefined;
  onclose: (() => void) | undefined;
  send(data: string): void;
  close(): void;
}> {
  const fetchUrl = wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");

  let response: Response;
  try {
    response = await Promise.race([
      fetch(fetchUrl, { headers: { Upgrade: "websocket", Connection: "Upgrade" } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Browserbase WS connect timed out after ${connectTimeoutMs}ms`)), connectTimeoutMs),
      ),
    ]);
  } catch (err) {
    throw new Error(`Browserbase WS fetch failed: ${String(err)}`);
  }

  if (response.status !== 101) {
    const body = await response.text().catch(() => "");
    throw new Error(`Browserbase WS upgrade rejected: HTTP ${response.status} — ${body.slice(0, 300)}`);
  }

  const nativeWs = response.webSocket;
  if (!nativeWs) throw new Error("Browserbase WS: upgrade succeeded but response.webSocket is null");
  nativeWs.accept();

  const transport = {
    onmessage: undefined as ((msg: string) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    send(data: string) { nativeWs.send(data); },
    close() { nativeWs.close(); },
  };

  nativeWs.addEventListener("message", (ev: MessageEvent) => {
    transport.onmessage?.(ev.data as string);
  });
  nativeWs.addEventListener("close", () => {
    transport.onclose?.();
  });

  return transport;
}

async function connectBrowser(connectUrl: string): Promise<Browser> {
  const transport = await openTransport(connectUrl);
  return puppeteer.connect({ transport, defaultViewport: null });
}

// ─── LinkedIn login flow ──────────────────────────────────────────────────────

function classifyPostLogin(
  url: string,
  bodyText: string,
): "ok" | "challenge" | "bad_credentials" | "unknown" {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("/checkpoint/")) return "challenge";
  if (lowerUrl.includes("/feed") || lowerUrl.includes("/in/") || lowerUrl.includes("/jobs")) return "ok";
  if (lowerUrl.includes("/login") || lowerUrl.includes("/uas/login")) {
    const lower = bodyText.toLowerCase();
    if (
      lower.includes("wrong email") ||
      lower.includes("wrong password") ||
      lower.includes("incorrect email") ||
      lower.includes("incorrect password") ||
      lower.includes("couldn't find") ||
      lower.includes("please check your password")
    ) return "bad_credentials";
    return "unknown";
  }
  return "unknown";
}

type CookieRow = { name: string; value: string; expires?: number };

async function getLinkedinCookies(cdp: CDPSession): Promise<{
  cookies: Record<string, string>;
  liAtExpiresAt: number;
}> {
  const res = (await cdp.send("Network.getCookies", {
    urls: ["https://www.linkedin.com"],
  })) as { cookies: CookieRow[] };
  const map: Record<string, string> = {};
  let liAtExpires = 0;
  for (const c of res.cookies) {
    map[c.name] = c.value;
    if (c.name === "li_at" && c.expires && c.expires > 0) {
      liAtExpires = Math.floor(c.expires);
    }
  }
  const liAtExpiresAt = liAtExpires > 0 ? liAtExpires : Math.floor(Date.now() / 1000) + 30 * 86400;
  return { cookies: map, liAtExpiresAt };
}

/**
 * Drive the LinkedIn login flow using CDP `Runtime.evaluate` exclusively.
 * No `waitForSelector` / `type` / `click` / `evaluate(fn)` — those use
 * dynamic code evaluation which Cloudflare Workers blocks.
 */
async function doLogin(
  page: Page,
  email: string,
  password: string,
): Promise<BrowserbaseLoginOutcome> {
  page.setDefaultNavigationTimeout(30_000);
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  const cdp = await page.createCDPSession();

  try {
    // 1. Navigate to login.
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

    // 2. Wait until the email field is in the DOM (LinkedIn renders some
    //    pages client-side after a redirect).
    const formAppeared = await waitForCondition(
      cdp,
      `!!document.querySelector('input[name="session_key"]') && !!document.querySelector('input[name="session_password"]')`,
      15_000,
    );
    if (!formAppeared) {
      const url = page.url();
      const bodyPreview = await evalString<string>(cdp, `(document.body && document.body.innerText) || ''`).catch(() => "");
      const title = await evalString<string>(cdp, `document.title`).catch(() => "");
      return {
        kind: "unknown_state",
        finalUrl: url,
        bodyPreview: String(bodyPreview).slice(0, 500),
        title: `login form never appeared: ${title}`,
      };
    }

    // 3. Fill the form using the native HTMLInputElement value setter so
    //    React/listeners pick up the change. Embed credentials via JSON to
    //    safely escape special characters.
    const fillScript = `(function () {
      var u = document.querySelector('input[name="session_key"]');
      var p = document.querySelector('input[name="session_password"]');
      if (!u || !p) return false;
      var setVal = function (el, val) {
        var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (d && d.set) d.set.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      u.focus(); setVal(u, ${JSON.stringify(email)});
      p.focus(); setVal(p, ${JSON.stringify(password)});
      return u.value.length > 0 && p.value.length > 0;
    })()`;
    const filled = await evalString<boolean>(cdp, fillScript);
    if (!filled) {
      return {
        kind: "unknown_state",
        finalUrl: page.url(),
        bodyPreview: "",
        title: "failed to fill login form",
      };
    }

    // 4. Submit. Try clicking the visible button; fall back to form.submit().
    //    Race against navigation so we know when the page transitions.
    const submitScript = `(function () {
      var btn = document.querySelector('button[type="submit"]') || document.querySelector('button.login__form_action_container, button[data-litms-control-urn*="login-submit"]');
      if (btn) { btn.click(); return 'click'; }
      var form = document.querySelector('form.login__form, form[action*="login-submit"]') || document.forms[0];
      if (form) { form.submit(); return 'submit'; }
      return 'none';
    })()`;

    const navPromise = page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => null);
    const submitOutcome = await evalString<string>(cdp, submitScript);
    if (submitOutcome === "none") {
      return {
        kind: "unknown_state",
        finalUrl: page.url(),
        bodyPreview: "",
        title: "no submit button found",
      };
    }
    await navPromise;

    // 5. Brief settle — LinkedIn sometimes does a JS-driven secondary
    //    redirect after the first navigation completes.
    await new Promise((r) => setTimeout(r, 1500));

    const finalUrl = page.url();
    const bodyText = (await evalString<string>(cdp, `(document.body && document.body.innerText) || ''`).catch(() => "")).slice(0, 1500);
    const title = await evalString<string>(cdp, `document.title`).catch(() => "");

    const outcome = classifyPostLogin(finalUrl, bodyText);

    if (outcome === "ok") {
      const { cookies, liAtExpiresAt } = await getLinkedinCookies(cdp);
      if (!cookies["li_at"]) {
        return { kind: "unknown_state", finalUrl, bodyPreview: bodyText.slice(0, 500), title };
      }
      return { kind: "ok", cookies, liAtExpiresAt };
    }

    if (outcome === "challenge") {
      const { cookies } = await getLinkedinCookies(cdp);
      const cookieKeys = Object.keys(cookies);
      let checkpointType = "verify";
      try {
        const u = new URL(finalUrl);
        checkpointType = u.searchParams.get("challengeType") ?? u.searchParams.get("appName") ?? "verify";
      } catch { /* ignore */ }
      return { kind: "challenged", checkpointType, finalUrl, bodyPreview: bodyText.slice(0, 500), cookieKeys };
    }

    if (outcome === "bad_credentials") {
      return { kind: "bad_credentials", finalUrl, errorText: bodyText.slice(0, 300) || "Incorrect email or password" };
    }

    return { kind: "unknown_state", finalUrl, bodyPreview: bodyText.slice(0, 500), title };
  } finally {
    await cdp.detach().catch(() => { /* ignore */ });
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Perform a full LinkedIn login via Browserbase and return the resulting
 * session cookies. Each call creates a fresh Browserbase session and closes
 * it before returning. Caller is responsible for retry policy.
 */
export async function performBrowserbaseLogin(env: Env): Promise<BrowserbaseLoginOutcome> {
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

  let sessionId: string | null = null;
  let browser: Browser | null = null;
  const t0 = Date.now();

  try {
    // 1. Create session
    const session = await createSession(env);
    sessionId = session.id;
    await log.info(env, SCOPE, `browserbase session created`, { sessionId, durationMs: Date.now() - t0 });

    // 2. Connect via CDP/WSS
    const tConnect = Date.now();
    browser = await connectBrowser(session.connectUrl);
    await log.info(env, SCOPE, `browserbase puppeteer connected`, { sessionId, durationMs: Date.now() - tConnect });

    // 3. Run login on the default page
    const pages = await browser.pages();
    const page = pages[0] ?? await browser.newPage();

    const tLogin = Date.now();
    const outcome = await doLogin(page, email, password);
    await log.info(
      env,
      SCOPE,
      `browserbase login outcome: ${outcome.kind}`,
      { sessionId, durationMs: Date.now() - tLogin, totalMs: Date.now() - t0 },
    );
    return outcome;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await log.info(env, SCOPE, `browserbase login transient: ${reason}`, { sessionId, totalMs: Date.now() - t0 });
    return { kind: "transient", reason };
  } finally {
    try { await browser?.disconnect(); } catch { /* ignore */ }
    if (sessionId) await closeSession(env, sessionId);
  }
}
