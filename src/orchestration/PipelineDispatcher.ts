import { DurableObject } from "cloudflare:workers";
import { listActiveUserIds } from "../db/users";
import { log, observabilityLog } from "../logging/appLog";
import { startOrResumeCoordinator } from "./client";

/**
 * Singleton Durable Object that fans out the cron poke to all active users.
 * One DO, one stub per user coordinator. Uses Promise.allSettled so one
 * user's failure never blocks the others.
 *
 * Exposes a single route: POST /poke
 */
export class PipelineDispatcher extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/poke") {
      return this.handlePoke(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handlePoke(request: Request): Promise<Response> {
    const body = await request.json<{ reason?: string }>().catch(() => ({}));
    const reason = (body as { reason?: string }).reason ?? "scheduled";
    const now = Math.floor(Date.now() / 1000);

    let userIds: string[];
    try {
      userIds = await listActiveUserIds(this.env.DB);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log.critical(
        this.env,
        "dispatcher",
        "PipelineDispatcher failed to list active users",
        { error: msg.slice(0, 500) },
        {
          category: "orchestration",
          eventType: "dispatcher_list_users_failed",
          phase: "poke",
          statusKind: "failed",
        },
      );
      return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 500) }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (userIds.length === 0) {
      observabilityLog("debug", "dispatcher", "PipelineDispatcher: no active users, nothing to do", {}, {
        category: "orchestration",
        eventType: "dispatcher_no_active_users",
        phase: "poke",
        statusKind: "sleeping",
      });
      return new Response(JSON.stringify({ ok: true, dispatched: 0, errors: [] }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const results = await Promise.allSettled(
      userIds.map((userId) =>
        startOrResumeCoordinator(this.env, userId, { reason }).then((r) => ({ userId, result: r })),
      ),
    );

    const dispatched: string[] = [];
    const errors: { userId: string; error: string }[] = [];

    for (const res of results) {
      if (res.status === "fulfilled") {
        dispatched.push(res.value.userId);
      } else {
        const userId = userIds[results.indexOf(res)]!;
        const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
        errors.push({ userId, error: msg.slice(0, 400) });
        await log.moderate(
          this.env,
          "dispatcher",
          `PipelineDispatcher failed to start coordinator for user ${userId}`,
          { userId, error: msg.slice(0, 400), reason },
          {
            category: "orchestration",
            eventType: "dispatcher_coordinator_start_failed",
            phase: "poke",
            statusKind: "degraded",
          },
        );
      }
    }

    observabilityLog(
      errors.length > 0 ? "warn" : "debug",
      "dispatcher",
      "PipelineDispatcher poke completed",
      {
        reason,
        totalUsers: userIds.length,
        dispatched: dispatched.length,
        errorCount: errors.length,
        durationMs: Date.now() - now * 1000,
      },
      {
        category: "orchestration",
        eventType: "dispatcher_poke_completed",
        phase: "poke",
        statusKind: errors.length > 0 ? "degraded" : "ok",
      },
    );

    return new Response(
      JSON.stringify({ ok: true, dispatched: dispatched.length, errors }),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
}
