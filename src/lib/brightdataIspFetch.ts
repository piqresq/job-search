/**
 * Fetch a URL through the ISP-proxy zone using HTTP proxy absolute-URI mode
 * via `cloudflare:sockets`.
 *
 * Why this exists
 * ────────────────
 * Cloudflare Workers' built-in `fetch()` cannot route through arbitrary HTTP
 * proxies. Instead we open a plain TCP socket to the proxy and send the request
 * using the HTTP proxy absolute-URI format:
 *
 *     GET https://target/path HTTP/1.1
 *     Host: target
 *     Proxy-Authorization: Basic <creds>
 *     ...
 *
 * This avoids HTTP CONNECT + `socket.startTls()`. The previous CONNECT approach
 * failed because Workers' BoringSSL TLS fingerprint is blocked by LinkedIn's
 * Cloudflare CDN (confirmed: curl with schannel TLS works fine through the same
 * proxy; Workers' startTls() returns "TLS Handshake Failed" to the same target).
 * In absolute-URI mode the proxy makes the TLS connection to LinkedIn on our
 * behalf using its own residential-IP TLS stack, which LinkedIn accepts.
 *
 * Egress: the static Polish residential IP allocated to the zone.
 * Return: same `PublicFetchResult` discriminated union as `fetchPublicListingHtml`
 *         so it slots into `detectExpiration` unchanged.
 *
 * Constraints:
 *   - Only HTTPS targets (no plaintext HTTP). LinkedIn / JSearch landing pages
 *     are always HTTPS, so this is fine.
 *   - We send `Connection: close` so the response ends at EOF (avoids
 *     implementing keep-alive). Body cap 500 KB.
 *   - Compression: we accept `gzip` only and decode with `DecompressionStream`.
 *   - Redirects: NOT followed when we sent cookies (so a 3xx → /login is visible
 *     as `auth_expired`). When cookies absent, we don't follow either — callers
 *     for non-auth flows shouldn't pass cookies.
 */

import type { PublicFetchResult } from "./listingExpirationFetch";

const REQUEST_TIMEOUT_MS = 25_000;
const BODY_CAP_BYTES = 500 * 1024; // 500 KB

const USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
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
    (lower.includes("cloudflare") && lower.includes("ray id"))
  );
}

/** Concatenate Uint8Arrays into one. */
function concatBytes(parts: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** Locate the position immediately AFTER `\r\n\r\n` in `bytes`, or -1. */
function findHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a && bytes[i + 2] === 0x0d && bytes[i + 3] === 0x0a) {
      return i + 4;
    }
  }
  return -1;
}

/** Race a promise against a timeout that rejects with a labelled error. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

/** Decode HTTP/1.1 `Transfer-Encoding: chunked` body bytes. */
function decodeChunked(bytes: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let outBytes = 0;
  let i = 0;
  while (i < bytes.length) {
    // Read chunk-size hex line.
    let lineEnd = -1;
    for (let j = i; j + 1 < bytes.length; j++) {
      if (bytes[j] === 0x0d && bytes[j + 1] === 0x0a) {
        lineEnd = j;
        break;
      }
    }
    if (lineEnd === -1) break; // truncated
    const sizeLine = new TextDecoder("ascii").decode(bytes.slice(i, lineEnd));
    const sizeHex = sizeLine.split(";")[0]!.trim(); // strip chunk-ext
    const chunkSize = parseInt(sizeHex, 16);
    if (!Number.isFinite(chunkSize) || chunkSize < 0) break;
    i = lineEnd + 2;
    if (chunkSize === 0) break; // end of chunks (skip trailers)
    if (i + chunkSize > bytes.length) {
      // Body truncated mid-chunk — keep what we have.
      out.push(bytes.slice(i));
      outBytes += bytes.length - i;
      break;
    }
    out.push(bytes.slice(i, i + chunkSize));
    outBytes += chunkSize;
    i += chunkSize + 2; // skip trailing CRLF
  }
  return concatBytes(out, outBytes);
}

