/**
 * User management: PBKDF2 hashing, CRUD, bootstrap-admin seeding, new-user settings clone.
 *
 * User ID convention:
 *  - Bootstrap admin: id === username (e.g. 'piqresq'), matching the migration backfill.
 *  - All other users: id === username (lowercased, validated to [a-z0-9_-]).
 *
 * Template key list: settings that are cloned from global_settings.new_user_settings_template_json
 * when a new user is created.
 */

const ENC = new TextEncoder();
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";

export const BOOTSTRAP_ADMIN_ID = "piqresq";

export const USER_SETTINGS_TEMPLATE_KEYS: readonly string[] = [
  "enabled_job_sources",
  "search_countries",
  "search_roles_tier1",
  "search_roles_tier2",
  "search_roles_query_cache_quoted_or_tier1",
  "search_roles_query_cache_quoted_or_tier2",
  "search_remote_only",
  "search_employment_mode",
  "search_recency_mode",
  "provider_request_caps",
  "openai_scoring_instruction",
  "openai_draft_instruction",
  "api_extraction_enabled",
];

export type UserRow = {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
};

export type UserWithCaps = UserRow & {
  caps: Partial<Record<string, number>>;
};

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", ENC.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt: ENC.encode(salt), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const computed = await hashPassword(password, salt);
  if (computed.length !== storedHash.length) return false;
  const a = ENC.encode(computed);
  const b = ENC.encode(storedHash);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Validate and normalise a candidate username → throws on invalid. */
export function normalizeUsername(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) throw new Error("Username is required");
  if (s.length > 48) throw new Error("Username too long (max 48 chars)");
  if (!/^[a-z0-9_-]+$/.test(s)) throw new Error("Username may only contain a-z, 0-9, _ and -");
  return s;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT id, username, role, status, created_at, updated_at, last_login_at FROM users WHERE username = ?")
    .bind(username)
    .first<UserRow>();
  return row ?? null;
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT id, username, role, status, created_at, updated_at, last_login_at FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  return row ?? null;
}

export async function getUserHashById(
  db: D1Database,
  id: string,
): Promise<{ password_hash: string; password_salt: string } | null> {
  return db
    .prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
    .bind(id)
    .first<{ password_hash: string; password_salt: string }>();
}

