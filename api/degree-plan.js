import { getDegreePlan, listDegreePlans } from "../lib/degree-planner-data.mjs";

export default async function handler(request) {
  const url = new URL(request.url);
  const planId = url.searchParams.get("plan")?.trim() || "bs-cs-2025";

  try {
    return Response.json(
      {
        plans: listDegreePlans(),
        plan: getDegreePlan(planId)
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    return Response.json(
      {
        error: error.message || "Unknown degree-plan error."
      },
      {
        status: error.statusCode ?? 500,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }
}
