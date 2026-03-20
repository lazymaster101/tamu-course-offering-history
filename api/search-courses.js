import { handleApiError, searchCoursesResponse } from "../lib/vercel-api.mjs";

export default {
  async fetch(request) {
    try {
      return await searchCoursesResponse(new URL(request.url));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
