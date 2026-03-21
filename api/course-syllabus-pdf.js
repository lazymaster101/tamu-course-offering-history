import { handleApiError, syllabusPdfResponse } from "../lib/vercel-api.mjs";
import { resolveRequestUrl } from "./request-url.js";

export default {
  async fetch(request) {
    try {
      return await syllabusPdfResponse(resolveRequestUrl(request));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