export async function getUserHashByUsername(
  db: D1Database,
  username: string,
): Promise<{ id: string; password_hash: string; password_salt: string } | null> {
  return db
    .prepare("SELECT id, password_hash, password_salt FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: string; password_hash: string; password_salt: string }>();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const res = await db
    .prepare(
      "SELECT id, username, role, status, created_at, updated_at, last_login_at FROM users ORDER BY created_at ASC",
    )
    .all<UserRow>();
  return res.results ?? [];
}

export async function listActiveUserIds(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare("SELECT id FROM users WHERE status = 'active' ORDER BY created_at ASC")
    .all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}

/**
 * Insert bootstrap admin into `users` if not already present.
 * Called on first login when the D1 row is missing.
 * The admin's user_id is always BOOTSTRAP_ADMIN_ID ('piqresq').
 */
export async function ensureBootstrapAdmin(
  db: D1Database,
  username: string,
  password: string,
  now: number,
): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM users WHERE id = ?")
    .bind(BOOTSTRAP_ADMIN_ID)
    .first<{ id: string }>();
  if (existing) return;
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, password_hash, password_salt, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`,
    )
    .bind(BOOTSTRAP_ADMIN_ID, username.toLowerCase(), hash, salt, now, now)
    .run();
}

/** Create a new (non-admin) user and clone settings from the new-user template. */
export async function createUser(
  db: D1Database,
  opts: { username: string; password: string; role?: "admin" | "user"; now: number },
): Promise<{ id: string }> {
  const username = normalizeUsername(opts.username);
  const id = username; // user_id === username (normalized)
  const salt = generateSalt();
  const hash = await hashPassword(opts.password, salt);
  const role = opts.role ?? "user";
  const { now } = opts;

  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, password_salt, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(id, username, hash, salt, role, now, now)
    .run();

  await cloneNewUserSettingsTemplate(db, id, now);

  return { id };
}

/**
 * Copy the new-user settings template into a freshly created user's app_settings rows.
 * If no template is stored in global_settings, falls back to the admin's current settings.
 */
async function cloneNewUserSettingsTemplate(db: D1Database, userId: string, now: number): Promise<void> {
  const templateRow = await db
    .prepare("SELECT value FROM global_settings WHERE key = 'new_user_settings_template_json'")
    .first<{ value: string }>();

  let templateMap: Record<string, string> | null = null;
  if (templateRow?.value) {
    try {
      const parsed = JSON.parse(templateRow.value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        templateMap = parsed as Record<string, string>;
      }
    } catch {
      /* ignore malformed template */
    }
  }

  if (!templateMap) {
    // Fall back to admin's current settings for the template keys
    const rows = await db
      .prepare(
        `SELECT key, value FROM app_settings WHERE user_id = ? AND key IN (${USER_SETTINGS_TEMPLATE_KEYS.map(() => "?").join(",")})`,
      )
      .bind(BOOTSTRAP_ADMIN_ID, ...USER_SETTINGS_TEMPLATE_KEYS)
      .all<{ key: string; value: string }>();
    templateMap = {};
    for (const r of rows.results ?? []) {
      templateMap[r.key] = r.value;
    }
  }

  if (Object.keys(templateMap).length === 0) return;

  const stmts = Object.entries(templateMap).map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO app_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      )
      .bind(userId, key, value),
  );
  // D1 batch limit is 100; template keys are ≤15 so one batch is fine.
  if (stmts.length > 0) await db.batch(stmts);
  void now; // suppress unused-variable warning
}

export async function setUserStatus(
  db: D1Database,
  id: string,
  status: "active" | "disabled",
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, id)
    .run();
}

export async function setUserRole(
  db: D1Database,
  id: string,
  role: "admin" | "user",
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .bind(role, now, id)
    .run();
}

export async function updatePassword(
  db: D1Database,
  id: string,
  newPassword: string,
  now: number,
): Promise<void> {
  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .bind(hash, salt, now, id)
    .run();
}

export async function touchLastLogin(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, id).run();
}

/**
 * Read per-user provider_request_caps from app_settings.
 * Returns {} if none stored (caller falls back to env defaults).
 */
export async function getUserProviderCaps(
  db: D1Database,
  userId: string,
): Promise<Partial<Record<string, number>>> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE user_id = ? AND key = 'provider_request_caps'")
    .bind(userId)
    .first<{ value: string }>();
  if (!row?.value?.trim()) return {};
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const o = parsed as Record<string, unknown>;
    const out: Partial<Record<string, number>> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function setUserProviderCaps(
  db: D1Database,
  userId: string,
  caps: Partial<Record<string, number>>,
  now: number,
): Promise<void> {
  const value = JSON.stringify(caps);
  await db
    .prepare(
      `INSERT INTO app_settings (user_id, key, value) VALUES (?, 'provider_request_caps', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    )
    .bind(userId, value)
    .run();
  void now;
}

/**
 * Seed global_settings.new_user_settings_template_json from the admin's current app_settings.
 * Called by the "Sync from piqresq" admin action.
 */
export async function syncNewUserTemplateFromAdmin(db: D1Database, now: number): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT key, value FROM app_settings WHERE user_id = ? AND key IN (${USER_SETTINGS_TEMPLATE_KEYS.map(() => "?").join(",")})`,
    )
    .bind(BOOTSTRAP_ADMIN_ID, ...USER_SETTINGS_TEMPLATE_KEYS)
    .all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results ?? []) {
    map[r.key] = r.value;
  }
  await db
    .prepare(
      `INSERT INTO global_settings (key, value, updated_at) VALUES ('new_user_settings_template_json', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(map), now)
    .run();
}
