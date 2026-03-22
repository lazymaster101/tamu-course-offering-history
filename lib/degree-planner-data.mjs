import { readFileSync } from "node:fs";

const DEGREE_PLAN_DATA_URL = new URL("../data/degree-plans.json", import.meta.url);

let cachedPayload = null;

console.log("[degree-plan-data] module initialized", {
  dataUrl: DEGREE_PLAN_DATA_URL.href
});

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadDegreePlanPayload() {
  if (cachedPayload) {
    console.log("[degree-plan-data] cache hit", {
      planCount: cachedPayload.plans.length
    });
    return cachedPayload;
  }

  const startedAt = Date.now();
  console.log("[degree-plan-data] reading file", {
    dataUrl: DEGREE_PLAN_DATA_URL.href
  });

  const rawText = readFileSync(DEGREE_PLAN_DATA_URL, "utf8");
  console.log("[degree-plan-data] file read complete", {
    bytes: rawText.length,
    elapsedMs: Date.now() - startedAt
  });

  const parsed = JSON.parse(rawText);
  const plans = Array.isArray(parsed?.plans) ? parsed.plans : [];

  cachedPayload = {
    plans
  };

  console.log("[degree-plan-data] payload cached", {
    planCount: plans.length,
    elapsedMs: Date.now() - startedAt
  });

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