/** Decompress a gzip-encoded body to bytes, then to UTF-8 text. */
async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

/** Decompress a deflate body (rarely served by LinkedIn but cheap to support). */
async function inflateToText(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

type ParsedResponse = {
  status: number;
  headers: Headers;
  bodyBytes: Uint8Array;
  rawHeadersString: string;
};

/**
 * Parse an HTTP/1.1 response buffer into status + headers + raw body bytes.
 * Body bytes are NOT yet decoded — caller picks chunked / gzip handling based
 * on the parsed headers.
 */
function parseHttpResponse(buf: Uint8Array): ParsedResponse | null {
  const headerEnd = findHeaderEnd(buf);
  if (headerEnd === -1) return null;
  const headerStr = new TextDecoder("iso-8859-1").decode(buf.slice(0, headerEnd - 4));
  const bodyBytes = buf.slice(headerEnd);

  const lines = headerStr.split("\r\n");
  const statusMatch = lines[0]?.match(/^HTTP\/\d\.\d\s+(\d{3})/);
  const status = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;

  const headers = new Headers();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    try { headers.append(name, value); } catch { /* skip invalid header chars */ }
  }
  return { status, headers, bodyBytes, rawHeadersString: headerStr };
}

/** Apply Transfer-Encoding + Content-Encoding to a body buffer, return text. */
async function decodeResponseBody(parsed: ParsedResponse): Promise<string> {
  let bytes = parsed.bodyBytes;
  const transferEnc = (parsed.headers.get("transfer-encoding") ?? "").toLowerCase();
  if (transferEnc.includes("chunked")) {
    bytes = decodeChunked(bytes);
  }
  const contentEnc = (parsed.headers.get("content-encoding") ?? "").toLowerCase();
  if (contentEnc === "gzip" || contentEnc === "x-gzip") {
    return gunzipToText(bytes);
  }
  if (contentEnc === "deflate") {
    return inflateToText(bytes);
  }
  // identity / unknown — assume utf-8.
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Read from a ReadableStream<Uint8Array> until either (a) the predicate is
 * satisfied (returns true), (b) we hit `maxBytes`, or (c) stream EOFs.
 * Returns the accumulated bytes. The reader is released afterwards.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  stopWhen: (buf: Uint8Array) => boolean,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    parts.push(value);
    total += value.byteLength;
    if (total > maxBytes) {
      // truncate last chunk so we don't exceed cap
      const overflow = total - maxBytes;
      parts[parts.length - 1] = value.slice(0, value.byteLength - overflow);
      total = maxBytes;
      break;
    }
    if (stopWhen(concatBytes(parts, total))) break;
  }
  return concatBytes(parts, total);
}

type ProxyCreds = {
  host: string;
  port: number;
  username: string;
  password: string;
};

function readProxyCreds(env: Env): ProxyCreds | { error: string } {
  const host = env.BRIGHTDATA_ISP_PROXY_HOST ?? "brd.superproxy.io";
  const portStr = env.BRIGHTDATA_ISP_PROXY_PORT ?? "33335";
  const port = parseInt(portStr, 10);
  const username = env.BRIGHTDATA_ISP_PROXY_USERNAME ?? "";
  const password = env.BRIGHTDATA_ISP_PROXY_PASSWORD ?? "";
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { error: `invalid BRIGHTDATA_ISP_PROXY_PORT: ${portStr}` };
  }
  if (!username || !password) {
    return { error: "BRIGHTDATA_ISP_PROXY_USERNAME / _PASSWORD not set" };
  }
  return { host, port, username, password };
}

/**
 * Fetch `url` through Bright Data's ISP-proxy super-proxy and classify the
 * result the same way `fetchPublicListingHtml` does.
 *
 * @param env             Worker env (proxy host/port + username/password).
 * @param url             Target URL (must be https://).
 * @param acceptLanguage  BCP-47 Accept-Language for the target request.
 * @param cookieHeader    Optional `Cookie:` header. When provided, a 3xx to
 *                        `/login` / `/authwall` / `/checkpoint` returns
 *                        `auth_expired` instead of being followed.
 */
