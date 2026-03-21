import { getDegreePlan, listDegreePlans } from "../lib/degree-planner-data.mjs";
import { resolveRequestUrl } from "./request-url.js";

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export default async function handler(request) {
  const url = resolveRequestUrl(request);
  const planId = url.searchParams.get("plan")?.trim() || "bs-cs-2025";

  try {
    return jsonResponse(200, {
      plans: listDegreePlans(),
      plan: getDegreePlan(planId)
    });
  } catch (error) {
    console.error("[degree-plan]", error);
    return jsonResponse(error.statusCode ?? 500, {
      error: error.message || "Unknown degree-plan error."
    });
  }
}
