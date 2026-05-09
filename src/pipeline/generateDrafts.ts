import { log, observabilityLog } from "../logging/appLog";
import { profileContextForPromptFromCv } from "../profile/baseline";
import { getCvSources } from "../profile/cvSource";
import type { NormalizedJob, ScoringResult } from "../types/job";
import { loadDraftInstructionForPrompt } from "./aiInstructions";
import { applyDefaultCvStyles } from "./cvHtmlDefaultStyles";
import { reapplyCvFormatting } from "./cvHtmlEmphasis";
import {
  mergeOpenAiTextSanitizeStats,
  sanitizeOpenAiTransportText,
} from "./openaiTransportText";

/**
 * cvHtml: tailored HTML from Word (for .docx via html-to-docx). cvDraft: markdown/plain for DB preview.
 * referenceCvHtml: same mammoth HTML used for this request (must match reapplyCvFormatting / html-to-docx).
 */
export type DraftBundle = {
  cvDraft: string;
  cvHtml: string;
  coverLetter: string;
  referenceCvHtml: string;
};

const DEFAULT_DRAFT_MODEL = "gpt-5.5";
type OpenAiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
const DEFAULT_DRAFT_REASONING_EFFORT: OpenAiReasoningEffort = "high";
const OPENAI_DRAFT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function normalizeDraftReasoningEffort(raw: string | undefined): OpenAiReasoningEffort {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "none" || v === "minimal" || v === "low" || v === "medium" || v === "high" || v === "xhigh") {
    return v;
  }
  return DEFAULT_DRAFT_REASONING_EFFORT;
}

function modelSupportsReasoningEffort(model: string): boolean {
  const v = model.trim().toLowerCase();
  return v.startsWith("gpt-5") || v.startsWith("o");
}

