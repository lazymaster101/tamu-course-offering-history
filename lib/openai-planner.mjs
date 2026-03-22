import { compareSyllabi } from "./openai-compare.mjs";

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue == null || String(rawValue).trim() === "") {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(rawValue).trim(), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_PLANNER_MODEL = process.env.OPENAI_PLANNER_MODEL ?? process.env.OPENAI_COMPARE_MODEL ?? "gpt-5-mini";
const OPENAI_PLANNER_TIMEOUT_MS = readPositiveIntegerEnv("OPENAI_PLANNER_TIMEOUT_MS", 120000);

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function ensureOpenAiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw createError("Missing OPENAI_API_KEY environment variable.", 500);
  }
}

function normalizeQuestion(question) {
  const trimmed = String(question ?? "").trim();
  return trimmed || "Build the next semester plan based on this transcript and degree state.";
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const pieces = [];

  for (const outputItem of payload.output ?? []) {
    if (outputItem.type !== "message") {
      continue;
    }

    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && contentItem.text) {
        pieces.push(contentItem.text);
      }
    }
  }

  return pieces.join("\n\n").trim();
}

function normalizeCourseCodeToken(token) {
  const match = String(token ?? "").toUpperCase().match(/\b([A-Z]{3,5})\s*(\d{3}[A-Z]?)\b/);
  return match ? `${match[1]} ${match[2]}` : null;
}

function questionNeedsSyllabusComparison(question) {
  return /\b(prof|professor|instructor|syllabus|section|compare|best fit|best prof|best professor)\b/iu.test(
    String(question ?? "")
  );
}

