import { compareSyllabiResponse, handleApiError } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    try {
      return await compareSyllabiResponse(request, new URL(request.url));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
