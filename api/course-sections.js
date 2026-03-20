import { courseSectionsResponse, handleApiError } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    try {
      return await courseSectionsResponse(new URL(request.url));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
