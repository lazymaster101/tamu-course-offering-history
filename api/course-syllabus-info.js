import { handleApiError, syllabusInfoResponse } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    try {
      return await syllabusInfoResponse(new URL(request.url));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
