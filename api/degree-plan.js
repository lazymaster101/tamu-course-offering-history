import { getDegreePlan, listDegreePlans } from "../lib/degree-planner-data.mjs";
import { resolveRequestUrl } from "./request-url.js";

console.log("[degree-plan] module initialized");

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request) {
    const startedAt = Date.now();

    console.log("[degree-plan] request start", {
      method: request?.method ?? "GET",
      rawUrl: String(request?.url ?? ""),
      host: request?.headers?.get?.("host") || null,
      forwardedHost: request?.headers?.get?.("x-forwarded-host") || null,
      forwardedProto: request?.headers?.get?.("x-forwarded-proto") || null
    });

    try {
      const url = resolveRequestUrl(request);
      const planId = url.searchParams.get("plan")?.trim() || "bs-cs-2025";

      console.log("[degree-plan] resolved request", {
        href: url.href,
        planId
      });

      const plans = listDegreePlans();
      console.log("[degree-plan] listDegreePlans complete", {
        planCount: plans.length,
        elapsedMs: Date.now() - startedAt
      });

      const plan = getDegreePlan(planId);
      console.log("[degree-plan] getDegreePlan complete", {
        planId: plan.id,
        nodeCount: Array.isArray(plan.graphNodes) ? plan.graphNodes.length : 0,
        elapsedMs: Date.now() - startedAt
      });

      console.log("[degree-plan] response ready", {
        elapsedMs: Date.now() - startedAt
      });

      return jsonResponse(200, {
        plans,
        plan
      });
    } catch (error) {
      console.error("[degree-plan] request failed", {
        elapsedMs: Date.now() - startedAt,
        message: error?.message || String(error),
        stack: error?.stack || null
      });
      return jsonResponse(error.statusCode ?? 500, {
        error: error.message || "Unknown degree-plan error."
      });
    }
  }
};