export async function fetchViaBrightdataIsp(
  env: Env,
  url: string,
  acceptLanguage = "en-US,en;q=0.9",
  cookieHeader?: string,
): Promise<PublicFetchResult> {
  const creds = readProxyCreds(env);
  if ("error" in creds) return { kind: "transient", error: creds.error };

  let target: URL;
  try {
    target = new URL(url);
  } catch (err) {
    return { kind: "transient", error: `bad target URL: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (target.protocol !== "https:") {
    return { kind: "transient", error: `only https targets supported (got ${target.protocol})` };
  }

  const withCookies = Boolean(cookieHeader);
  const t0 = Date.now();

  // Lazily import cloudflare:sockets so this module stays loadable in
  // non-Workers contexts (e.g. type-only consumers, tests).
  const { connect } = await import("cloudflare:sockets");

  // ── 1. Open plain TCP socket to proxy ───────────────────────────────────
  // We use "off" (no TLS to proxy) — the proxy handles TLS to the target via
  // HTTP proxy absolute-URI mode, so startTls() is never called from our side.
  let socket: Socket;
  try {
    socket = connect(
      { hostname: creds.host, port: creds.port },
      { secureTransport: "off", allowHalfOpen: false },
    );
  } catch (err) {
    return { kind: "transient", error: `socket connect failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const cleanup = (): void => {
    try { socket.close().catch(() => {}); } catch { /* ignore */ }
  };

  try {
    // ── 2. Send HTTP request in proxy absolute-URI format ─────────────────
    // Full https:// URL as the request-URI tells the proxy to fetch the HTTPS
    // resource on our behalf. Proxy-Authorization authenticates to the proxy;
    // the proxy strips it before forwarding to the target.
    const authToken = btoa(`${creds.username}:${creds.password}`);
    const reqLines = [
      `GET ${url} HTTP/1.1`,
      `Host: ${target.host}`,
      `Proxy-Authorization: Basic ${authToken}`,
      `User-Agent: ${pickUserAgent()}`,
      `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8`,
      `Accept-Language: ${acceptLanguage}`,
      `Accept-Encoding: gzip`,
      `Referer: https://www.google.com/`,
      `Upgrade-Insecure-Requests: 1`,
      `Sec-Fetch-Dest: document`,
      `Sec-Fetch-Mode: navigate`,
      `Sec-Fetch-Site: cross-site`,
      `Sec-Fetch-User: ?1`,
      `Cache-Control: no-cache`,
      `Connection: close`,
    ];
    if (cookieHeader) reqLines.push(`Cookie: ${cookieHeader}`);
    reqLines.push("", "");

    const reqBytes = new TextEncoder().encode(reqLines.join("\r\n"));
    {
      const writer = socket.writable.getWriter();
      try {
        await withTimeout(writer.write(reqBytes), REQUEST_TIMEOUT_MS, "request write");
      } finally {
        writer.releaseLock();
      }
    }

    // ── 3. Read response until EOF or body cap ────────────────────────────
    let respBytes: Uint8Array;
    {
      const reader = socket.readable.getReader();
      try {
        respBytes = await withTimeout(
          readUntil(reader, BODY_CAP_BYTES + 16 * 1024, () => false),
          REQUEST_TIMEOUT_MS,
          "response read",
        );
      } finally {
        reader.releaseLock();
      }
    }

    cleanup();

    // ── 7. Parse + classify ───────────────────────────────────────────────
    const parsed = parseHttpResponse(respBytes);
    if (!parsed) {
      return { kind: "transient", error: "incomplete HTTP response (no header terminator)" };
    }

    const status = parsed.status;
    const locationHeader = parsed.headers.get("location") ?? "";
    let finalUrl = url;
    if (locationHeader && status >= 300 && status < 400) {
      try { finalUrl = new URL(locationHeader, url).toString(); } catch { /* keep url */ }
    }

    // ── Auth redirect: only meaningful when we sent cookies ───────────────
    if (withCookies && status >= 300 && status < 400) {
      if (isLinkedinAuthRedirect(finalUrl) || isLinkedinAuthRedirect(locationHeader)) {
        return { kind: "auth_expired", redirectUrl: finalUrl };
      }
      return { kind: "transient", error: `unexpected redirect ${status} to ${finalUrl}` };
    }
    // ── No-cookie redirect: follow once would be nice, but the scan-without-
    //    cookies path doesn't need it (we only land on jobs pages directly).
    if (!withCookies && status >= 300 && status < 400) {
      return { kind: "transient", error: `redirect ${status} (no cookies) to ${finalUrl}` };
    }

    if (status === 404 || status === 410) {
      return { kind: "not_found", status, finalUrl };
    }
    if (status === 429) {
      return { kind: "blocked", status, reason: "rate_limit", bodyPreview: "" };
    }
    if (status === 403) {
      let preview = "";
      try {
        const html = await decodeResponseBody(parsed);
        preview = html.slice(0, 300);
        if (parseChallengeBody(html)) {
          return { kind: "blocked", status, reason: "challenge", bodyPreview: preview };
        }
      } catch { /* ignore decode errors for 403 */ }
      return { kind: "blocked", status, reason: "forbidden", bodyPreview: preview };
    }
    if (status >= 500) {
      return { kind: "transient", error: `target server error: HTTP ${status}` };
    }
    if (status < 200 || status >= 300) {
      return { kind: "transient", error: `unexpected status: ${status}` };
    }

    // 2xx — decode body and run challenge sniff
    let html: string;
    try {
      html = await decodeResponseBody(parsed);
    } catch (err) {
      return { kind: "transient", error: `body decode error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (parseChallengeBody(html)) {
      return { kind: "blocked", status, reason: "challenge", bodyPreview: html.slice(0, 300) };
    }

    // LinkedIn sometimes serves the auth-wall as 200 + login form (not a 3xx).
    if (withCookies && /<form[^>]+action="\/checkpoint\/lg\/login-submit"/i.test(html)) {
      return { kind: "auth_expired", redirectUrl: finalUrl };
    }

    const durationMs = Date.now() - t0;
    return { kind: "ok", status, html, finalUrl, durationMs };
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "transient", error: `ISP proxy fetch error: ${msg}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw ISP HTTP request — used for multi-step flows (e.g. LinkedIn login)
// ─────────────────────────────────────────────────────────────────────────────

export interface IspRawResponse {
  status: number;
  /** Value of the Location response header, empty if absent. */
  location: string;
  /** All Set-Cookie header values; preserves multiple values without comma-joining. */
  setCookies: string[];
  body: string;
  /** Resolved URL after Location expansion (same as `url` when no redirect). */
  finalUrl: string;
}

/**
 * Make a single GET or POST request via the ISP proxy and return the raw
 * response. Does NOT follow redirects — the caller inspects `location`.
 *
 * Used for multi-step auth flows where each redirect step must be classified
 * independently (e.g. LinkedIn login: GET /login → POST /uas/login-submit).
 *
 * Transport: HTTP CONNECT to establish a TCP tunnel through the proxy, then
 * socket.startTls() (with expectedServerHostname for SNI + cert validation)
 * to establish TLS over that tunnel. The residential proxy IP handles the
 * outbound TCP connection to the target, so LinkedIn sees a Polish residential
 * IP, not a Cloudflare datacenter IP.
 *
 * Errors include the failed STEP so observability shows exactly what failed:
 *   step=proxy_connect    — couldn't open TCP socket to proxy
 *   step=connect_write    — couldn't write CONNECT request to proxy
 *   step=connect_response — proxy didn't reply, or replied non-200
 *   step=start_tls        — startTls() threw
 *   step=request_write    — couldn't write HTTPS request over TLS
 *   step=response_read    — TLS read failed (handshake / read timeout / EOF)
 *   step=parse            — response body unparseable
 */
export async function ispRawRequest(
  env: Env,
  opts: {
    method: "GET" | "POST";
    url: string;
    /** Cookie: header value built from prior responses. */
    cookieHeader?: string;
    /** POST body as an application/x-www-form-urlencoded string. */
    postBody?: string;
    /** Sets Referer + Origin headers (marks request as same-origin navigation). */
    referer?: string;
    acceptLanguage?: string;
  },
): Promise<IspRawResponse | { error: string }> {
  const creds = readProxyCreds(env);
  if ("error" in creds) return { error: `step=creds ${creds.error}` };

  let target: URL;
  try {
    target = new URL(opts.url);
  } catch (err) {
    return { error: `step=parse_url bad URL: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (target.protocol !== "https:") return { error: "step=parse_url only https targets supported" };

  const { connect } = await import("cloudflare:sockets");

  // ── 1. Open plain TCP socket to proxy ────────────────────────────────────
  let socket: Socket;
  try {
    socket = connect(
      { hostname: creds.host, port: creds.port },
      { secureTransport: "starttls", allowHalfOpen: false },
    );
  } catch (err) {
    return { error: `step=proxy_connect ${err instanceof Error ? err.message : String(err)}` };
  }

  const cleanupSocket = (s: Socket): void => {
    try { s.close().catch(() => {}); } catch { /* ignore */ }
  };

  let activeSocket: Socket = socket;

  try {
    // ── 2. Write HTTP CONNECT to open a TCP tunnel ─────────────────────────
    const targetHost = `${target.hostname}:${target.port || 443}`;
    const authToken = btoa(`${creds.username}:${creds.password}`);
    const connectReq = [
      `CONNECT ${targetHost} HTTP/1.1`,
      `Host: ${targetHost}`,
      `Proxy-Authorization: Basic ${authToken}`,
      `Proxy-Connection: Keep-Alive`,
      "",
      "",
    ].join("\r\n");

    try {
      const w = socket.writable.getWriter();
      try { await withTimeout(w.write(new TextEncoder().encode(connectReq)), 10_000, "CONNECT write"); }
      finally { w.releaseLock(); }
    } catch (err) {
      cleanupSocket(socket);
      return { error: `step=connect_write ${err instanceof Error ? err.message : String(err)}` };
    }

    // ── 3. Read CONNECT response (status line + headers terminator) ────────
    let connectRespBytes: Uint8Array;
    try {
      const r = socket.readable.getReader();
      try {
        connectRespBytes = await withTimeout(
          readUntil(r, 4096, (buf) => findHeaderEnd(buf) !== -1),
          10_000,
          "CONNECT response",
        );
      } finally { r.releaseLock(); }
    } catch (err) {
      cleanupSocket(socket);
      return { error: `step=connect_response ${err instanceof Error ? err.message : String(err)}` };
    }

    const connectHead = new TextDecoder("ascii").decode(connectRespBytes.slice(0, 200));
    const statusM = connectHead.match(/^HTTP\/\d\.\d\s+(\d{3})([^\r\n]*)/);
    if (!statusM || statusM[1] !== "200") {
      cleanupSocket(socket);
      const code = statusM?.[1] ?? "noparse";
      const reason = (statusM?.[2] ?? "").trim();
      return { error: `step=connect_response proxy returned ${code} ${reason}` };
    }

    // ── 4. Upgrade socket to TLS with SNI = target hostname ───────────────
    let tlsSocket: Socket;
    try {
      tlsSocket = socket.startTls({ expectedServerHostname: target.hostname });
      activeSocket = tlsSocket;
    } catch (err) {
      cleanupSocket(socket);
      return { error: `step=start_tls ${err instanceof Error ? err.message : String(err)}` };
    }

    // ── 5. Write HTTPS request over TLS tunnel ─────────────────────────────
    const al = opts.acceptLanguage ?? "en-US,en;q=0.9";
    const postBodyBytes = opts.postBody ? new TextEncoder().encode(opts.postBody) : null;
    const reqLines: string[] = [
      `${opts.method} ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.hostname}`,
      `User-Agent: ${pickUserAgent()}`,
      `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8`,
      `Accept-Language: ${al}`,
      `Accept-Encoding: gzip`,
      `Cache-Control: max-age=0`,
      `Upgrade-Insecure-Requests: 1`,
      `Sec-Fetch-Dest: document`,
      `Sec-Fetch-Mode: navigate`,
      `Sec-Fetch-Site: ${opts.referer ? "same-origin" : "none"}`,
      `Sec-Fetch-User: ?1`,
      `Connection: close`,
    ];
    if (opts.referer) { reqLines.push(`Referer: ${opts.referer}`); reqLines.push(`Origin: https://${target.hostname}`); }
    if (opts.cookieHeader) reqLines.push(`Cookie: ${opts.cookieHeader}`);
    if (postBodyBytes) {
      reqLines.push(`Content-Type: application/x-www-form-urlencoded`);
      reqLines.push(`Content-Length: ${postBodyBytes.length}`);
    }
    reqLines.push("", "");

    const headerBytes = new TextEncoder().encode(reqLines.join("\r\n"));
    const reqBytes = postBodyBytes
      ? (() => { const b = new Uint8Array(headerBytes.length + postBodyBytes.length); b.set(headerBytes); b.set(postBodyBytes, headerBytes.length); return b; })()
      : headerBytes;

    try {
      const w = tlsSocket.writable.getWriter();
      try { await withTimeout(w.write(reqBytes), REQUEST_TIMEOUT_MS, "request write"); }
      finally { w.releaseLock(); }
    } catch (err) {
      cleanupSocket(tlsSocket);
      return { error: `step=request_write ${err instanceof Error ? err.message : String(err)}` };
    }

    // ── 6. Read response (TLS handshake completes here on first read) ──────
    let respBytes: Uint8Array;
    try {
      const r = tlsSocket.readable.getReader();
      try { respBytes = await withTimeout(readUntil(r, BODY_CAP_BYTES + 16 * 1024, () => false), REQUEST_TIMEOUT_MS, "response read"); }
      finally { r.releaseLock(); }
    } catch (err) {
      cleanupSocket(tlsSocket);
      return { error: `step=response_read ${err instanceof Error ? err.message : String(err)}` };
    }
    cleanupSocket(tlsSocket);

    if (respBytes.length === 0) {
      return { error: "step=response_read empty response (connection closed before any data)" };
    }

    const parsed = parseHttpResponse(respBytes);
    if (!parsed) return { error: `step=parse incomplete HTTP response (received ${respBytes.length} bytes, no header terminator)` };

    // Extract Set-Cookie — Headers.get() joins multiples with commas which
    // is ambiguous since cookie values can contain commas.
    const setCookies: string[] = [];
    for (const line of parsed.rawHeadersString.split("\r\n").slice(1)) {
      if (line.toLowerCase().startsWith("set-cookie:")) {
        setCookies.push(line.slice("set-cookie:".length).trim());
      }
    }

    const location = parsed.headers.get("location") ?? "";
    let finalUrl = opts.url;
    if (location) { try { finalUrl = new URL(location, opts.url).toString(); } catch { /* keep */ } }

    let body = "";
    try { body = await decodeResponseBody(parsed); }
    catch (err) { return { error: `step=body_decode ${err instanceof Error ? err.message : String(err)}` }; }

    return { status: parsed.status, location, setCookies, body, finalUrl };
  } catch (err) {
    cleanupSocket(activeSocket);
    return { error: `step=unexpected ${err instanceof Error ? err.message : String(err)}` };
  }
}
