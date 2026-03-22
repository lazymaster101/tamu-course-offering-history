import { handleApiError } from "../lib/vercel-api.mjs";
import { buildScheduleRecommendation } from "../lib/schedule-builder.mjs";

async function readJsonRequestBody(request) {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

export default {
  async fetch(request) {
    try {
      if (request.method !== "POST") {
        return Response.json(
          {
            error: "Method Not Allowed"
          },
          {
            status: 405,
            headers: {
              "cache-control": "no-store"
            }
          }
        );
      }

      const payload = await readJsonRequestBody(request);
      const result = await buildScheduleRecommendation({
        planCourses: payload?.planCourses,
        compareSources: payload?.compareSources,
        campus: payload?.campus,
        requestedTermCode: payload?.termCode
      });

      return Response.json(result, {
        status: 200,
        headers: {
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
};
