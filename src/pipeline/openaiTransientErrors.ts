/**
 * Classifies OpenAI scoring failures for retry and circuit-breaker logic.
 * Cloudflare Workers often surface transport issues as "Network connection lost" or fetch failures.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function isOpenAiQuotaExhaustedError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  return (
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("check your plan and billing details")
  );
}

/**
 * Non-row-specific request/configuration bugs that retries will not fix and should stop extraction.
 * Historical examples:
 * - model option mismatch (`temperature` unsupported for the selected model)
 * - malformed request body emitted by a bad deploy
 */
export function isOpenAiSystemicConfigurationError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  return (
    (msg.includes("unsupported value") && msg.includes("temperature")) ||
    msg.includes("does not support 0.3 with this model") ||
    msg.includes("could not parse the json body of your request") ||
    (msg.includes("invalid_request_error") && msg.includes("json body")) ||
    (msg.includes("expects a json payload") && msg.includes("not valid json"))
  );
}

/**
 * True → caller may retry the HTTP request (up to the configured attempt cap).
 *
 * Covers the full 5xx range (including Cloudflare-origin 520–527 that OpenAI's edge
 * occasionally surfaces) — the old list of 502/503/504 missed a real incident on
 * 2026-04-22 09:31 UTC where a single HTTP 520 bubbled up to the chunk error summary
 * because it wasn't classified as transient and therefore wasn't retried.
 */
export function isTransientOpenAiScoringError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  if (msg.includes("openai http 429")) return !isOpenAiQuotaExhaustedError(e);
  const fiveXxMatch = /openai http (5\d{2})/.exec(msg);
  if (fiveXxMatch) {
    // All 5xx are transient from the client's perspective (server-side/edge issue). 501
    // (Not Implemented) is the only arguable exception but we'd rather retry-then-fail
    // than silently drop a scoring attempt.
    return true;
  }
  if (msg.includes("openai http 4")) return false;
  if (
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("lost") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("socket") ||
    msg.includes("dns") ||
    msg.includes("tls")
  ) {
    return true;
  }
  return false;
}

/**
 * Counts toward "repeated network-style failures" for auto-disabling API extraction.
 * Slightly broader than transient retry (includes 5xx after body read).
 */
export function isOpenAiNetworkOutageStyleFailure(e: unknown): boolean {
  if (isOpenAiQuotaExhaustedError(e)) return false;
  if (isTransientOpenAiScoringError(e)) return true;
  const msg = errorMessage(e).toLowerCase();
  return msg.includes("openai http 5");
}
