import { readFileSync } from "node:fs";

const DEGREE_PLAN_DATA_URL = new URL("../data/degree-plans.json", import.meta.url);

let cachedPayload = null;

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadDegreePlanPayload() {
  if (cachedPayload) {
    return cachedPayload;
  }

  const rawText = readFileSync(DEGREE_PLAN_DATA_URL, "utf8");
  const parsed = JSON.parse(rawText);
  const plans = Array.isArray(parsed?.plans) ? parsed.plans : [];

  cachedPayload = {
    plans
  };

  return cachedPayload;
}

export function listDegreePlans() {
  return loadDegreePlanPayload().plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    title: plan.title,
    catalog: plan.catalog
  }));
}

export function getDegreePlan(planId = "bs-cs-2025") {
  const plan = loadDegreePlanPayload().plans.find((entry) => entry?.id === planId);

  if (!plan) {
    const error = new Error(`Unknown degree plan: ${planId}`);
    error.statusCode = 404;
    throw error;
  }

  return clonePlainData(plan);
}
