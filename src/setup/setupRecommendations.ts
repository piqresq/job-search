import {
  DEFAULT_OPENAI_DRAFT_INSTRUCTION,
  DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION,
} from "../pipeline/aiInstructionDefaults";

export type SetupRecommendations = {
  /** ISO2 code of detected home country, e.g. "lv", or null if unknown. */
  detectedCountryIso2: string | null;
  /** Human-readable country name, e.g. "Latvia". */
  detectedCountryName: string | null;
  /** 5–10 suggested tier-1 job-search queries tailored to the CV. */
  suggestedPositions: string[];
  /**
   * Personalised scoring policy that replaces DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION.
   * The contract part is added automatically at compose time — do not include it here.
   */
  scoringPolicy: string;
  /** Personalised drafts instruction that replaces DEFAULT_OPENAI_DRAFT_INSTRUCTION. */
  draftsInstruction: string;
};

export const DEFAULT_SETUP_ANALYSIS_PROMPT = `You are a job-search setup assistant. Given an anonymized CV text, produce a JSON object matching the exact contract below. Output valid JSON only — no prose, no markdown fences.

JSON contract:
{
  "detectedCountryIso2": string | null,      // ISO-3166-1 alpha-2, lowercase (e.g. "lv"), or null
  "detectedCountryName": string | null,       // full English name (e.g. "Latvia"), or null
  "suggestedPositions": string[],             // 5–10 concise job-search query strings tailored to this CV
  "scoringPolicy": string,                    // full replacement for the editable scoring policy section (see instructions below)
  "draftsInstruction": string                 // full replacement for the draft generation instruction (see instructions below)
}

Rules for suggestedPositions:
- Between 5 and 10 items.
- Each item is a short, specific job-search query (e.g. "Customer Success Manager SaaS", "Technical Account Manager B2B", "Implementation Consultant").
- Reflect the candidate's actual experience, seniority, and strongest fit areas.
- Do not invent experience the CV does not support.

Rules for scoringPolicy:
- Model it on the style and structure of the reference scoring policy provided in the user message.
- Personalise EVERY section (candidate profile, target fit areas, salary preferences, languages, location, role family weighting, etc.) to match this specific candidate.
- Keep all structural headings and rules from the reference — only change the content to match this candidate.
- Do NOT include the backend contract section (JSON schema, workplace_type rules, salary extraction rules, thresholds). It is added separately.
- The output must be a standalone plain-text policy section.

Rules for draftsInstruction:
- Model it on the style and structure of the reference draft instruction provided in the user message.
- Personalise candidate-specific parts (summary positioning, cover letter opening, relevant strengths) to match this CV.
- Keep all structural rules (HARD CONSTRAINTS, SECTION PRESERVATION, TYPOGRAPHIC FIDELITY, etc.) verbatim — only personalise the strategic guidance.
- The output must be a complete, standalone instruction string.`;

export async function analyzeCvForSetup(
  env: { OPENAI_API_KEY: string },
  cvText: string,
  systemPromptOverride?: string | null,
): Promise<SetupRecommendations> {
  const systemPrompt = systemPromptOverride?.trim() || DEFAULT_SETUP_ANALYSIS_PROMPT;
  const userMessage = `CV text:\n${cvText}\n\n---\nReference scoring policy (for structural guidance only — personalise for this candidate):\n${DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION}\n\n---\nReference draft instruction (for structural guidance only — personalise for this candidate):\n${DEFAULT_OPENAI_DRAFT_INSTRUCTION}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      reasoning_effort: "xhigh",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI setup analysis failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content ?? "";
  let parsed: SetupRecommendations;
  try {
    parsed = JSON.parse(raw) as SetupRecommendations;
  } catch {
    throw new Error(`OpenAI setup analysis returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  // Validate and sanitise the parsed output.
  if (!Array.isArray(parsed.suggestedPositions) || parsed.suggestedPositions.length === 0) {
    throw new Error("OpenAI setup analysis returned no suggestedPositions");
  }

  return {
    detectedCountryIso2: typeof parsed.detectedCountryIso2 === "string" ? parsed.detectedCountryIso2.toLowerCase() : null,
    detectedCountryName: typeof parsed.detectedCountryName === "string" ? parsed.detectedCountryName : null,
    suggestedPositions: parsed.suggestedPositions.slice(0, 10).map((s) => String(s).trim()).filter(Boolean),
    scoringPolicy: typeof parsed.scoringPolicy === "string" && parsed.scoringPolicy.trim() ? parsed.scoringPolicy.trim() : DEFAULT_OPENAI_SCORING_POLICY_INSTRUCTION,
    draftsInstruction: typeof parsed.draftsInstruction === "string" && parsed.draftsInstruction.trim() ? parsed.draftsInstruction.trim() : DEFAULT_OPENAI_DRAFT_INSTRUCTION,
  };
}