export async function generateTailoredDrafts(
  db: D1Database,
  env: Env,
  userId: string,
  job: NormalizedJob,
  scoring: ScoringResult,
): Promise<DraftBundle | null> {
  const key = env.OPENAI_API_KEY;
  if (!key) return null;

  const draftSystemInstruction = await loadDraftInstructionForPrompt(db, userId);

  const model = env.OPENAI_DRAFT_MODEL?.trim() || DEFAULT_DRAFT_MODEL;
  const reasoningEffort = normalizeDraftReasoningEffort(env.OPENAI_DRAFT_REASONING_EFFORT);

  await log.verbose(env, "drafts", "Generate drafts request", {
    title: job.title,
    company: job.company,
    model,
    reasoningEffort: modelSupportsReasoningEffort(model) ? reasoningEffort : undefined,
  });

  const { text: cvText, html: cvHtmlBase } = await getCvSources(db, userId);
  const title = sanitizeOpenAiTransportText(job.title ?? "");
  const company = sanitizeOpenAiTransportText(job.company ?? "");
  const description = sanitizeOpenAiTransportText(`Description excerpt: ${(job.description ?? "").slice(0, 8000)}`);
  const safeCvProfile = sanitizeOpenAiTransportText(profileContextForPromptFromCv(cvText));
  const safeCvHtmlBase = sanitizeOpenAiTransportText(cvHtmlBase);
  const safeDraftInstruction = sanitizeOpenAiTransportText(draftSystemInstruction);

  const jobBlock = [
    `Title: ${title.text}`,
    `Company: ${company.text}`,
    description.text,
  ].join("\n");

  const scoringBlock = JSON.stringify(scoring, null, 2);
  const safeScoringBlock = sanitizeOpenAiTransportText(scoringBlock);
  const sanitizeStats = mergeOpenAiTextSanitizeStats([
    title.stats,
    company.stats,
    description.stats,
    safeCvProfile.stats,
    safeCvHtmlBase.stats,
    safeDraftInstruction.stats,
    safeScoringBlock.stats,
  ]);

  const body: {
    model: string;
    reasoning_effort?: OpenAiReasoningEffort;
    response_format: { type: "json_object" };
    messages: { role: "system" | "user"; content: string }[];
  } = {
    model,
    // GPT-5 reasoning models only accept the default temperature; omit the field.
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: safeDraftInstruction.text,
      },
      {
        role: "user",
        content: [
          "Base CV / candidate profile (sole source of truth for facts):",
          safeCvProfile.text,
          "",
          "--- CV as HTML exported from the original Word file (preserve this structure in cv_html; edit text only; reorder allowed) ---",
          safeCvHtmlBase.text,
          "",
          "Job fit scoring (JSON). Contains position_summary (3 sentences: employer context + role), positives[] (strengths vs this role—use to guide emphasis and order) and negatives[] (risks/gaps—awareness only; do not invent mitigation). Not a source of new facts about the candidate:",
          safeScoringBlock.text,
          "",
          "Target job:",
          jobBlock,
        ].join("\n"),
      },
    ],
  };
  if (modelSupportsReasoningEffort(model)) {
    body.reasoning_effort = reasoningEffort;
  }
  const bodyJson = JSON.stringify(body);
  const requestMeta = {
    providerId: job.source,
    externalId: job.externalId,
    model: body.model,
    reasoningEffort: body.reasoning_effort ?? null,
    requestBodyBytes: new TextEncoder().encode(bodyJson).length,
    sanitizeStats,
  };
  observabilityLog(
    "debug",
    "drafts",
    "Draft generation request prepared",
    requestMeta,
    {
      category: "ai_drafts",
      eventType: "openai_draft_request_prepared",
      providerId: job.source,
      phase: "generateTailoredDrafts",
      statusKind: "running",
    },
  );

  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("openai_draft_timeout"), OPENAI_DRAFT_REQUEST_TIMEOUT_MS);
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
        ? `OpenAI draft request timed out after ${OPENAI_DRAFT_REQUEST_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    observabilityLog(
      "error",
      "drafts",
      "Draft generation request transport failed",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        error: message.slice(0, 800),
      },
      {
        category: "ai_drafts",
        eventType: "openai_draft_request_transport_failed",
        providerId: job.source,
        phase: "generateTailoredDrafts",
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
      "drafts",
      "Draft generation request failed",
      {
        ...requestMeta,
        durationMs: Date.now() - startedAtMs,
        status: res.status,
        responsePreview: t.slice(0, 800),
      },
      {
        category: "ai_drafts",
        eventType: "openai_draft_request_failed",
        providerId: job.source,
        phase: "generateTailoredDrafts",
        statusKind: "degraded",
      },
    );
    throw new Error(`OpenAI draft HTTP ${res.status}: ${t.slice(0, 800)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI draft empty");

  const parsed = JSON.parse(raw) as {
    cv_html?: string;
    cv_markdown?: string;
    cover_letter?: string;
  };
  let cvDraft = String(parsed.cv_markdown ?? "").trim();
  let cvHtml = String(parsed.cv_html ?? "").trim();
  cvHtml = reapplyCvFormatting(cvHtml, cvHtmlBase);
  cvHtml = applyDefaultCvStyles(cvHtml);
  const coverLetter = String(parsed.cover_letter ?? "");
  if (!cvDraft && cvHtml) {
    cvDraft = cvHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16000);
  }
  if (!cvDraft && !cvHtml) {
    throw new Error("OpenAI draft missing cv_html and cv_markdown");
  }
  observabilityLog(
    "debug",
    "drafts",
    "Draft generation request completed",
    {
      ...requestMeta,
      durationMs: Date.now() - startedAtMs,
      coverLetterLength: coverLetter.length,
      cvHtmlLength: cvHtml.length,
    },
    {
      category: "ai_drafts",
      eventType: "openai_draft_request_completed",
      providerId: job.source,
      phase: "generateTailoredDrafts",
      statusKind: "ok",
    },
  );
  await log.verbose(env, "drafts", "Generate drafts done", {
    title: job.title,
    coverLen: coverLetter.length,
    cvHtmlLen: cvHtml.length,
  });
  return { cvDraft, cvHtml, coverLetter, referenceCvHtml: cvHtmlBase };
}
