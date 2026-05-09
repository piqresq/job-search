/** Admin-managed global settings stored in the `global_settings` D1 table. */

export const GLOBAL_KEY_SCORING_CONTRACT = "openai_scoring_contract_instruction";
export const GLOBAL_KEY_NEW_USER_TEMPLATE = "new_user_settings_template_json";

export async function getGlobalSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM global_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setGlobalSetting(db: D1Database, key: string, value: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run();
}

export async function getGlobalScoringContract(db: D1Database): Promise<string | null> {
  const raw = await getGlobalSetting(db, GLOBAL_KEY_SCORING_CONTRACT);
  return raw?.trim() || null;
}

export async function setGlobalScoringContract(db: D1Database, contract: string): Promise<void> {
  return setGlobalSetting(db, GLOBAL_KEY_SCORING_CONTRACT, contract);
}

export async function getGlobalNewUserTemplate(db: D1Database): Promise<Record<string, string> | null> {
  const raw = await getGlobalSetting(db, GLOBAL_KEY_NEW_USER_TEMPLATE);
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

export async function setGlobalNewUserTemplate(db: D1Database, template: Record<string, string>): Promise<void> {
  return setGlobalSetting(db, GLOBAL_KEY_NEW_USER_TEMPLATE, JSON.stringify(template));
}
