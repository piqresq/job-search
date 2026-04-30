# Backlog (future work)

Items here are future enhancements, not already-shipped baseline behavior.

## Queue / Durable Object follow-ups

Baseline long-running orchestration is now implemented with:

- **`PIPELINE_COORDINATOR` Durable Object** for logical cycle ownership, provider-level round robin, pause/resume, and 24h sleep/wake.
- **`PIPELINE_QUEUE`** for bounded provider-chunk execution across wall-clock time.
- **Chunk-aware providers** that report `more` / `doneForCycle` / `nextEligibleAt`.

Future follow-ups worth considering:

- Add a **dashboard status panel** for coordinator state (`running`, `paused`, `sleeping`, wake time, current provider, last error).
- Add **dead-letter / retry tuning** and richer backoff policy per provider, especially for flaky upstream vendor errors.
- Remove or migrate now-legacy one-shot LinkedIn caps (`LINKEDIN_MAX_*_PER_RUN`) if they are no longer needed in production.
- Consider **separate job-processing messages** if a single provider page ever becomes too heavy for one queue consumer invocation.
- Optional **claim lease** on the coordinator (`/claim` sets an in-flight token or timestamp) so at-least-once queue redelivery cannot run the same `(cycleId, seq)` twice while a first consumer is still between claim and `/report`.
