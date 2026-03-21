import { handleApiError, openSyllabusResponse } from "../lib/vercel-api.mjs";
import { resolveRequestUrl } from "./request-url.js";

export default {
  async fetch(request) {
    try {
      return await openSyllabusResponse(resolveRequestUrl(request));
    } catch (error) {
      return handleApiError(error);
    }
  }
};
