import { handleApiError, syllabusPdfResponse } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    try {
      return await syllabusPdfResponse(new URL(request.url));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
