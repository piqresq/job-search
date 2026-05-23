/**
 * Generic retry-with-backoff helper.
 *
 * - Default: **6** invocation attempts (**1 initial + 5 retries** via `DELAYS_MS`).
 * - Fixed delays between attempts: 200 → 400 → 800 → 1600 → 3200 ms.
 * - Each attempt is raced against a per-attempt timeout (default 10 s).
 * - Timeouts are always retryable.
 * - A `classify` function determines whether an error from the operation is
 *   "retryable" (try again) or "fatal" (throw immediately).
 */

export type RetryClass = "retryable" | "fatal";
export type Classifier = (err: unknown) => RetryClass;

const DELAYS_MS = [200, 400, 800, 1600, 3200];

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  op: () => Promise<T>,
  opts: {
    name: string;
    classify: Classifier;
    /** Per-attempt timeout in ms. Default: 10 000. */
    timeoutMs?: number;
    /** Called after each failed attempt before the next delay. */
    onAttempt?: (attempt: number, err: unknown) => void;
    /**
     * How many times to invoke `op()` (default **6**, matching 1 attempt + 5 retries).
     * Pass **1** to disable backoff retries (still uses the per-attempt `timeoutMs` race).
     */
    maxAttempts?: number;
  },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DELAYS_MS.length + 1);
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await withTimeout(op(), timeoutMs);
    } catch (err) {
      lastErr = err;
      const cls = err instanceof TimeoutError ? "retryable" : opts.classify(err);
      opts.onAttempt?.(attempt, err);

      if (cls === "fatal") {
        throw err;
      }
      if (attempt < maxAttempts - 1) {
        const delayMs = DELAYS_MS[attempt] ?? DELAYS_MS[DELAYS_MS.length - 1];
        await sleep(delayMs);
      }
    }
  }

  throw lastErr;
}

/**
 * Pre-built classifier: treat everything as retryable.
 * Use for simple network operations where any error is worth retrying.
 */
export function classifyAllRetryable(_err: unknown): RetryClass {
  return "retryable";
}

/**
 * Pre-built classifier for Puppeteer/network errors:
 * - TimeoutError, ProtocolError, Target closed, net:: errors → retryable
 * - Everything else → retryable (Puppeteer is mostly transient failures)
 */
export function classifyPuppeteerError(_err: unknown): RetryClass {
  return "retryable";
}
