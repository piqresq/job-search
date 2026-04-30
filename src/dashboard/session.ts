const COOKIE_NAME = "jobdash_sess";
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

const enc = new TextEncoder();

function base64UrlEncodeBytes(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]!);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeUtf8(text: string): string {
  return base64UrlEncodeBytes(enc.encode(text));
}

function base64UrlDecodeToUtf8(b64url: string): string {
  const pad = 4 - (b64url.length % 4);
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + (pad < 4 ? "=".repeat(pad) : "");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacSha256B64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncodeBytes(new Uint8Array(sig));
}

async function sha256Bytes(s: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return new Uint8Array(buf);
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyDashboardPassword(
  env: Env,
  password: string,
): Promise<boolean> {
  const expected = env.DASHBOARD_PASSWORD?.trim();
  if (!expected) return false;
  const [ha, he] = await Promise.all([sha256Bytes(password), sha256Bytes(expected)]);
  if (ha.length !== he.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ he[i]!;
  return diff === 0;
}

export function dashboardUserMatches(env: Env, username: string): boolean {
  const u = env.DASHBOARD_USER?.trim();
  if (!u) return false;
  return timingSafeEqualUtf8(username.trim(), u);
}

export async function createSessionCookie(
  secret: string,
  username: string,
  secure: boolean,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = JSON.stringify({ u: username, exp });
  const payloadB64 = base64UrlEncodeUtf8(payload);
  const sig = await hmacSha256B64Url(secret, payloadB64);
  const token = `${payloadB64}.${sig}`;
  const sec = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${sec}`;
}

export function clearSessionCookie(secure: boolean): string {
  const sec = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${sec}`;
}

export async function readSessionUsername(
  secret: string,
  cookieHeader: string | null,
): Promise<string | null> {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  let raw: string | null = null;
  for (const p of parts) {
    if (p.startsWith(`${COOKIE_NAME}=`)) {
      raw = decodeURIComponent(p.slice(COOKIE_NAME.length + 1));
      break;
    }
  }
  if (!raw || !raw.includes(".")) return null;
  const dot = raw.lastIndexOf(".");
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expectedSig = await hmacSha256B64Url(secret, payloadB64);
  if (!timingSafeEqualUtf8(sig, expectedSig)) return null;
  let payload: { u?: string; exp?: number };
  try {
    payload = JSON.parse(base64UrlDecodeToUtf8(payloadB64)) as { u?: string; exp?: number };
  } catch {
    return null;
  }
  if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.u;
}

export async function requireDashboardSession(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "session_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const user = await readSessionUsername(secret, request.headers.get("Cookie"));
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
