/**
 * Connects to the Bright Data Browser API (hosted Chromium over CDP/WSS).
 *
 * Two quirks to work around in Cloudflare Workers:
 *
 * 1. `puppeteer.connect({ browserWSEndpoint })` uses the `ws` npm package
 *    which detects `globalThis.WebSocket` (always present in Workers) and
 *    throws "ws does not work in the browser".  Fix: pass a `transport` object.
 *
 * 2. The native `WebSocket(url)` constructor (browser-spec) silently strips
 *    credentials from `wss://user:pass@host:port` URLs — Bright Data's
 *    endpoint uses Basic Auth embedded in the URL.  Fix: use Cloudflare's
 *    `fetch()`-based WebSocket upgrade which forwards an `Authorization`
 *    header, so we extract the credentials manually.
 */

import puppeteer, { type Browser } from "puppeteer-core";

/**
 * Inject Bright Data's `-country-<iso2>` proxy flag into the WSS URL's username
 * portion so the residential exit IP comes from a specific country.
 *
 * LinkedIn's edge geo-redirects `www.linkedin.com/login` to country subdomains
 * (e.g. `at.linkedin.com/login`) which return 404 — so we MUST pin the exit IP
 * to a country that LinkedIn serves `/login` on `www.` for, and ideally to a
 * country matching where the LinkedIn account is normally used (avoids
 * "new location" checkpoint flow on login).
 *
 * Format expected by Bright Data: `wss://USER-country-pl:PASS@brd.superproxy.io:9222`.
 * If the URL already contains `-country-<xx>` we leave it alone.
 */
function injectCountry(wsUrl: string, country: string | null | undefined): string {
  if (!country) return wsUrl;
  const iso2 = country.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(iso2)) return wsUrl;

  const url = new URL(wsUrl);
  if (!url.username) return wsUrl; // No credentials → can't inject flag

  const userPart = decodeURIComponent(url.username);
  if (/-country-[a-z]{2}\b/i.test(userPart)) return wsUrl; // Already pinned

  url.username = encodeURIComponent(`${userPart}-country-${iso2}`);
  return url.toString();
}

/**
 * Open a WebSocket to `wsUrl` (which may contain Basic-Auth credentials in
 * the URL) using the Cloudflare fetch/upgrade path, then wrap it in a
 * puppeteer-core `ConnectionTransport`.
 */
async function openTransport(wsUrl: string, connectTimeoutMs = 20_000): Promise<{
  onmessage: ((msg: string) => void) | undefined;
  onclose: (() => void) | undefined;
  send(data: string): void;
  close(): void;
}> {
  // --- 1. Extract credentials from the URL ---
  const url = new URL(wsUrl);
  let authHeader: string | null = null;
  if (url.username || url.password) {
    authHeader = "Basic " + btoa(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`);
    url.username = "";
    url.password = "";
  }

  // Cloudflare fetch() needs http(s):// scheme; it handles the WS upgrade.
  const fetchUrl = url.toString()
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");

  const fetchHeaders: Record<string, string> = {
    "Upgrade": "websocket",
    "Connection": "Upgrade",
  };
  if (authHeader) {
    fetchHeaders["Authorization"] = authHeader;
  }

  // --- 2. Initiate WebSocket upgrade via fetch (supports custom headers) ---
  let response: Response;
  try {
    response = await Promise.race([
      fetch(fetchUrl, { headers: fetchHeaders }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Bright Data WS connect timed out after ${connectTimeoutMs}ms`)),
          connectTimeoutMs,
        ),
      ),
    ]);
  } catch (err) {
    throw new Error(`Bright Data WS fetch failed: ${String(err)}`);
  }

  if (response.status !== 101) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Bright Data WS upgrade rejected: HTTP ${response.status} — ${body.slice(0, 300)}`,
    );
  }

  const nativeWs = response.webSocket;
  if (!nativeWs) {
    throw new Error("Bright Data WS: upgrade succeeded but response.webSocket is null");
  }
  nativeWs.accept();

  // --- 3. Build the puppeteer-core ConnectionTransport ---
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

export async function connectBrightdata(env: Env): Promise<Browser> {
  const wsUrl = env.BRIGHTDATA_BROWSER_WS_ENDPOINT;
  if (!wsUrl) throw new Error("BRIGHTDATA_BROWSER_WS_ENDPOINT not set");

  // Pin the residential exit IP to a country where LinkedIn serves `/login`
  // on `www.linkedin.com`. Default `pl` matches the dashboard user's region.
  const country = (env as unknown as { LINKEDIN_AUTH_COUNTRY?: string }).LINKEDIN_AUTH_COUNTRY ?? "pl";
  const targetedUrl = injectCountry(wsUrl, country);

  const transport = await openTransport(targetedUrl);

  // `transport` bypasses puppeteer-core's internal `ws`-package path entirely.
  // Pass defaultViewport: null so puppeteer leaves the browser's own viewport
  // and devicePixelRatio untouched — Bright Data sets these to match the
  // managed residential fingerprint. Overriding them creates a mismatched
  // fingerprint that anti-bot systems (e.g. LinkedIn) flag immediately.
  return puppeteer.connect({ transport, defaultViewport: null });
}

export async function safeDisconnect(browser: Browser | null): Promise<void> {
  try {
    await browser?.disconnect();
  } catch {
    // Ignore cleanup errors — the remote session may already have ended.
  }
}