function buildEligibleActionSet(plannerState) {
  const allowed = new Set();

  for (const course of plannerState?.eligibleRequiredCourses ?? []) {
    if (course?.code) {
      allowed.add(course.code);
    }
    for (const option of course?.options ?? []) {
      const normalized = normalizeCourseCodeToken(option);
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  for (const course of plannerState?.trackedElectiveSuggestions ?? []) {
    if (course?.code) {
      allowed.add(course.code);
    }
  }

  for (const course of plannerState?.fastTrackOptions ?? []) {
    if ((course?.state === "eligible" || course?.state === "candidate") && course?.graduateCode) {
      allowed.add(course.graduateCode);
    }
  }

  return allowed;
}

function extractPlannerActions(answer, plannerState) {
  const normalizedAnswer = String(answer ?? "").trim();
  const match = normalizedAnswer.match(/(?:^|\n)ADD_TO_GRAPH:\s*(.+)$/im);
  if (!match) {
    return {
      answer: normalizedAnswer,
      addToGraphCodes: []
    };
  }

  const rawAction = match[1].trim();
  const cleanedAnswer = normalizedAnswer.replace(/\n?ADD_TO_GRAPH:\s*.+$/im, "").trim();
  if (!rawAction || /^none$/i.test(rawAction)) {
    return {
      answer: cleanedAnswer,
      addToGraphCodes: []
    };
  }

  const allowed = buildEligibleActionSet(plannerState);
  const addToGraphCodes = [...new Set(
    rawAction
      .split(/[,\n]/)
      .map((token) => normalizeCourseCodeToken(token))
      .filter((code) => code && allowed.has(code))
  )];

  return {
    answer: cleanedAnswer,
    addToGraphCodes
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw createError(
        `The planner model timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        504
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiResponses(payload) {
  ensureOpenAiKey();

  const response = await fetchWithTimeout(
    `${OPENAI_API_BASE_URL}/responses`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json",
        "user-agent": "tamu-degree-planner/1.0"
      },
      body: JSON.stringify(payload)
    },
    OPENAI_PLANNER_TIMEOUT_MS
  );

  const responseText = await response.text();
  let parsedBody = null;

  try {
    parsedBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    const errorMessage =
      parsedBody?.error?.message ??
      parsedBody?.message ??
      responseText.slice(0, 400) ??
      "OpenAI planner request failed.";
    throw createError(errorMessage, response.status);
  }

  return parsedBody;
}

function buildPlannerContext(plannerState) {
  return JSON.stringify(plannerState, null, 2);
}

function getShortlistCourseCode(source) {
  return (
    normalizeCourseCodeToken(`${source?.subject ?? ""} ${source?.courseNumber ?? ""}`) ||
    normalizeCourseCodeToken(source?.label ?? "")
  );
}

function buildRelevantShortlistGroups(plannerState) {
  const relevantCodes = new Set(
    [
      ...(plannerState?.plannedCourses ?? []).map((course) => course?.code),
      ...(
        plannerState?.scheduleRecommendation?.sections ?? []
      ).map((section) => section?.courseCode)
    ]
      .map((code) => normalizeCourseCodeToken(code))
      .filter(Boolean)
  );

  const groups = new Map();

  for (const source of plannerState?.shortlistSources ?? []) {
    const courseCode = getShortlistCourseCode(source);
    if (!courseCode) {
      continue;
    }

    if (relevantCodes.size > 0 && !relevantCodes.has(courseCode)) {
      continue;
    }

    if (!groups.has(courseCode)) {
      groups.set(courseCode, []);
    }

    groups.get(courseCode).push(source);
  }

  return [...groups.entries()]
    .map(([courseCode, sources]) => ({
      courseCode,
      sources
    }))
    .sort((left, right) => left.courseCode.localeCompare(right.courseCode));
}

async function buildSyllabusComparisonContext(plannerState, question, requestOrigin) {
  if (!questionNeedsSyllabusComparison(question)) {
    return [];
  }

  const groups = buildRelevantShortlistGroups(plannerState).slice(0, 2);
  if (!groups.length) {
    return [];
  }

  const comparisonSummaries = [];

  for (const group of groups) {
    if (group.sources.length < 2) {
      comparisonSummaries.push({
        courseCode: group.courseCode,
        comparedSourceCount: group.sources.length,
        sourceLabels: group.sources.map((source) => source.label).filter(Boolean),
        summary:
          `Only one shortlisted syllabus source is available for ${group.courseCode}, so no multi-syllabus comparison could be run.`
      });
      continue;
    }

    try {
      const result = await compareSyllabi({
        items: group.sources.slice(0, 4).map((source) => ({
          sourceType: "url",
          url: source.url,
          label: source.label
        })),
        question:
          `For ${group.courseCode}, compare these shortlisted syllabi and identify which instructor seems like the best fit for this student request: ${question}. Focus on workload, grading strictness, late work flexibility, attendance burden, exams, projects, and overall manageability. Keep the recommendation concise and end with a line formatted exactly as RECOMMENDED INSTRUCTOR: name or none.`,
        requestOrigin
      });

      comparisonSummaries.push({
        courseCode: group.courseCode,
        comparedSourceCount: group.sources.length,
        sourceLabels: group.sources.map((source) => source.label).filter(Boolean),
        summary: result.answer
      });
    } catch (error) {
      comparisonSummaries.push({
        courseCode: group.courseCode,
        comparedSourceCount: group.sources.length,
        sourceLabels: group.sources.map((source) => source.label).filter(Boolean),
        summary: `Shortlisted syllabus comparison for ${group.courseCode} could not be completed: ${error.message}`
      });
    }
  }

  return comparisonSummaries;
}

function buildPlannerInstructions() {
  return [
    "You are a TAMU CS degree-planning assistant.",
    "Base your answer only on the provided degree-plan state, transcript summary, prerequisite state, and fast-track rules.",
    "If the planner state includes a scheduleRecommendation, treat it as the current real schedule candidate built from live public class-search sections and professor shortlist preferences.",
    "If syllabusComparisons are present in the planner state, treat them as grounded syllabus evidence and use them when recommending instructors or critiquing the schedule.",
    "Do not invent eligibility, GPA rules, or course requirements that are not present in the provided state.",
    "If a requirement is advisor-reviewed or only partially verified, say that explicitly.",
    "When recommending a next semester, prefer a balanced workload and call out prerequisite bottlenecks.",
    "If a scheduleRecommendation exists, explain why it is or is not a good fit and mention any unscheduled or unavailable classes explicitly.",
    "If syllabusComparisons exist, name the best-fit instructor for each compared course when the evidence is clear and say when the shortlist evidence is insufficient.",
    "If fast-track looks possible, state the exact GPA threshold and mention that placement is not guaranteed.",
    "Keep the answer structured with these headings when useful: NEXT TERM, WHY, RISKS, FAST TRACK, ACTION ITEMS.",
    "Use short bullets under each heading.",
    "At the very end of every answer, add exactly one line in this format: ADD_TO_GRAPH: course1, course2",
    "Only include course codes that should be added to the student's graph right now from the provided eligible options.",
    "If you do not want to add any courses, write: ADD_TO_GRAPH: none"
  ].join(" ");
}

export async function chatWithDegreePlanner({
  plannerState,
  question,
  previousResponseId,
  requestOrigin
}) {
  if (!plannerState || typeof plannerState !== "object") {
    throw createError("Missing planner state.", 400);
  }

  const normalizedQuestion = normalizeQuestion(question);
  const syllabusComparisons = await buildSyllabusComparisonContext(
    plannerState,
    normalizedQuestion,
    requestOrigin
  );
  const effectivePlannerState =
    syllabusComparisons.length > 0
      ? {
          ...plannerState,
          syllabusComparisons
        }
      : plannerState;
  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: buildPlannerInstructions()
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Planner state:\n${buildPlannerContext(effectivePlannerState)}\n\nUser question:\n${normalizedQuestion}`
        }
      ]
    }
  ];

  const payload = {
    model: OPENAI_PLANNER_MODEL,
    input
  };

  if (previousResponseId) {
    payload.previous_response_id = previousResponseId;
  }

  const openAiResponse = await callOpenAiResponses(payload);
  const rawAnswer = extractResponseText(openAiResponse);
  const { answer, addToGraphCodes } = extractPlannerActions(rawAnswer, plannerState);

  return {
    answer,
    addToGraphCodes,
    model: openAiResponse.model ?? OPENAI_PLANNER_MODEL,
    responseId: openAiResponse.id ?? null
  };
}
