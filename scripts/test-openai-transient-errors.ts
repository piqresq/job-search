import assert from "node:assert/strict";
import {
  isOpenAiNetworkOutageStyleFailure,
  isOpenAiQuotaExhaustedError,
  isTransientOpenAiScoringError,
} from "../src/pipeline/openaiTransientErrors";

const quotaError = new Error(
  'OpenAI HTTP 429: {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}',
);
assert.equal(isOpenAiQuotaExhaustedError(quotaError), true);
assert.equal(isTransientOpenAiScoringError(quotaError), false);
assert.equal(isOpenAiNetworkOutageStyleFailure(quotaError), false);

const rateLimitError = new Error(
  'OpenAI HTTP 429: {"error":{"message":"Rate limit reached for requests","type":"rate_limit_exceeded","code":"rate_limit_exceeded"}}',
);
assert.equal(isOpenAiQuotaExhaustedError(rateLimitError), false);
assert.equal(isTransientOpenAiScoringError(rateLimitError), true);
assert.equal(isOpenAiNetworkOutageStyleFailure(rateLimitError), true);

const timeoutError = new Error("OpenAI request timed out after 300000ms");
assert.equal(isTransientOpenAiScoringError(timeoutError), true);
assert.equal(isOpenAiNetworkOutageStyleFailure(timeoutError), true);

const badRequestError = new Error("OpenAI HTTP 400: malformed JSON body");
assert.equal(isOpenAiQuotaExhaustedError(badRequestError), false);
assert.equal(isTransientOpenAiScoringError(badRequestError), false);
assert.equal(isOpenAiNetworkOutageStyleFailure(badRequestError), false);

// 5xx regression (2026-04-22 09:31 UTC). The old classifier only whitelisted 502/503/504
// so a Cloudflare-edge 520 bubbled up to the chunk-error summary without ever being retried.
for (const status of [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529]) {
  const err = new Error(`OpenAI HTTP ${status}: error code: ${status}`);
  assert.equal(
    isTransientOpenAiScoringError(err),
    true,
    `expected HTTP ${status} to be transient`,
  );
  assert.equal(
    isOpenAiNetworkOutageStyleFailure(err),
    true,
    `expected HTTP ${status} to count as outage-style`,
  );
}

// Client-side 4xx (non-429) stays non-transient even if the body looks scary.
const notFoundError = new Error("OpenAI HTTP 404: {\"error\":\"model not found\"}");
assert.equal(isTransientOpenAiScoringError(notFoundError), false);

console.log("test-openai-transient-errors: ok");
