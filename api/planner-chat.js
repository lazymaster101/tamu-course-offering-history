import { chatWithDegreePlanner } from "../lib/openai-planner.mjs";
import { resolveRequestUrl } from "./request-url.js";

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
      const result = await chatWithDegreePlanner({
        plannerState: payload?.plannerState,
        question: payload?.question,
        previousResponseId: payload?.previousResponseId,
        requestOrigin: resolveRequestUrl(request).origin
      });

      return Response.json(result, {
        status: 200,
        headers: {
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      return Response.json(
        {
          error: error.message || "Unknown planner-chat error."
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
};
