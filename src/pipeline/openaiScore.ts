import { log, observabilityLog } from "../logging/appLog";
import { profileContextForPromptFromCv } from "../profile/baseline";
import { getCvTextForAiScoring } from "../profile/cvSource";
import { loadScoringInstructionForPrompt } from "./aiInstructions";
import {
  mergeOpenAiTextSanitizeStats,
  sanitizeOpenAiTransportText,
} from "./openaiTransportText";
import { errorMessage, isTransientOpenAiScoringError } from "./openaiTransientErrors";
import type { NormalizedJob, ScoringResult } from "../types/job";
import { parseScoringFromJson } from "../types/job";

const DEFAULT_SCORING_MODEL = "gpt-5-mini";
const SCORING_MAX_ATTEMPTS = 3;
const OPENAI_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function scoreJobWithOpenAiSingleAttempt(
  env: Env,
  job: NormalizedJob,
  key: string,
  scoringInstruction: string,
  cvText: string,
  attemptNumber: number,
): Promise<ScoringResult> {
  const title = sanitizeOpenAiTransportText(job.title ?? "");
  const company = sanitizeOpenAiTransportText(job.company ?? "");
  const location = sanitizeOpenAiTransportText(job.location ?? "");
  const urls = sanitizeOpenAiTransportText(job.applyUrl || job.jobUrl || "");
  const description = sanitizeOpenAiTransportText((job.description ?? "").slice(0, 12000));
  const safeCvProfile = sanitizeOpenAiTransportText(profileContextForPromptFromCv(cvText));
  const safeInstruction = sanitizeOpenAiTransportText(scoringInstruction);
  const jobBlock = [
    `Title: ${title.text}`,
    `Company: ${company.text}`,
    `Location: ${location.text}`,
    `Remote flag: ${job.isRemote}`,
    `URLs: ${urls.text}`,
    "",
    description.text,
  ].join("\n");

  const sanitizeStats = mergeOpenAiTextSanitizeStats([
    title.stats,
    company.stats,
    location.stats,
    urls.stats,
    description.stats,
    safeCvProfile.stats,
    safeInstruction.stats,
  ]);
  const body = {
    model: env.OPENAI_MODEL?.trim() || DEFAULT_SCORING_MODEL,
    // gpt-5-mini (and similar) only accept the default temperature; omit the field.
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          safeInstruction.text,
          "",
          "Privacy: The CV excerpt below is anonymized (contact details, locations, education names, and former employer names replaced). Judge fit from skills, seniority, domains, and described outcomes only.",
          "",
          "Candidate profile:",
          safeCvProfile.text,
        ].join("\n"),
      },
      {
        role: "user",
        content: `Evaluate this job:\n\n${jobBlock}`,
      },
    ],
  };
  const bodyJson = JSON.stringify(body);
  const requestMeta = {
    providerId: job.source,
    externalId: job.externalId,
    attemptNumber,
    model: body.model,
    titleLength: title.text.length,
    companyLength: company.text.length,
    locationLength: location.text.length,
    descriptionLength: description.text.length,
    cvProfileLength: safeCvProfile.text.length,
    requestBodyBytes: new TextEncoder().encode(bodyJson).length,
    sanitizeStats,
  };
  observabilityLog(
    "debug",
    "openai",
    "Scoring request prepared",
    requestMeta,
    {
      category: "ai_scoring",
      eventType: "openai_scoring_request_prepared",
      providerId: job.source,
      phase: "scoreJobWithOpenAI",
      statusKind: "running",
    },
  );

  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("openai_timeout"), OPENAI_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: bodyJson,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const message =
      controller.signal.aborted
        ? `OpenAI request timed out after ${OPENAI_REQUEST_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    observabilityLog(
      "error",
      "openai",
      "Scoring request transport failed",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        error: message.slice(0, 800),
      },
      {
        category: "ai_scoring",
        eventType: "openai_scoring_request_transport_failed",
        providerId: job.source,
        phase: "scoreJobWithOpenAI",
        statusKind: "degraded",
      },
    );
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const t = await res.text();
    observabilityLog(
      "error",
      "openai",
      "Scoring request failed",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        status: res.status,
        responsePreview: t.slice(0, 800),
      },
      {
        category: "ai_scoring",
        eventType: "openai_scoring_request_failed",
        providerId: job.source,
        phase: "scoreJobWithOpenAI",
        statusKind: "degraded",
      },
    );
    throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 800)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    observabilityLog(
      "error",
      "openai",
      "Scoring response missing content",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        choiceCount: Array.isArray(data.choices) ? data.choices.length : 0,
      },
      {
        category: "ai_scoring",
        eventType: "openai_scoring_response_empty",
        providerId: job.source,
        phase: "scoreJobWithOpenAI",
        statusKind: "degraded",
      },
    );
    throw new Error("OpenAI returned empty content");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    observabilityLog(
      "error",
      "openai",
      "Scoring response was not valid JSON",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        responseLength: raw.length,
        error: error instanceof Error ? error.message : String(error),
      },
      {
        category: "ai_scoring",
        eventType: "openai_scoring_response_non_json",
        providerId: job.source,
        phase: "scoreJobWithOpenAI",
        statusKind: "degraded",
      },
    );
    throw new Error("OpenAI returned non-JSON");
  }

  const merged = {
    ...parsed,
    fit_score: Number(parsed.fit_score),
    recommendation: parsed.recommendation,
  };
  const out = parseScoringFromJson(merged);
  if (!out) {
    observabilityLog(
      "error",
      "openai",
      "Scoring response JSON did not match expected schema",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        responseKeys: Object.keys(parsed).slice(0, 24),
      },
      {
        category: "ai_scoring",
        eventType: "openai_scoring_response_schema_invalid",
        providerId: job.source,
        phase: "scoreJobWithOpenAI",
        statusKind: "degraded",
      },
    );
    throw new Error("OpenAI scoring parse failed");
  }
  observabilityLog(
    "debug",
    "openai",
    "Scoring request completed",
    {
      ...requestMeta,
      durationMs: Date.now() - startedAtMs,
      fitScore: out.fit_score,
      recommendation: out.recommendation,
    },
    {
      category: "ai_scoring",
      eventType: "openai_scoring_request_completed",
      providerId: job.source,
      phase: "scoreJobWithOpenAI",
      statusKind: "ok",
    },
  );
  return out;
}

export async function scoreJobWithOpenAI(
  db: D1Database,
  env: Env,
  job: NormalizedJob,
): Promise<ScoringResult | null> {
  const key = env.OPENAI_API_KEY;
  if (!key) return null;

  await log.verbose(env, "openai", "Scoring request", {
    title: job.title,
    company: job.company,
    source: job.source,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_SCORING_MODEL,
  });

  const scoringInstruction = await loadScoringInstructionForPrompt(db);
  const cvText = await getCvTextForAiScoring(db);

  for (let attempt = 0; attempt < SCORING_MAX_ATTEMPTS; attempt++) {
    try {
      const out = await scoreJobWithOpenAiSingleAttempt(
        env,
        job,
        key,
        scoringInstruction,
        cvText,
        attempt + 1,
      );
      await log.verbose(env, "openai", "Scoring done", {
        title: job.title,
        fit_score: out.fit_score,
        recommendation: out.recommendation,
      });
      return out;
    } catch (e) {
      const canRetry = attempt < SCORING_MAX_ATTEMPTS - 1 && isTransientOpenAiScoringError(e);
      if (canRetry) {
        observabilityLog(
          "warn",
          "openai",
          "Retrying scoring request after transient failure",
          {
            providerId: job.source,
            externalId: job.externalId,
            attemptNumber: attempt + 1,
            maxAttempts: SCORING_MAX_ATTEMPTS,
            error: errorMessage(e).slice(0, 500),
          },
          {
            category: "ai_scoring",
            eventType: "openai_scoring_retry_scheduled",
            providerId: job.source,
            phase: "scoreJobWithOpenAI",
            statusKind: "degraded",
          },
        );
        await delay(attempt === 0 ? 450 : 1100);
        continue;
      }
      throw e instanceof Error ? e : new Error(errorMessage(e));
    }
  }
  throw new Error("OpenAI scoring: exhausted attempts without result");
}
