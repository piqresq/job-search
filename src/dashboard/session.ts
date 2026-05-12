import {
  ensureBootstrapAdmin,
  getUserById,
  getUserHashByUsername,
  touchLastLogin,
  verifyPassword,
  BOOTSTRAP_ADMIN_ID,
} from "../db/users";

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SessionClaims = {
  userId: string;
  role: "admin" | "user";
};

export async function createSessionCookie(
  secret: string,
  userId: string,
  role: string,
  secure: boolean,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = JSON.stringify({ uid: userId, role, exp });
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

export async function readSessionClaims(
  secret: string,
  cookieHeader: string | null,
): Promise<SessionClaims | null> {
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
  if (!timingSafeEqual(sig, expectedSig)) return null;
  let payload: { uid?: string; role?: string; exp?: number };
  try {
    payload = JSON.parse(base64UrlDecodeToUtf8(payloadB64)) as {
      uid?: string;
      role?: string;
      exp?: number;
    };
  } catch {
    return null;
  }
  if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  const role = payload.role === "admin" ? "admin" : "user";
  return { userId: payload.uid, role };
}

/**
 * Guard for all dashboard API routes.
 * Returns SessionClaims on success, or a 401 Response on failure.
 */
export async function requireDashboardSession(
  request: Request,
  env: Env,
): Promise<SessionClaims | Response> {
  const secure = new URL(request.url).protocol === "https:";
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "session_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const claims = await readSessionClaims(secret, request.headers.get("Cookie"));
  if (!claims) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "set-cookie": clearSessionCookie(secure),
      },
    });
  }
  const user = await getUserById(env.DB, claims.userId);
  if (!user || user.status !== "active") {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "set-cookie": clearSessionCookie(secure),
      },
    });
  }
  return { userId: user.id, role: user.role === "admin" ? "admin" : "user" };
}

/**
 * Guard for admin-only routes. Returns SessionClaims when role === 'admin',
 * or a 403 Response otherwise (caller still gets 401 if not logged in at all).
 */
export async function requireAdminSession(
  request: Request,
  env: Env,
): Promise<SessionClaims | Response> {
  const result = await requireDashboardSession(request, env);
  if (result instanceof Response) return result;
  if (result.role !== "admin") {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return result;
}

/**
 * Authenticate a username/password against D1 users.
 * Falls back to env credentials for the bootstrap admin if their D1 row is missing,
 * then seeds the row automatically on first successful login.
 *
 * Returns { userId, role } on success, null on failure.
 */
export async function authenticateUser(
  db: D1Database,
  env: Env,
  username: string,
  password: string,
): Promise<SessionClaims | null> {
  const now = Math.floor(Date.now() / 1000);
  const uname = username.trim().toLowerCase();
  if (!uname || !password) return null;

  const dbUser = await getUserHashByUsername(db, uname);

  if (!dbUser) {
    // Bootstrap: if this is the env-configured admin and no D1 row yet, seed and accept.
    const envUser = env.DASHBOARD_USER?.trim().toLowerCase();
    const envPass = env.DASHBOARD_PASSWORD?.trim();
    if (!envUser || !envPass) return null;
    if (uname !== envUser) return null;
    // timing-safe compare against env password
    const hashA = await hashStringForComparison(password);
    const hashB = await hashStringForComparison(envPass);
    if (!timingSafeEqual(hashA, hashB)) return null;
    await ensureBootstrapAdmin(db, uname, password, now);
    await touchLastLogin(db, BOOTSTRAP_ADMIN_ID, now);
    return { userId: BOOTSTRAP_ADMIN_ID, role: "admin" };
  }

  const ok = await verifyPassword(password, dbUser.password_salt, dbUser.password_hash);
  if (!ok) return null;

  // Fetch role / status
  const userRow = await db
    .prepare("SELECT role, status FROM users WHERE id = ?")
    .bind(dbUser.id)
    .first<{ role: string; status: string }>();
  if (!userRow || userRow.status !== "active") return null;

  await touchLastLogin(db, dbUser.id, now);
  const role = userRow.role === "admin" ? "admin" : "user";
  return { userId: dbUser.id, role };
}

async function hashStringForComparison(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return base64UrlEncodeBytes(new Uint8Array(buf));
}
