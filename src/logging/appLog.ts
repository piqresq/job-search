import { getVerboseLoggingEnabled } from "../db/appSettings";
import { insertAppLog } from "../db/appLogs";
import type { JobSourceId } from "../types/job";

export type LogLevel = "debug" | "info" | "warn" | "error" | "verbose";
export type LogSeverity = "critical" | "moderate" | "low" | "none";
export type LogCategory =
  | "orchestration"
  | "queue"
  | "vendor"
  | "ai_scoring"
  | "ai_drafts"
  | "storage"
  | "dashboard"
  | "system";
export type LogStatusKind = "running" | "paused" | "sleeping" | "blocked" | "degraded" | "failed" | "ok";

export type LogContext = {
  severity?: LogSeverity | null;
  category?: LogCategory | null;
  eventType?: string | null;
  providerId?: JobSourceId | null;
  jobId?: string | null;
  cycleId?: string | null;
  phase?: string | null;
  fingerprint?: string | null;
  statusKind?: LogStatusKind | null;
};

type AppLogWrite = {
  level: LogLevel;
  scope: string;
  message: string;
  meta?: unknown;
} & LogContext;

function consoleLine(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  const prefix = `[${level}] ${scope}:`;
  if (level === "error") console.error(prefix, message, meta ?? "");
  else if (level === "warn") console.warn(prefix, message, meta ?? "");
  else console.log(prefix, message, meta ?? "");
}

/**
 * Console-only structured log for Cloudflare Workers Observability.
 * Use this for high-volume trace logs that should not be persisted into D1 `app_logs`.
 */
export function observabilityLog(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: unknown,
  context?: LogContext,
): void {
  const payload = {
    level,
    scope,
    message,
    ...(context ?? {}),
    meta,
  };
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

/**
 * Uniform app logging: console + D1 for the dashboard Textbot (all levels including debug).
 * High-volume debug can grow `app_logs`; trim in D1 if needed.
 */
function shouldPersist(_level: LogLevel): boolean {
  return true;
}

function clip(v: string | null | undefined, max: number): string | null {
  const text = typeof v === "string" ? v.trim() : "";
  return text ? text.slice(0, max) : null;
}

function normalizeMessageForFingerprint(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, "#")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function deriveFingerprint(row: AppLogWrite): string | null {
  const explicit = clip(row.fingerprint, 255);
  if (explicit) return explicit;
  const parts = [
    clip(row.category, 32),
    clip(row.eventType, 64),
    clip(row.providerId, 32),
    clip(row.phase, 64),
    clip(row.statusKind, 24),
    normalizeMessageForFingerprint(row.message),
  ].filter(Boolean);
  if (!parts.length) return null;
  return parts.join("|").slice(0, 255);
}

/**
 * Uniform app logging: always logs to console; persists to D1 when DB is available.
 */
export async function writeAppLog(env: Env, row: AppLogWrite): Promise<void> {
  consoleLine(row.level, row.scope, row.message, row.meta);
  if (!shouldPersist(row.level)) return;
  try {
    await insertAppLog(env.DB, {
      level: row.level,
      scope: row.scope,
      message: row.message,
      meta: row.meta,
      severity: row.severity ?? null,
      category: row.category ?? null,
      eventType: row.eventType ?? null,
      providerId: row.providerId ?? null,
      jobId: row.jobId ?? null,
      cycleId: row.cycleId ?? null,
      phase: row.phase ?? null,
      fingerprint: deriveFingerprint(row),
      statusKind: row.statusKind ?? null,
    });
  } catch (e) {
    console.error("[appLog] insert failed", e);
  }
}

export async function appLog(
  env: Env,
  level: LogLevel,
  scope: string,
  message: string,
  meta?: unknown,
): Promise<void> {
  await writeAppLog(env, { level, scope, message, meta });
}

/**
 * High-detail logs (e.g. per-job AI scoring). No-op when verbose logging is off in Settings.
 * Persisted with level `verbose` for the dashboard debug column.
 */
export async function verboseLog(
  env: Env,
  scope: string,
  message: string,
  meta?: unknown,
): Promise<void> {
  if (!(await getVerboseLoggingEnabled(env.DB))) return;
  await writeAppLog(env, { level: "verbose", scope, message, meta });
}

export const log = {
  debug: (env: Env, scope: string, message: string, meta?: unknown) =>
    appLog(env, "debug", scope, message, meta),
  info: (env: Env, scope: string, message: string, meta?: unknown) =>
    appLog(env, "info", scope, message, meta),
  warn: (env: Env, scope: string, message: string, meta?: unknown) =>
    appLog(env, "warn", scope, message, meta),
  error: (env: Env, scope: string, message: string, meta?: unknown) =>
    appLog(env, "error", scope, message, meta),
  verbose: verboseLog,
  event: (
    env: Env,
    row: {
      level: LogLevel;
      scope: string;
      message: string;
      meta?: unknown;
      context?: LogContext;
    },
  ) => writeAppLog(env, { ...row, ...(row.context ?? {}) }),
  critical: (env: Env, scope: string, message: string, meta?: unknown, context?: LogContext) =>
    writeAppLog(env, {
      level: "error",
      scope,
      message,
      meta,
      severity: "critical",
      ...(context ?? {}),
    }),
  moderate: (env: Env, scope: string, message: string, meta?: unknown, context?: LogContext) =>
    writeAppLog(env, {
      level: "error",
      scope,
      message,
      meta,
      severity: "moderate",
      ...(context ?? {}),
    }),
  low: (env: Env, scope: string, message: string, meta?: unknown, context?: LogContext) =>
    writeAppLog(env, {
      level: "warn",
      scope,
      message,
      meta,
      severity: "low",
      ...(context ?? {}),
    }),
  status: (env: Env, scope: string, message: string, meta?: unknown, context?: LogContext) =>
    writeAppLog(env, {
      level: "info",
      scope,
      message,
      meta,
      severity: "none",
      ...(context ?? {}),
    }),
};
