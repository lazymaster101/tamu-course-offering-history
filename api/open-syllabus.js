import { handleApiError, openSyllabusResponse } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    try {
      return await openSyllabusResponse(new URL(request.url));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
