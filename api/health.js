import { handleApiError, healthResponse } from "../lib/vercel-api.mjs";

export default {
  async fetch() {
    try {
      return healthResponse();
    } catch (error) {
      return handleApiError(error);
    }
  }
};
