import { startSavedCourseBadgeSync } from "./page-shell.js";
import {
  getCompareSources,
  subscribeToCompareSources
} from "./compare-sources.js";
import {
  formatSavedCourseCode,
  getSavedCourses,
  hasFavoriteSchedule,
  removeCourse,
  removeFavoriteSchedule,
  saveCourse,
  saveFavoriteSchedule,
  subscribeToSavedCourses
} from "./saved-courses.js";
import { evaluatePlannerState } from "./planner-engine.js";
import { normalizeCourseCode } from "./planner-transcript-parser.js";
import { parseTranscriptFile } from "./planner-transcript.js";

const DEFAULT_PLANNER_QUESTION =
  "Build the best next semester plan for me, explain why, call out any blockers, and mention whether fast track looks realistic.";
const PLANNER_STORAGE_KEY = "tamu-degree-planner-state-v1";
const SCHEDULE_DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const SCHEDULE_CARD_TONES = ["tone-maroon", "tone-blue", "tone-gold", "tone-rose", "tone-green", "tone-plum"];

const state = {
  plan: null,
  transcriptMeta: null,
  transcriptCourses: [],
  evaluation: null,
  cart: [],
  pendingParsedTranscript: null,
  selectedNodeId: null,
  hoveredNodeId: null,
  graphLayout: null,
  graphRenderNodes: [],
  renderGraphEdges: [],
  graphPanX: 96,
  graphPanY: 72,
  graphScale: 1,
  graphInitialPanX: 96,
  graphInitialPanY: 72,
  graphInitialScale: 1,
  graphPanInitialized: false,
  graphPointerId: null,
  graphPointerMoved: false,
  graphDragOrigin: null,
  nodeDetailPosition: null,
  nodeDetailPointerId: null,
  nodeDetailDragOffsetX: 0,
  nodeDetailDragOffsetY: 0,
  manualCourseContext: null,
  plannerMessages: [],
  previousResponseId: null,
  plannerRequestInFlight: false,
  scheduleRecommendation: null,
  selectedScheduleId: null,
  scheduleRequestInFlight: false,
  scheduleFingerprint: null,
  transcriptRailHidden: false,
  assistantRailHidden: false
};

const elements = {
  degreeSelect: document.querySelector("#planner-degree-select"),
  transcriptFile: document.querySelector("#planner-transcript-file"),
  ingestState: document.querySelector("#planner-ingest-state"),
  transcriptSummary: document.querySelector("#planner-transcript-summary"),
  completedState: document.querySelector("#planner-completed-state"),
  openReviewButton: document.querySelector("#planner-open-review"),
  openManualButton: document.querySelector("#planner-open-manual"),
  completedList: document.querySelector("#planner-completed-list"),
  inProgressList: document.querySelector("#planner-inprogress-list"),
  manualCourseForm: document.querySelector("#planner-manual-course-form"),
  summaryGrid: document.querySelector("#planner-summary-grid"),
  graphEmpty: document.querySelector("#planner-graph-empty"),
  graphCanvas: document.querySelector("#planner-graph-canvas"),
  graphBubbles: document.querySelector("#planner-graph-bubbles"),
  graphColumns: document.querySelector("#planner-graph-columns"),
  graphEdges: document.querySelector("#planner-graph-edges"),
  zoomOutButton: document.querySelector("#planner-zoom-out"),
  zoomResetButton: document.querySelector("#planner-zoom-reset"),
  zoomInButton: document.querySelector("#planner-zoom-in"),
  zoomHint: document.querySelector("#planner-zoom-hint"),
  nodeDetail: document.querySelector("#planner-node-detail"),
  cartState: document.querySelector("#planner-cart-state"),
  cartList: document.querySelector("#planner-cart-list"),
  requiredSuggestions: document.querySelector("#planner-required-suggestions"),
  electiveSuggestions: document.querySelector("#planner-elective-suggestions"),
  fastTrackSuggestions: document.querySelector("#planner-fasttrack-suggestions"),
  buildScheduleButton: document.querySelector("#planner-build-schedule"),
  scheduleState: document.querySelector("#planner-schedule-state"),
  scheduleResult: document.querySelector("#planner-schedule-result"),
  scheduleTerm: document.querySelector("#planner-schedule-term"),
  scheduleMeta: document.querySelector("#planner-schedule-meta"),
  scheduleOptionTabs: document.querySelector("#planner-schedule-option-tabs"),
  saveScheduleButton: document.querySelector("#planner-save-schedule"),
  scheduleBoard: document.querySelector("#planner-schedule-board"),
  scheduleFlags: document.querySelector("#planner-schedule-flags"),
  scheduleTableBody: document.querySelector("#planner-schedule-table-body"),
  chatState: document.querySelector("#planner-chat-state"),
  chatScroll: document.querySelector("#planner-chat-scroll"),
  chatThread: document.querySelector("#planner-chat-thread"),
  chatForm: document.querySelector("#planner-chat-form"),
  chatQuestion: document.querySelector("#planner-chat-question"),
  chatSubmit: document.querySelector("#planner-chat-submit"),
  chatHelper: document.querySelector("#planner-chat-helper"),
  messageTemplate: document.querySelector("#planner-message-template"),
  requirementModal: document.querySelector("#planner-requirement-modal"),
  requirementModalKicker: document.querySelector("#planner-requirement-kicker"),
  requirementModalTitle: document.querySelector("#planner-requirement-title"),
  requirementModalBody: document.querySelector("#planner-requirement-body"),
  requirementModalClose: document.querySelector("#planner-requirement-close"),
  requirementModalDismiss: document.querySelector("[data-planner-modal-close]"),
  transcriptModal: document.querySelector("#planner-transcript-modal"),
  transcriptModalSummary: document.querySelector("#planner-transcript-modal-summary"),
  transcriptModalList: document.querySelector("#planner-transcript-modal-list"),
  transcriptConfirmButton: document.querySelector("#planner-transcript-confirm"),
  transcriptCancelButton: document.querySelector("#planner-transcript-cancel"),
  reviewModal: document.querySelector("#planner-review-modal"),
  reviewModalClose: document.querySelector("#planner-review-close"),
  reviewModalDismiss: document.querySelector("[data-planner-review-close]"),
  manualModal: document.querySelector("#planner-manual-modal"),
  manualModalClose: document.querySelector("#planner-manual-close"),
  manualModalDismiss: document.querySelector("[data-planner-manual-close]"),
  toggleTranscriptRailButton: document.querySelector("#planner-toggle-transcript-rail"),
  toggleAssistantRailButton: document.querySelector("#planner-toggle-assistant-rail")
};

function readPlannerStorage() {
  try {
    const raw = window.localStorage.getItem(PLANNER_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePlannerStorage() {
  try {
    window.localStorage.setItem(
      PLANNER_STORAGE_KEY,
      JSON.stringify({
        planId: state.plan?.id ?? "bs-cs-2025",
        transcriptMeta: state.transcriptMeta,
        transcriptCourses: state.transcriptCourses,
        cart: state.cart,
        plannerMessages: state.plannerMessages,
        previousResponseId: state.previousResponseId,
        scheduleRecommendation: state.scheduleRecommendation,
        selectedScheduleId: state.selectedScheduleId,
        scheduleFingerprint: state.scheduleFingerprint,
        transcriptRailHidden: state.transcriptRailHidden,
        assistantRailHidden: state.assistantRailHidden
      })
    );
  } catch {
    // Ignore storage failures in the browser.
  }
}

function hydratePlannerStorage(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    syncCartFromSavedPlan();
    return;
  }

  state.transcriptMeta = snapshot.transcriptMeta ?? null;
  state.transcriptCourses = Array.isArray(snapshot.transcriptCourses)
    ? snapshot.transcriptCourses
    : [];
  state.cart = Array.isArray(snapshot.cart) ? snapshot.cart : [];
  state.plannerMessages = Array.isArray(snapshot.plannerMessages)
    ? snapshot.plannerMessages
    : [];
  state.previousResponseId = snapshot.previousResponseId ?? null;
  state.scheduleRecommendation =
    snapshot.scheduleRecommendation && typeof snapshot.scheduleRecommendation === "object"
      ? snapshot.scheduleRecommendation
      : null;
  state.selectedScheduleId = snapshot.selectedScheduleId ?? null;
  state.scheduleFingerprint = snapshot.scheduleFingerprint ?? null;
  state.transcriptRailHidden = Boolean(snapshot.transcriptRailHidden);
  state.assistantRailHidden = Boolean(snapshot.assistantRailHidden);
  syncCartFromSavedPlan();
}

function syncCartFromSavedPlan() {
  let sharedPlan = getSavedCourses("plan");

  if (!sharedPlan.length && state.cart.length) {
    state.cart.forEach((item) => {
      const savedCourse = toSavedPlannerCourse(item.code, item.title);
      if (savedCourse) {
        saveCourse("plan", savedCourse);
      }
    });
    sharedPlan = getSavedCourses("plan");
  }

  const existingByCode = new Map(state.cart.map((item) => [item.code, item]));

  state.cart = sharedPlan.map((course) => {
    const code = formatSavedCourseCode(course);
    const existing = existingByCode.get(code);

    return {
      code,
      title: existing?.title ?? `${code} · ${course.title}`,
      source: existing?.source ?? "semester-plan"
    };
  });
}

function applyPlannerLayoutState() {
  document.body.classList.toggle("planner-hide-transcript-rail", state.transcriptRailHidden);
  document.body.classList.toggle("planner-hide-assistant-rail", state.assistantRailHidden);

  if (elements.toggleTranscriptRailButton) {
    elements.toggleTranscriptRailButton.textContent = state.transcriptRailHidden
      ? "Show transcript rail"
      : "Hide transcript rail";
    elements.toggleTranscriptRailButton.classList.toggle(
      "is-active",
      state.transcriptRailHidden
    );
  }

  if (elements.toggleAssistantRailButton) {
    elements.toggleAssistantRailButton.textContent = state.assistantRailHidden
      ? "Show Planner AI rail"
      : "Hide Planner AI rail";
    elements.toggleAssistantRailButton.classList.toggle(
      "is-active",
      state.assistantRailHidden
    );
  }
}

const VERIFIED_UCC_CATEGORIES = [
  {
    title: "Communication",
    codes: ["ENGL 203", "ENGL 204", "ENGL 210", "COMM 203", "COMM 205"]
  },
  {
    title: "American History",
    codes: ["HIST 105", "HIST 106"]
  },
  {
    title: "Government / Political Science",
    codes: ["POLS 206", "POLS 207"]
  },
  {
    title: "Social and Behavioral Sciences",
    codes: ["ECON 202", "ECON 203", "PSYC 107", "SOCI 205"]
  },
  {
    title: "Language, Philosophy and Culture",
    codes: ["PHIL 111", "PHIL 240"]
  }
];

function setHelper(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function setBusy(button, isBusy, idleLabel, busyLabel) {
  button.disabled = isBusy;
  button.textContent = isBusy ? busyLabel : idleLabel;
}

async function readJsonResponse(response, fallbackMessage) {
  const rawText = await response.text();

  if (!rawText.trim()) {
    if (!response.ok) {
      throw new Error(fallbackMessage || "Request failed.");
    }

    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    if (!response.ok) {
      throw new Error(rawText.trim() || fallbackMessage || "Request failed.");
    }

    throw new Error("Received a non-JSON response from the server.");
  }
}

function questionRequestsSchedule(questionText) {
  return /\b(schedule|timetable|time table|prof|professor|instructor|section|builder)\b/iu.test(
    String(questionText ?? "")
  );
}

function getScheduleFingerprint() {
  const planCodes = state.cart.map((item) => item.code).sort();
  const shortlistIds = getCompareSources()
    .map((source) => String(source.id ?? `${source.termCode ?? ""}:${source.crn ?? ""}:${source.label ?? ""}`))
    .sort();

  return JSON.stringify({
    planCodes,
    shortlistIds
  });
}

function getSelectedScheduleOption() {
  if (!state.scheduleRecommendation?.schedules?.length) {
    return null;
  }

  return (
    state.scheduleRecommendation.schedules.find(
      (schedule) => schedule.id === state.selectedScheduleId
    ) ?? state.scheduleRecommendation.schedules[0]
  );
}

function buildSchedulePayload() {
  return {
    planCourses: state.cart.map((item) => ({
      code: item.code,
      title: item.title
    })),
    compareSources: getCompareSources(),
    campus: "college-station"
  };
}

function buildFavoriteScheduleRecord(schedule) {
  if (!schedule || !state.scheduleRecommendation?.targetTerm) {
    return null;
  }

  return {
    label: `${state.scheduleRecommendation.targetTerm.termDescription ?? "Upcoming term"} schedule`,
    campus: "college-station",
    campusLabel: "College Station",
    termCode: state.scheduleRecommendation.targetTerm.termCode ?? null,
    termDescription: state.scheduleRecommendation.targetTerm.termDescription ?? "Upcoming term",
    optionId: schedule.id ?? null,
    totalCredits: schedule.summary?.totalCredits ?? 0,
    scheduledCourseCount: schedule.summary?.scheduledCourseCount ?? schedule.sections?.length ?? 0,
    requestedCourseCount: schedule.summary?.requestedCourseCount ?? schedule.sections?.length ?? 0,
    sections: schedule.sections ?? []
  };
}

function minuteLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "TBA";
  }

  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function setScheduleBusy(isBusy) {
  state.scheduleRequestInFlight = isBusy;
  elements.buildScheduleButton.disabled = isBusy;
  elements.buildScheduleButton.textContent = isBusy ? "Building..." : "Build schedule";
}

function createBadge(text, extraClass = "") {
  const badge = document.createElement("span");
  badge.className = `planner-mini-badge ${extraClass}`.trim();
  badge.textContent = text;
  return badge;
}

function createTokenList(values, emptyLabel = "None listed") {
  const list = document.createElement("div");
  list.className = "planner-token-list";

  const items = values?.filter(Boolean) ?? [];
  if (!items.length) {
    const token = document.createElement("span");
    token.className = "planner-token planner-token-subtle";
    token.textContent = emptyLabel;
    list.append(token);
    return list;
  }

  items.forEach((value) => {
    const token = document.createElement("span");
    token.className = "planner-token";
    token.textContent = value;
    list.append(token);
  });

  return list;
}

function sanitizePlannerCourseTitle(title, code = "") {
  const normalized = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return code;
  }

  const clipped = normalized
    .split(
      /\b(?:UNOFFICIAL(?:\s+(?:ACADEMIC\s+RECORD|TRANSCRIPT))?|TRANSCRIPT\s+TOTALS|TOTAL\s+INSTITUTION|TOTAL\s+TRANSFER|OVERALL|EARNED\s+HRS|GPA\s+HRS|POINTS|TEXAS\s+A&M\s+UNIVERSITY|COLLEGE\s+STATION\s+TEXAS\s+77843)\b/i
    )[0]
    .trim();

  return clipped || code;
}

function createModalItem(code, meta) {
  const article = document.createElement("article");
  article.className = "planner-modal-item";

  const codeLine = document.createElement("p");
  codeLine.className = "result-code";
  codeLine.textContent = code;

  article.append(codeLine);

  if (meta) {
    const metaLine = document.createElement("p");
    metaLine.className = "planner-modal-item-meta";
    metaLine.textContent = meta;
    article.append(metaLine);
  }

  return article;
}

function createPendingTranscriptFixItem(course) {
  const article = createModalItem(
    course.code,
    `${course.term} · Could not confidently classify · ${course.credits ?? 0} cr`
  );

  const titleLine = document.createElement("p");
  titleLine.className = "planner-modal-item-meta";
  titleLine.textContent = sanitizePlannerCourseTitle(course.title, course.code);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "result-action-button";
  button.textContent = "Fix this course";
  button.addEventListener("click", () => {
    closeTranscriptModal();
    openManualModal({
      mode: "pending-fix",
      course
    });
  });

  article.append(titleLine, button);
  return article;
}

function appendModalSection(container, title, items, emptyMessage = "Nothing to show yet.") {
  const block = document.createElement("section");
  block.className = "planner-modal-section";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = "planner-modal-section-list";

  if (items.length > 0) {
    items.forEach((item) => list.append(item));
  } else {
    list.append(createModalItem(emptyMessage, null));
  }

  block.append(heading, list);
  container.append(block);
}

function normalizeNodeIdFragment(code) {
  return String(code ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function closeReviewModal() {
  elements.reviewModal.hidden = true;
}

function resetManualCourseForm() {
  elements.manualCourseForm.reset();
  elements.manualCourseForm.querySelector("#planner-course-credits").value = "3";
  elements.manualCourseForm.querySelector("#planner-course-status").value = "completed";
}

function seedManualCourseForm(course) {
  if (!course) {
    resetManualCourseForm();
    return;
  }

  elements.manualCourseForm.querySelector("#planner-course-subject").value = course.subject ?? "";
  elements.manualCourseForm.querySelector("#planner-course-number").value = course.number ?? "";
  elements.manualCourseForm.querySelector("#planner-course-title").value = sanitizePlannerCourseTitle(
    course.title,
    course.code
  );
  elements.manualCourseForm.querySelector("#planner-course-credits").value = String(
    Number(course.credits ?? 3) || 3
  );
  elements.manualCourseForm.querySelector("#planner-course-status").value =
    course.status === "in-progress" ? "in-progress" : course.sourceType === "transfer" ? "transfer" : "completed";
}

function openReviewModal() {
  if (!state.transcriptMeta) {
    return;
  }

  elements.reviewModal.hidden = false;
}

function closeManualModal() {
  const shouldReturnToTranscript =
    state.manualCourseContext?.mode === "pending-fix" && Boolean(state.pendingParsedTranscript);
  elements.manualModal.hidden = true;
  state.manualCourseContext = null;
  resetManualCourseForm();
  if (shouldReturnToTranscript) {
    openTranscriptModal(state.pendingParsedTranscript);
  }
}

function openManualModal(context = null) {
  state.manualCourseContext = context;
  seedManualCourseForm(context?.course ?? null);
  elements.manualModal.hidden = false;
}

function getRequiredCoreCategory(node) {
  const codes = [node.code, ...(node.matches ?? [])].filter(Boolean);

  if (codes.some((code) => /^CHEM |^PHYS |^ENGR 216$/.test(code))) {
    return "Life and Physical Sciences";
  }

  if (codes.some((code) => /^ENGL 103$|^ENGL 104$|^ENGL 210$|^COMM 203$|^COMM 205$/.test(code))) {
    return "Communication";
  }

  if (codes.some((code) => /^MATH |^STAT 211$|^STAT 212$/.test(code))) {
    return "Mathematics and Statistics";
  }

  if (codes.some((code) => /^CSCE 399$|^CSCE 481$|^CSCE 482$/.test(code))) {
    return "Graduation Milestones";
  }

  if (codes.some((code) => /^ENGR 102$/.test(code))) {
    return "Engineering Foundation";
  }

  if (codes.some((code) => /^CSCE /.test(code))) {
    return "Computer Science Core";
  }

  return "Other Required Core";
}

function getVerifiedUccCategory(code) {
  return (
    VERIFIED_UCC_CATEGORIES.find((category) => category.codes.includes(code))?.title ??
    "Other Core Curriculum"
  );
}

function getActiveTranscript() {
  if (!state.transcriptMeta) {
    return null;
  }

  const completedCourses = state.transcriptCourses.filter((course) => course.status === "completed");
  const inProgressCourses = state.transcriptCourses.filter((course) => course.status === "in-progress");

  return {
    ...state.transcriptMeta,
    courses: [...state.transcriptCourses],
    completedCourses,
    inProgressCourses,
    completedCourseCodes: [...new Set(completedCourses.map((course) => course.code))],
    inProgressCourseCodes: [...new Set(inProgressCourses.map((course) => course.code))]
  };
}

function getCurrentPlannerPayload() {
  const transcript = getActiveTranscript();
  if (!transcript || !state.plan || !state.evaluation) {
    return null;
  }

  return {
    plan: {
      id: state.plan.id,
      title: state.plan.title,
      catalog: state.plan.catalog
    },
    transcriptSummary: state.evaluation.transcriptSummary,
    completedCourses: transcript.completedCourses.map((course) => ({
      code: course.code,
      title: course.title,
      grade: course.grade,
      credits: course.credits,
      term: course.term
    })),
    inProgressCourses: transcript.inProgressCourses.map((course) => ({
      code: course.code,
      title: course.title,
      credits: course.credits,
      term: course.term
    })),
    plannedCourses: state.cart.map((item) => ({
      code: item.code,
      title: item.title,
      source: item.source
    })),
    shortlistSources: getCompareSources().map((source) => ({
      id: source.id ?? null,
      label: source.label ?? null,
      url: source.url ?? null,
      subject: source.subject ?? null,
      courseNumber: source.courseNumber ?? null,
      termCode: source.termCode ?? null,
      termDescription: source.termDescription ?? null,
      instructorLabel: source.instructorLabel ?? null,
      honorsLabel: source.honorsLabel ?? null,
      sectionsLabel: source.sectionsLabel ?? null
    })),
    flexibleProgress: state.evaluation.flexibleProgress,
    eligibleRequiredCourses: state.evaluation.eligibleRequiredCourses.map((node) => ({
      code: node.code,
      title: node.title,
      missingPrereqs: node.missingPrereqs
    })),
    trackedElectiveSuggestions: state.evaluation.trackedElectiveSuggestions
      .filter((course) => course.state === "eligible" || course.state === "review")
      .slice(0, 18)
      .map((course) => ({
        code: course.code,
        title: course.title,
        track: course.track,
        state: course.state,
        missingPrereqs: course.missingPrereqs,
        advisorReviewRequired: course.advisorReviewRequired
      })),
    fastTrackOptions: state.evaluation.fastTrackOptions
      .filter((course) => course.state === "eligible" || course.state === "candidate")
      .map((course) => ({
        graduateCode: course.graduateCode,
        undergraduateCode: course.undergraduateCode,
        title: course.title,
        state: course.state,
        missingPrereqs: course.missingPrereqs,
        gpaMinimum: course.gpaMinimum,
        overallGpa: course.overallGpa,
        advisorReviewRequired: course.advisorReviewRequired
      })),
    scheduleRecommendation: getSelectedScheduleOption()
      ? {
          termDescription:
            state.scheduleRecommendation?.targetTerm?.termDescription ?? "Upcoming term",
          requestedCourseCount:
            getSelectedScheduleOption().summary.requestedCourseCount,
          scheduledCourseCount:
            getSelectedScheduleOption().summary.scheduledCourseCount,
          totalCredits: getSelectedScheduleOption().summary.totalCredits,
          matchedPreferenceCount:
            getSelectedScheduleOption().summary.matchedPreferenceCount,
          unscheduledCourses: getSelectedScheduleOption().unscheduledCourses,
          sections: getSelectedScheduleOption().sections.map((section) => ({
            courseCode: section.courseCode,
            crn: section.crn,
            section: section.section,
            instructors: section.instructors,
            meetings: section.meetings
          }))
        }
      : null,
    warnings: state.evaluation.warnings
  };
}

function buildChoiceNodeOptions(node) {
  if (node.type !== "choice") {
    return [];
  }

  return (node.options ?? []).map((code) => ({
    code,
    title: code
  }));
}

function getTranscriptCourseMatch(code) {
  return state.transcriptCourses.find((course) => course.code === code) ?? null;
}

function getCourseDefinition(code) {
  if (!state.plan || !code) {
    return null;
  }

  for (const node of state.plan.graphNodes ?? []) {
    if (node.code === code || node.matches?.includes(code)) {
      return {
        code: node.code,
        title: node.title,
        hours: Number(node.hours ?? 0),
        prereqs: [...(node.prereqs ?? [])],
        matches: [...(node.matches ?? [])]
      };
    }
  }

  for (const courses of Object.values(state.plan.trackedElectives ?? {})) {
    const match = courses.find((course) => course.code === code || course.matches?.includes(code));
    if (match) {
      return {
        code: match.code,
        title: match.title,
        hours: Number(match.hours ?? 0),
        prereqs: [...(match.prereqs ?? [])],
        matches: [...(match.matches ?? [])]
      };
    }
  }

  if (state.plan.courseCatalog?.[code]) {
    const match = state.plan.courseCatalog[code];
    return {
      code,
      title: match.title,
      hours: Number(match.hours ?? 0),
      prereqs: [...(match.prereqs ?? [])],
      matches: []
    };
  }

  const fastTrackMatch = (state.plan.fastTrack?.coursePairs ?? []).find(
    (pair) => pair.graduateCode === code || pair.undergraduateCode === code
  );
  if (fastTrackMatch) {
    return {
      code,
      title: fastTrackMatch.title,
      hours: 3,
      prereqs: [],
      matches: [fastTrackMatch.undergraduateCode, fastTrackMatch.graduateCode].filter(Boolean)
    };
  }

  const transcriptMatch = getTranscriptCourseMatch(code);
  if (transcriptMatch) {
    return {
      code,
      title: transcriptMatch.title,
      hours: Number(transcriptMatch.credits ?? 0),
      prereqs: [],
      matches: []
    };
  }

  return null;
}

function getCourseLabel(code) {
  const definition = getCourseDefinition(code);
  return definition ? `${code} · ${sanitizePlannerCourseTitle(definition.title, code)}` : code;
}

function getCourseHours(code, fallbackHours = 0) {
  const definition = getCourseDefinition(code);
  if (definition && Number.isFinite(definition.hours) && definition.hours > 0) {
    return definition.hours;
  }

  const transcriptMatch = getTranscriptCourseMatch(code);
  if (transcriptMatch && Number.isFinite(Number(transcriptMatch.credits))) {
    return Number(transcriptMatch.credits);
  }

  return Number(fallbackHours ?? 0);
}

function isCodeInCart(code) {
  return state.cart.some((item) => item.code === code);
}

function toSavedPlannerCourse(code, title) {
  const match = String(code ?? "").trim().toUpperCase().match(/^([A-Z]{3,5})\s+(\d{3}[A-Z]?)$/u);
  if (!match) {
    return null;
  }

  const definition = getCourseDefinition(code);
  return {
    subject: match[1],
    courseNumber: match[2],
    title: sanitizePlannerCourseTitle(definition?.title ?? title ?? code, code),
    campus: "college-station",
    campusLabel: "College Station"
  };
}

function addToCart(code, title, source) {
  if (!code || isCodeInCart(code)) {
    return;
  }

  state.cart.push({
    code,
    title: title || getCourseLabel(code),
    source
  });

  const savedCourse = toSavedPlannerCourse(code, title);
  if (savedCourse) {
    saveCourse("plan", savedCourse);
  }

  recomputePlannerState();
}

function removeFromCart(code) {
  state.cart = state.cart.filter((item) => item.code !== code);

  const savedCourse = toSavedPlannerCourse(code);
  if (savedCourse) {
    removeCourse("plan", savedCourse);
  }

  recomputePlannerState();
}

function removeTranscriptCourse(signature) {
  state.transcriptCourses = state.transcriptCourses.filter((course) => course.signature !== signature);
  recomputePlannerState();
}

function buildManualCourseFromForm(formData, baseCourse = null) {
  const subject = String(formData.get("planner-course-subject") ?? "").trim().toUpperCase();
  const number = String(formData.get("planner-course-number") ?? "").trim();
  const title = String(formData.get("planner-course-title") ?? "").trim();
  const statusInput = String(formData.get("planner-course-status") ?? "completed").trim();
  const credits = Number(formData.get("planner-course-credits") ?? 0);

  if (!subject || !number || !title) {
    setHelper(elements.ingestState, "Manual courses need subject, number, and title.", true);
    return null;
  }

  const code = normalizeCourseCode(subject, number);
  const isInProgress = statusInput === "in-progress";

  return {
    signature: `${Date.now()}-${code}-${Math.random().toString(36).slice(2, 8)}`,
    term: baseCourse?.term ?? "Manual review",
    sourceType: isInProgress ? "in-progress" : statusInput === "transfer" ? "transfer" : "institution",
    subject,
    number,
    code,
    title: sanitizePlannerCourseTitle(title, code),
    grade: isInProgress ? null : statusInput === "transfer" ? "TCR" : "A",
    credits,
    points: isInProgress ? null : credits * 4,
    status: isInProgress ? "in-progress" : "completed"
  };
}

function addManualCourse(formData) {
  const context = state.manualCourseContext;
  const manualCourse = buildManualCourseFromForm(formData, context?.course ?? null);
  if (!manualCourse) {
    return;
  }

  if (context?.mode === "pending-fix" && state.pendingParsedTranscript) {
    const originalIndex = state.pendingParsedTranscript.courses.indexOf(context.course);
    if (originalIndex >= 0) {
      state.pendingParsedTranscript.courses.splice(originalIndex, 1, manualCourse);
    } else {
      state.pendingParsedTranscript.courses.push(manualCourse);
    }

    closeManualModal();
    setHelper(
      elements.ingestState,
      "Unconfirmed course updated. Review the transcript again, then build the planner."
    );
    return;
  }

  if (!state.transcriptMeta) {
    state.transcriptMeta = {
      studentName: "Manual planner state",
      studentId: null,
      overallGpa: null,
      earnedHours: null,
      gpaHours: null,
      majors: [],
      minors: [],
      currentPrograms: []
    };
  }

  state.transcriptCourses.push(manualCourse);
  closeManualModal();
  recomputePlannerState();
}

function materializeParsedTranscript(parsed) {
  state.transcriptMeta = {
    studentName: parsed.studentName,
    studentId: parsed.studentId,
    overallGpa: parsed.overallGpa,
    earnedHours: parsed.earnedHours,
    gpaHours: parsed.gpaHours,
    majors: parsed.majors ?? [],
    minors: parsed.minors ?? [],
    currentPrograms: parsed.currentPrograms ?? []
  };

  state.transcriptCourses = parsed.courses.map((course, index) => ({
    ...course,
    signature: `${course.term}|${course.code}|${course.grade ?? ""}|${course.credits ?? ""}|${index}`
  }));
}

function closeTranscriptModal() {
  elements.transcriptModal.hidden = true;
  elements.transcriptModalSummary.innerHTML = "";
  elements.transcriptModalList.innerHTML = "";
}

function openTranscriptModal(parsed) {
  const completedCourses = parsed.courses.filter((course) => course.status === "completed");
  const inProgressCourses = parsed.courses.filter((course) => course.status === "in-progress");
  const reviewCourses = parsed.courses.filter((course) => course.status === "not-counted");

  elements.transcriptModal.hidden = false;
  elements.transcriptModalSummary.innerHTML = "";
  elements.transcriptModalList.innerHTML = "";
  elements.transcriptModalSummary.append(
    createTokenList([
      parsed.studentName ?? "Unknown student",
      `${completedCourses.length} completed`,
      `${inProgressCourses.length} in progress`,
      reviewCourses.length ? `${reviewCourses.length} need review` : "No uncertain rows"
    ])
  );

  [
    {
      title: `Completed (${completedCourses.length})`,
      courses: completedCourses
    },
    {
      title: `In progress (${inProgressCourses.length})`,
      courses: inProgressCourses
    },
    {
      title: `Needs confirmation (${reviewCourses.length})`,
      courses: reviewCourses
    }
  ]
    .filter((section) => section.courses.length > 0)
    .forEach((section) => {
      const block = document.createElement("section");
      block.className = "planner-modal-section";
      const heading = document.createElement("h3");
      heading.textContent = section.title;
      const list = document.createElement("div");
      list.className = "planner-modal-section-list";

      section.courses
        .slice()
        .sort((left, right) => left.code.localeCompare(right.code))
        .forEach((course) => {
          if (course.status === "not-counted") {
            list.append(createPendingTranscriptFixItem(course));
            return;
          }

          list.append(
            createModalItem(
              course.code,
              `${course.term} · ${
                course.status === "in-progress" ? "In progress" : course.grade
              } · ${course.credits ?? 0} cr`
            )
          );
        });

      block.append(heading, list);
      elements.transcriptModalList.append(block);
    });
}

function confirmPendingTranscript() {
  if (!state.pendingParsedTranscript) {
    return;
  }

  materializeParsedTranscript(state.pendingParsedTranscript);
  state.pendingParsedTranscript = null;
  state.cart = [];
  state.plannerMessages = [];
  state.previousResponseId = null;
  state.selectedNodeId = null;
  state.graphPanInitialized = false;
  state.graphScale = 1;
  closeTranscriptModal();
  recomputePlannerState();
  setHelper(
    elements.ingestState,
    "Transcript confirmed. Review the detected courses and add anything missing before trusting the final plan."
  );
}

function flattenTrackedElectives() {
  const items = [];

  for (const [track, courses] of Object.entries(state.plan?.trackedElectives ?? {})) {
    courses.forEach((course) => {
      items.push({
        ...course,
        track
      });
    });
  }

  return items;
}

function buildEquivalentPlannerCodeMap() {
  const map = new Map();

  (state.plan?.graphNodes ?? []).forEach((node) => {
    map.set(node.code, node.code);
    (node.matches ?? []).forEach((code) => map.set(code, node.code));
  });

  flattenTrackedElectives().forEach((course) => {
    map.set(course.code, course.code);
    (course.matches ?? []).forEach((code) => map.set(code, course.code));
  });

  (state.plan?.fastTrack?.coursePairs ?? []).forEach((pair) => {
    map.set(pair.graduateCode, pair.undergraduateCode);
  });

  return map;
}

function buildGraphRenderNodes() {
  const transcript = getActiveTranscript();
  if (!state.evaluation || !state.plan || !transcript) {
    return [];
  }

  const equivalentMap = buildEquivalentPlannerCodeMap();
  const transcriptTermLookup = new Map();

  transcript.courses.forEach((course) => {
    [course.code, equivalentMap.get(course.code)].filter(Boolean).forEach((mappedCode) => {
      if (!transcriptTermLookup.has(mappedCode)) {
        transcriptTermLookup.set(mappedCode, course);
      }
    });
  });

  const activeCodes = new Set([
    ...transcript.completedCourseCodes,
    ...transcript.inProgressCourseCodes,
    ...state.cart.map((item) => item.code)
  ].flatMap((code) => [code, equivalentMap.get(code)].filter(Boolean)));

  const representedCodes = new Set();
  const coreNodes = state.evaluation.graphNodes.map((node) => {
    const transcriptMatch =
      transcriptTermLookup.get(node.completedCode) ??
      transcriptTermLookup.get(node.inProgressCode) ??
      transcriptTermLookup.get(node.code) ??
      null;

    representedCodes.add(node.code);
    (node.matches ?? []).forEach((code) => representedCodes.add(code));
    return {
      ...node,
      term:
        transcriptMatch?.term ??
        (node.plannedCode ? "Semester plan" : null)
    };
  });

  const transcriptExtras = transcript.courses
    .filter(
      (course) =>
        (course.status === "completed" || course.status === "in-progress") &&
        !representedCodes.has(course.code)
    )
    .map((course, index) => {
      const definition = getCourseDefinition(course.code);
      return {
        id: `transcript-${normalizeNodeIdFragment(course.code)}-${normalizeNodeIdFragment(
          course.term ?? String(index)
        )}-${index}`,
        type: "transcript-extra",
        code: course.code,
        title: sanitizePlannerCourseTitle(definition?.title ?? course.title, course.code),
        hours: getCourseHours(course.code, course.credits ?? 0),
        column: "transcript-extra",
        state: course.status === "in-progress" ? "in-progress" : "completed",
        completedCode: course.status === "completed" ? course.code : null,
        inProgressCode: course.status === "in-progress" ? course.code : null,
        plannedCode: null,
        prereqs: [...(definition?.prereqs ?? [])],
        matches: [
          ...(definition?.matches ?? []),
          definition?.code && definition.code !== course.code ? definition.code : null
        ].filter(Boolean),
        missingPrereqs: [],
        isSupplemental: true,
        sourceType: course.sourceType,
        term: course.term
      };
    });

  const plannedExtras = state.cart
    .filter((item) => !representedCodes.has(item.code) && !transcript.completedCourseCodes.includes(item.code) && !transcript.inProgressCourseCodes.includes(item.code))
    .map((item, index) => {
      const definition = getCourseDefinition(item.code);
      const prereqs = [...(definition?.prereqs ?? [])];
      return {
        id: `planned-${normalizeNodeIdFragment(item.code)}-${index}`,
        type: "planned-extra",
        code: item.code,
        title: sanitizePlannerCourseTitle(definition?.title ?? item.title, item.code),
        hours: getCourseHours(item.code),
        column: "transcript-planned",
        state: "planned",
        completedCode: null,
        inProgressCode: null,
        plannedCode: item.code,
        prereqs,
        matches: [
          ...(definition?.matches ?? []),
          definition?.code && definition.code !== item.code ? definition.code : null
        ].filter(Boolean),
        missingPrereqs: prereqs.filter((code) => !activeCodes.has(code)),
        isSupplemental: true,
        sourceType: item.source,
        term: "Semester plan"
      };
    });

  return [...coreNodes, ...transcriptExtras, ...plannedExtras];
}

function buildRenderGraphEdges(nodes) {
  const codeToNode = new Map();

  nodes.forEach((node) => {
    [node.code, ...(node.matches ?? [])].filter(Boolean).forEach((code) => {
      const existing = codeToNode.get(code);
      if (!existing || (existing.isSupplemental && !node.isSupplemental)) {
        codeToNode.set(code, {
          id: node.id,
          isSupplemental: Boolean(node.isSupplemental)
        });
      }
    });
  });

  const seen = new Set();
  const edges = [];

  nodes.forEach((node) => {
    (node.prereqs ?? []).forEach((prereq) => {
      const fromNode = codeToNode.get(prereq);
      if (!fromNode || fromNode.id === node.id) {
        return;
      }

      const edgeId = `${fromNode.id}|${node.id}|${prereq}`;
      if (seen.has(edgeId)) {
        return;
      }

      seen.add(edgeId);
      edges.push({
        from: fromNode.id,
        to: node.id,
        code: prereq
      });
    });
  });

  return edges;
}

function computeCoreNodeDepths(nodes) {
  const nodeById = new Map(nodes.filter((node) => !node.isSupplemental).map((node) => [node.id, node]));
  const codeToNodeId = new Map();

  nodes
    .filter((node) => !node.isSupplemental)
    .forEach((node) => {
      [node.code, ...(node.matches ?? [])].filter(Boolean).forEach((code) => {
        codeToNodeId.set(code, node.id);
      });
    });

  const visiting = new Set();
  const depthMemo = new Map();

  function visit(nodeId) {
    if (!nodeId) {
      return 0;
    }

    if (depthMemo.has(nodeId)) {
      return depthMemo.get(nodeId);
    }

    if (visiting.has(nodeId)) {
      return 0;
    }

    visiting.add(nodeId);
    const node = nodeById.get(nodeId);
    const prereqDepth = Math.max(
      0,
      ...(node?.prereqs ?? []).map((code) => {
        const prereqNodeId = codeToNodeId.get(code);
        return prereqNodeId ? visit(prereqNodeId) + 1 : 0;
      })
    );
    visiting.delete(nodeId);
    depthMemo.set(nodeId, prereqDepth);
    return prereqDepth;
  }

  nodes
    .filter((node) => !node.isSupplemental)
    .forEach((node) => {
      visit(node.id);
    });

  return depthMemo;
}

function recomputePlannerState() {
  const transcript = getActiveTranscript();

  if (!state.plan || !transcript) {
    state.evaluation = null;
    state.graphRenderNodes = [];
    state.renderGraphEdges = [];
  } else {
    state.evaluation = evaluatePlannerState(
      state.plan,
      transcript,
      state.cart.map((item) => item.code)
    );
    state.graphRenderNodes = buildGraphRenderNodes();
    state.renderGraphEdges = buildRenderGraphEdges(state.graphRenderNodes);

    const hasSelectedNode = state.evaluation.graphNodes.some(
      (node) => node.id === state.selectedNodeId
    );
    if (!hasSelectedNode) {
      const hasSupplementalSelection = state.graphRenderNodes.some(
        (node) => node.id === state.selectedNodeId
      );
      if (!hasSupplementalSelection) {
        state.selectedNodeId = null;
      }
    }
  }

  renderTranscriptSummary();
  renderTranscriptCourseLists();
  renderSummaryGrid();
  renderGraph();
  renderNodeDetail();
  renderCart();
  renderSuggestions();
  renderScheduleRecommendation();
  renderPlannerChat();
  writePlannerStorage();
}

function renderTranscriptSummary() {
  const transcript = getActiveTranscript();

  if (!transcript) {
    elements.transcriptSummary.hidden = true;
    return;
  }

  elements.transcriptSummary.hidden = false;
  elements.transcriptSummary.innerHTML = "";

  const items = [
    {
      label: "Student",
      value: transcript.studentName ?? "Unknown",
      compact: true,
      identity: true
    },
    {
      label: "Overall GPA",
      value: transcript.overallGpa != null ? transcript.overallGpa.toFixed(3) : "Unknown",
      compact: true
    },
    {
      label: "Completed",
      value: String(transcript.completedCourses.length),
      compact: true
    },
    {
      label: "In Progress",
      value: String(transcript.inProgressCourses.length),
      compact: true
    }
  ];

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = `planner-stat-card ${item.compact ? "planner-stat-card-compact" : ""} ${
      item.identity ? "planner-stat-card-identity" : ""
    }`.trim();
    const kicker = document.createElement("p");
    kicker.className = "planner-stat-label";
    kicker.textContent = item.label;

    if (Array.isArray(item.values)) {
      card.append(kicker, createTokenList(item.values));
    } else {
      const metric = document.createElement("p");
      metric.className = `planner-stat-value ${item.identity ? "planner-stat-value-identity" : ""}`.trim();
      metric.textContent = item.value;
      card.append(kicker, metric);
    }

    elements.transcriptSummary.append(card);
  });
}

function renderTranscriptCourseLists() {
  const transcript = getActiveTranscript();

  if (!transcript) {
    elements.completedState.hidden = false;
    elements.completedState.textContent = "No transcript parsed yet.";
    elements.completedList.hidden = true;
    elements.inProgressList.hidden = true;
    elements.openReviewButton.disabled = true;
    elements.openManualButton.disabled = false;
    return;
  }

  const completedCourses = [...transcript.completedCourses].sort((left, right) =>
    left.code.localeCompare(right.code)
  );
  const inProgressCourses = [...transcript.inProgressCourses].sort((left, right) =>
    left.code.localeCompare(right.code)
  );

  elements.completedState.hidden = false;
  elements.completedState.textContent = `${completedCourses.length} completed and ${inProgressCourses.length} in-progress courses loaded. Open the transcript review modal to inspect or remove rows.`;
  elements.completedList.hidden = completedCourses.length === 0;
  elements.completedList.innerHTML = "";
  elements.openReviewButton.disabled = false;
  elements.openManualButton.disabled = false;

  completedCourses.forEach((course) => {
    elements.completedList.append(createTranscriptCourseChip(course));
  });

  elements.inProgressList.hidden = inProgressCourses.length === 0;
  elements.inProgressList.innerHTML = "";

  if (inProgressCourses.length > 0) {
    const label = document.createElement("p");
    label.className = "planner-list-heading";
    label.textContent = "Courses in progress";
    elements.inProgressList.append(label);
  }

  inProgressCourses.forEach((course) => {
    elements.inProgressList.append(createTranscriptCourseChip(course));
  });
}

function createTranscriptCourseChip(course) {
  const article = document.createElement("article");
  article.className = "planner-course-chip";

  const content = document.createElement("div");
  content.className = "planner-course-chip-copy";

  const code = document.createElement("p");
  code.className = "result-code";
  code.textContent = course.code;

  const meta = document.createElement("p");
  meta.className = "planner-course-chip-meta";
  meta.textContent = `${course.title} · ${course.term} · ${
    course.status === "in-progress" ? "In progress" : course.grade
  } · ${course.credits ?? 0} cr`;

  content.append(code, meta);

  const removeButton = document.createElement("button");
  removeButton.className = "result-action-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    removeTranscriptCourse(course.signature);
  });

  article.append(content, removeButton);
  return article;
}

function renderSummaryGrid() {
  elements.summaryGrid.innerHTML = "";

  if (!state.evaluation) {
    return;
  }

  const fastTrackEligible = state.evaluation.fastTrackOptions.filter(
    (course) => course.state === "eligible"
  ).length;
  const fastTrackCandidate = state.evaluation.fastTrackOptions.filter(
    (course) => course.state === "candidate"
  ).length;

  const cards = [
    {
      type: "required-core",
      label: "Required core",
      value: `${state.evaluation.flexibleProgress.requiredCore.completedCount}/${state.evaluation.flexibleProgress.requiredCore.totalCount}`,
      note:
        state.evaluation.flexibleProgress.requiredCore.inProgressCount > 0
          ? `${state.evaluation.flexibleProgress.requiredCore.inProgressCount} in progress`
          : "Named catalog courses and required choices"
    },
    {
      type: "verified-ucc",
      label: "Verified UCC hours",
      value: `${state.evaluation.flexibleProgress.verifiedUccHours}/${state.plan.verifiedUccHoursTarget}`,
      note: "Partial verification only"
    },
    {
      type: "tracked-electives",
      label: "Tracked electives",
      value: `${state.evaluation.flexibleProgress.trackedElectiveHours}/${state.plan.trackedElectiveHoursTarget}`,
      note:
        state.evaluation.flexibleProgress.activeTrackedElectiveHours >
        state.evaluation.flexibleProgress.trackedElectiveHours
          ? `${state.evaluation.flexibleProgress.activeTrackCoverage.length} track(s) covered or in progress`
          : `${state.evaluation.flexibleProgress.trackCoverage.length} track(s) covered`
    },
    {
      type: "fast-track",
      label: "Fast track",
      value: `${fastTrackEligible} ready`,
      note: fastTrackCandidate ? `${fastTrackCandidate} more need advisor review` : "No extra review candidates"
    }
  ];

  cards.forEach((card) => {
    const article = document.createElement("button");
    article.type = "button";
    article.className = `planner-stat-card planner-stat-card-button ${
      card.type === "required-core" || card.type === "verified-ucc" || card.type === "tracked-electives"
        ? "is-clickable"
        : ""
    }`.trim();
    const label = document.createElement("p");
    label.className = "planner-stat-label";
    label.textContent = card.label;
    const value = document.createElement("p");
    value.className = "planner-stat-value";
    value.textContent = card.value;
    const note = document.createElement("p");
    note.className = "planner-stat-note";
    note.textContent = card.note;
    article.append(label, value, note);
    if (card.type === "required-core" || card.type === "verified-ucc" || card.type === "tracked-electives") {
      article.addEventListener("click", () => {
        openRequirementModal(card.type);
      });
    } else {
      article.classList.add("is-static");
    }
    elements.summaryGrid.append(article);
  });
}

function closeRequirementModal() {
  elements.requirementModal.hidden = true;
  elements.requirementModalBody.innerHTML = "";
}

function openRequirementModal(type) {
  const transcript = getActiveTranscript();
  if (!state.evaluation || !state.plan || !transcript) {
    return;
  }

  elements.requirementModal.hidden = false;
  elements.requirementModalBody.innerHTML = "";

  if (type === "required-core") {
    elements.requirementModalKicker.textContent = "Required core";
    elements.requirementModalTitle.textContent = "Satisfied vs remaining CS BS core";

    const groupedNodes = new Map();
    state.evaluation.graphNodes.forEach((node) => {
      const category = getRequiredCoreCategory(node);
      if (!groupedNodes.has(category)) {
        groupedNodes.set(category, []);
      }
      groupedNodes.get(category).push(node);
    });

    [...groupedNodes.entries()].forEach(([category, nodes]) => {
      const sectionBody = document.createElement("div");
      sectionBody.className = "planner-modal-section-stack";

      appendModalSection(
        sectionBody,
        `${category} · Satisfied (${nodes.filter((node) => node.state === "completed").length})`,
        nodes
          .filter((node) => node.state === "completed")
          .map((node) => createModalItem(node.code, node.title))
      );
      appendModalSection(
        sectionBody,
        `${category} · Current (${nodes.filter((node) => node.state === "in-progress" || node.state === "planned").length})`,
        nodes
          .filter((node) => node.state === "in-progress" || node.state === "planned")
          .map((node) =>
            createModalItem(
              node.code,
              node.inProgressCode ? "In progress on transcript" : "Already added to semester plan"
            )
          )
      );
      appendModalSection(
        sectionBody,
        `${category} · Remaining (${nodes.filter((node) => node.state === "eligible" || node.state === "locked").length})`,
        nodes
          .filter((node) => node.state === "eligible" || node.state === "locked")
          .map((node) =>
            createModalItem(
              node.code,
              node.missingPrereqs.length
                ? `Blocked by ${node.missingPrereqs.join(", ")}`
                : "Ready once you want to schedule it"
            )
          )
      );

      elements.requirementModalBody.append(sectionBody);
    });

    return;
  }

  if (type === "verified-ucc") {
    elements.requirementModalKicker.textContent = "Verified UCC";
    elements.requirementModalTitle.textContent = "Known UCC matches on the transcript";

    const completedCodes = new Set(transcript.completedCourseCodes);
    const satisfied = state.plan.verifiedUccMatchers.filter((code) => completedCodes.has(code));
    const remaining = state.plan.verifiedUccMatchers.filter((code) => !completedCodes.has(code));

    const note = document.createElement("p");
    note.className = "planner-modal-copy";
    note.textContent =
      "This remains advisory. The planner only verifies the common public UCC course matches wired into this first CS-first version.";
    elements.requirementModalBody.append(note);

    VERIFIED_UCC_CATEGORIES.forEach((category) => {
      appendModalSection(
        elements.requirementModalBody,
        `${category.title} · Verified now (${satisfied.filter((code) => category.codes.includes(code)).length})`,
        satisfied
          .filter((code) => category.codes.includes(code))
          .map((code) => createModalItem(code, "Matched on the uploaded transcript"))
      );
      appendModalSection(
        elements.requirementModalBody,
        `${category.title} · Not yet matched (${remaining.filter((code) => category.codes.includes(code)).length})`,
        remaining
          .filter((code) => category.codes.includes(code))
          .map((code) => createModalItem(code, "No verified transcript match yet"))
      );
    });

    return;
  }

  elements.requirementModalKicker.textContent = "Tracked electives";
  elements.requirementModalTitle.textContent = "Track coverage and remaining elective need";

  const equivalentMap = buildEquivalentPlannerCodeMap();
  const completedCodes = new Set(
    transcript.completedCourseCodes.flatMap((code) => [code, equivalentMap.get(code)].filter(Boolean))
  );
  const activeCodes = new Set(
    [...transcript.completedCourseCodes, ...transcript.inProgressCourseCodes, ...state.cart.map((item) => item.code)].flatMap((code) => [code, equivalentMap.get(code)].filter(Boolean))
  );
  const trackedCourses = flattenTrackedElectives().filter((course) => course.track !== "Untracked");
  const completedTracked = trackedCourses.filter((course) => completedCodes.has(course.code));
  const activeTracked = trackedCourses.filter((course) => activeCodes.has(course.code));
  const requiredTracks = Object.keys(state.plan.trackedElectives ?? {}).filter((track) => track !== "Untracked");
  const coveredTracks = new Set(activeTracked.map((course) => course.track));
  const missingTracks = requiredTracks.filter((track) => !coveredTracks.has(track));

  const topNote = document.createElement("p");
  topNote.className = "planner-modal-copy";
  topNote.textContent = `Completed tracked hours: ${state.evaluation.flexibleProgress.trackedElectiveHours}/${state.plan.trackedElectiveHoursTarget}. Active tracked hours: ${state.evaluation.flexibleProgress.activeTrackedElectiveHours}/${state.plan.trackedElectiveHoursTarget}. Counted tracked courses: ${state.evaluation.flexibleProgress.activeTrackedElectiveCourseCount}/${state.plan.trackedElectiveCourseTarget}. Untracked electives do not satisfy the six additional tracked-course requirement.`;
  elements.requirementModalBody.append(topNote);

  appendModalSection(
    elements.requirementModalBody,
    `Completed tracked courses (${completedTracked.length})`,
    completedTracked.map((course) => createModalItem(course.code, course.track))
  );
  appendModalSection(
    elements.requirementModalBody,
    `Active this semester or semester plan (${activeTracked.length})`,
    activeTracked.map((course) =>
      createModalItem(
        course.code,
        transcript.inProgressCourseCodes.includes(course.code) ||
        [...transcript.inProgressCourseCodes].some((code) => equivalentMap.get(code) === course.code)
          ? `${course.track} · In progress`
          : `${course.track} · Counted now`
      )
    )
  );
  appendModalSection(
    elements.requirementModalBody,
    `Missing track coverage (${missingTracks.length})`,
    missingTracks.length > 0
      ? missingTracks.map((track) =>
          createModalItem(track, "You still need at least one tracked course in this track")
        )
      : [createModalItem("All four tracks covered", "Current completed + active courses cover every required track")]
  );
}

function getPlanColumnLabel(columnId) {
  return (
    state.plan?.graphColumns?.find((column) => column.id === columnId)?.label ?? "Plan track"
  );
}

function formatGraphNodeLabel(code) {
  return String(code ?? "")
    .split("/")
    .map((part) => {
      const match = part.trim().match(/^([A-Z]{3,5})\s+(\d{3}[A-Z]?)$/u);
      return match ? `${match[1]} ${match[2]}` : part.trim();
    })
    .join(" / ");
}

function buildNodeDescription(node) {
  if (node.isSupplemental) {
    const title = sanitizePlannerCourseTitle(node.title, node.code);
    return `${title} was found on the transcript or semester plan but is not one of the named CS BS core graph requirements. It still appears here so the planner view reflects the student's full course history.`;
  }

  if (node.type === "choice") {
    return `Choose one approved course in this requirement group. The planner treats any listed option as satisfying this slot once prerequisites are clear.`;
  }

  return `${node.title} is part of the ${state.plan?.title ?? "degree"} path. Use this graph to inspect prerequisite blockers, then add the course to your semester plan when it fits your plan.`;
}

function computeGraphLayout(nodes) {
  const coreNodeDepths = computeCoreNodeDepths(nodes);
  const nodesByDepth = new Map();
  const supplementalBuckets = {
    completed: [],
    "in-progress": [],
    planned: []
  };

  nodes.forEach((node) => {
    if (node.isSupplemental) {
      supplementalBuckets[node.state]?.push(node);
      return;
    }

    const depth = coreNodeDepths.get(node.id) ?? 0;
    if (!nodesByDepth.has(depth)) {
      nodesByDepth.set(depth, []);
    }
    nodesByDepth.get(depth).push(node);
  });

  const positions = {};
  let maxY = 0;

  const sortedDepths = [...nodesByDepth.keys()].sort((left, right) => left - right);
  const columnSpacing = 192;
  const rowSpacing = 106;
  const coreBaseX = 420;

  sortedDepths.forEach((depth, depthIndex) => {
    const depthNodes = nodesByDepth.get(depth) ?? [];
    const totalHeight = Math.max(0, (depthNodes.length - 1) * rowSpacing);
    const startY = 210 + Math.max(0, (12 - depthNodes.length) * 16) - totalHeight / 2;
    const x = coreBaseX + depthIndex * columnSpacing;

    depthNodes.forEach((node, nodeIndex) => {
      const y = startY + nodeIndex * rowSpacing + (nodeIndex % 2 === 0 ? 0 : 12);
      positions[node.id] = { x, y };
      maxY = Math.max(maxY, y);
    });
  });

  const coreRightEdge =
    (sortedDepths.length ? coreBaseX + (sortedDepths.length - 1) * columnSpacing : coreBaseX) + 180;
  const coreLeftEdge = 180;
  const supplementalMaxRows = 6;

  const placeSupplementalBucket = (bucket, baseX, direction = 1) => {
    const bucketNodes = supplementalBuckets[bucket] ?? [];
    const columnWidth = 150;

    bucketNodes.forEach((node, nodeIndex) => {
      const columnIndex = Math.floor(nodeIndex / supplementalMaxRows);
      const rowIndex = nodeIndex % supplementalMaxRows;
      const x = baseX + direction * columnIndex * columnWidth;
      const y = 180 + rowIndex * rowSpacing + (columnIndex % 2 === 0 ? 0 : 14);
      positions[node.id] = { x, y };
      maxY = Math.max(maxY, y);
    });

    return bucketNodes.length
      ? Math.ceil(bucketNodes.length / supplementalMaxRows) * columnWidth
      : 0;
  };

  const completedWidth = placeSupplementalBucket("completed", coreLeftEdge, -1);
  placeSupplementalBucket("in-progress", coreRightEdge + 170);
  placeSupplementalBucket("planned", coreRightEdge + 470);

  const minX = Math.min(
    coreLeftEdge - completedWidth - 60,
    ...Object.values(positions).map((position) => position.x - 88)
  );
  const maxX = Math.max(
    coreRightEdge + 560,
    ...Object.values(positions).map((position) => position.x + 88)
  );

  return {
    width: Math.max(1320, maxX - minX + 120),
    height: Math.max(900, maxY + 180),
    minX,
    maxX,
    positions: Object.fromEntries(
      Object.entries(positions).map(([id, position]) => [
        id,
        {
          x: position.x - minX + 60,
          y: position.y
        }
      ])
    )
  };
}

function applyGraphTransform() {
  const transform = `translate(${state.graphPanX}px, ${state.graphPanY}px) scale(${state.graphScale})`;
  if (elements.graphBubbles) {
    elements.graphBubbles.style.transform = transform;
  }
  elements.graphColumns.style.transform = transform;
  elements.graphEdges.style.transform = transform;
}

function initializeGraphPan(layout) {
  if (state.graphPanInitialized || !elements.graphCanvas) {
    applyGraphTransform();
    return;
  }

  const canvasWidth = elements.graphCanvas.clientWidth || 1200;
  const canvasHeight = elements.graphCanvas.clientHeight || 620;
  const horizontalFit = (canvasWidth - 72) / Math.max(layout.width, 1);
  const verticalFit = (canvasHeight - 96) / Math.max(layout.height, 1);
  const fitScale = clampScale(Math.min(1, horizontalFit, verticalFit));

  state.graphScale = fitScale;
  state.graphPanX = (canvasWidth - layout.width * fitScale) / 2;
  state.graphPanY = Math.max(28, (canvasHeight - layout.height * fitScale) / 2);
  state.graphInitialScale = state.graphScale;
  state.graphInitialPanX = state.graphPanX;
  state.graphInitialPanY = state.graphPanY;
  state.graphPanInitialized = true;
  applyGraphTransform();
}

function setZoomHint() {
  elements.zoomHint.textContent = `Drag to pan. Use + / - or Ctrl/Cmd + wheel to zoom. Reset returns to the fitted full-transcript view. Current zoom ${Math.round(
    state.graphScale * 100
  )}%.`;
}

function clampScale(nextScale) {
  return Math.min(1.85, Math.max(0.38, nextScale));
}

function zoomGraph(targetScale, anchorX, anchorY) {
  const nextScale = clampScale(targetScale);
  if (Math.abs(nextScale - state.graphScale) < 0.001) {
    return;
  }

  const canvasRect = elements.graphCanvas.getBoundingClientRect();
  const localAnchorX = anchorX ?? canvasRect.width / 2;
  const localAnchorY = anchorY ?? canvasRect.height / 2;
  const graphX = (localAnchorX - state.graphPanX) / state.graphScale;
  const graphY = (localAnchorY - state.graphPanY) / state.graphScale;

  state.graphScale = nextScale;
  state.graphPanX = localAnchorX - graphX * nextScale;
  state.graphPanY = localAnchorY - graphY * nextScale;
  applyGraphTransform();
  setZoomHint();
}

function renderGraph() {
  if (!state.plan || !state.evaluation) {
    elements.graphEmpty.hidden = false;
    elements.graphCanvas.hidden = true;
    elements.graphBubbles.innerHTML = "";
    elements.nodeDetail.hidden = true;
    state.graphLayout = null;
    return;
  }

  elements.graphEmpty.hidden = true;
  elements.graphCanvas.hidden = false;
  elements.graphBubbles.innerHTML = "";
  elements.graphColumns.innerHTML = "";
  state.graphLayout = computeGraphLayout(state.graphRenderNodes);

  elements.graphBubbles.style.width = `${state.graphLayout.width}px`;
  elements.graphBubbles.style.height = `${state.graphLayout.height}px`;
  elements.graphColumns.style.width = `${state.graphLayout.width}px`;
  elements.graphColumns.style.height = `${state.graphLayout.height}px`;
  elements.graphEdges.style.width = `${state.graphLayout.width}px`;
  elements.graphEdges.style.height = `${state.graphLayout.height}px`;

  for (const node of state.graphRenderNodes) {
    const position = state.graphLayout.positions[node.id];
    if (!position) {
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = `planner-node planner-node-${node.state} ${
      state.selectedNodeId === node.id ? "is-selected" : ""
    }`;
    button.dataset.nodeId = node.id;
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;

    const code = document.createElement("span");
    code.className = "planner-node-code";
    code.textContent = formatGraphNodeLabel(node.code);
    button.append(code);

    button.addEventListener("click", () => {
      state.selectedNodeId = node.id;
      renderGraph();
      renderNodeDetail();
    });

    button.addEventListener("mouseenter", () => {
      state.hoveredNodeId = node.id;
      drawGraphEdges();
    });

    button.addEventListener("mouseleave", () => {
      state.hoveredNodeId = null;
      drawGraphEdges();
    });

    elements.graphColumns.append(button);
  }

  requestAnimationFrame(() => {
    initializeGraphPan(state.graphLayout);
    setZoomHint();
    renderGraphTermBubbles();
    drawGraphEdges();
  });
}

function renderGraphTermBubbles() {
  if (!elements.graphBubbles || !state.graphLayout) {
    return;
  }

  elements.graphBubbles.innerHTML = "";

  const groups = new Map();

  state.graphRenderNodes.forEach((node) => {
    if (!node.term || (node.state !== "completed" && node.state !== "in-progress")) {
      return;
    }

    const position = state.graphLayout.positions[node.id];
    if (!position) {
      return;
    }

    if (!groups.has(node.term)) {
      groups.set(node.term, []);
    }

    groups.get(node.term).push({
      node,
      position
    });
  });

  [...groups.entries()].forEach(([term, items]) => {
    const bounds = items.reduce(
      (current, entry) => ({
        left: Math.min(current.left, entry.position.x - 82),
        top: Math.min(current.top, entry.position.y - 52),
        right: Math.max(current.right, entry.position.x + 82),
        bottom: Math.max(current.bottom, entry.position.y + 52)
      }),
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY
      }
    );

    if (!Number.isFinite(bounds.left)) {
      return;
    }

    const bubble = document.createElement("article");
    bubble.className = "planner-term-bubble";
    bubble.style.left = `${bounds.left - 20}px`;
    bubble.style.top = `${bounds.top - 28}px`;
    bubble.style.width = `${bounds.right - bounds.left + 40}px`;
    bubble.style.height = `${bounds.bottom - bounds.top + 56}px`;

    const label = document.createElement("p");
    label.className = "planner-term-bubble-label";
    label.textContent = term;
    bubble.append(label);

    elements.graphBubbles.append(bubble);
  });
}

function drawGraphEdges() {
  const svg = elements.graphEdges;
  svg.innerHTML = "";

  if (!state.evaluation || !state.graphLayout) {
    return;
  }

  svg.setAttribute("viewBox", `0 0 ${state.graphLayout.width} ${state.graphLayout.height}`);
  svg.setAttribute("width", String(state.graphLayout.width));
  svg.setAttribute("height", String(state.graphLayout.height));

  for (const edge of state.renderGraphEdges) {
    const fromPosition = state.graphLayout.positions[edge.from];
    const toPosition = state.graphLayout.positions[edge.to];

    if (!fromPosition || !toPosition) {
      continue;
    }

    const startX = fromPosition.x + 58;
    const startY = fromPosition.y;
    const endX = toPosition.x - 58;
    const endY = toPosition.y;
    const isForward = endX >= startX;
    const deltaX = Math.max(36, Math.abs(endX - startX) * 0.45);
    const controlStartX = startX + (isForward ? deltaX : -deltaX);
    const controlEndX = endX - (isForward ? deltaX : -deltaX);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${controlStartX} ${startY}, ${controlEndX} ${endY}, ${endX} ${endY}`
    );

    const isActive =
      state.selectedNodeId === edge.from ||
      state.selectedNodeId === edge.to ||
      state.hoveredNodeId === edge.from ||
      state.hoveredNodeId === edge.to;

    path.setAttribute("class", `planner-edge ${isActive ? "is-active" : ""}`);
    svg.append(path);
  }
}

function clampNodeDetailPosition(nextX, nextY) {
  const detailWidth = elements.nodeDetail.offsetWidth || 340;
  const detailHeight = elements.nodeDetail.offsetHeight || 360;
  return {
    x: Math.min(Math.max(16, nextX), window.innerWidth - detailWidth - 16),
    y: Math.min(Math.max(88, nextY), window.innerHeight - detailHeight - 16)
  };
}

function applyNodeDetailPosition() {
  if (!state.nodeDetailPosition) {
    return;
  }

  const { x, y } = clampNodeDetailPosition(
    state.nodeDetailPosition.x,
    state.nodeDetailPosition.y
  );
  state.nodeDetailPosition = { x, y };
  elements.nodeDetail.style.left = `${x}px`;
  elements.nodeDetail.style.top = `${y}px`;
}

function ensureNodeDetailPosition() {
  if (!state.nodeDetailPosition) {
    state.nodeDetailPosition = {
      x: Math.max(24, window.innerWidth - 390),
      y: Math.max(108, 96)
    };
  }

  requestAnimationFrame(() => {
    applyNodeDetailPosition();
  });
}

function beginNodeDetailDrag(event) {
  if (event.target.closest(".planner-detail-close")) {
    return;
  }

  ensureNodeDetailPosition();
  state.nodeDetailPointerId = event.pointerId;
  state.nodeDetailDragOffsetX = event.clientX - state.nodeDetailPosition.x;
  state.nodeDetailDragOffsetY = event.clientY - state.nodeDetailPosition.y;
  elements.nodeDetail.classList.add("is-dragging");
}

function handleNodeDetailPointerMove(event) {
  if (state.nodeDetailPointerId !== event.pointerId) {
    return;
  }

  state.nodeDetailPosition = clampNodeDetailPosition(
    event.clientX - state.nodeDetailDragOffsetX,
    event.clientY - state.nodeDetailDragOffsetY
  );
  applyNodeDetailPosition();
}

function endNodeDetailDrag(event) {
  if (state.nodeDetailPointerId !== event.pointerId) {
    return;
  }

  state.nodeDetailPointerId = null;
  elements.nodeDetail.classList.remove("is-dragging");
}

function renderNodeDetail() {
  if (!state.evaluation || !state.selectedNodeId) {
    elements.nodeDetail.hidden = true;
    return;
  }

  const selectedNode = state.graphRenderNodes.find((node) => node.id === state.selectedNodeId);

  if (!selectedNode) {
    elements.nodeDetail.hidden = true;
    return;
  }

  elements.nodeDetail.hidden = false;
  elements.nodeDetail.innerHTML = "";

  const header = document.createElement("div");
  header.className = "planner-node-detail-head";
  const title = document.createElement("h3");
  title.textContent = "Course Insights";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "planner-detail-close";
  closeButton.setAttribute("aria-label", "Close course details");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => {
    state.selectedNodeId = null;
    renderGraph();
    renderNodeDetail();
  });
  header.append(title, closeButton);
  header.addEventListener("pointerdown", beginNodeDetailDrag);

  const codeLine = document.createElement("p");
  codeLine.className = "planner-node-detail-code";
  codeLine.textContent = selectedNode.code;

  const descriptionWrap = document.createElement("div");
  descriptionWrap.className = "planner-node-detail-section";
  const descriptionLabel = document.createElement("p");
  descriptionLabel.className = "planner-detail-label";
  descriptionLabel.textContent = "Description";
  const description = document.createElement("p");
  description.className = "planner-node-detail-copy";
  description.textContent = buildNodeDescription(selectedNode);
  descriptionWrap.append(descriptionLabel, description);

  const body = document.createElement("div");
  body.className = "planner-node-detail-body";

  if (selectedNode.missingPrereqs.length) {
    const warning = document.createElement("div");
    warning.className = "planner-detail-alert";
    const warningHead = document.createElement("div");
    warningHead.className = "planner-detail-alert-head";
    const warningIcon = document.createElement("span");
    warningIcon.className = "planner-detail-alert-icon";
    warningIcon.textContent = "▲";
    const warningLabel = document.createElement("p");
    warningLabel.className = "planner-detail-alert-label";
    warningLabel.textContent = "Missing prerequisite";
    warningHead.append(warningIcon, warningLabel);

    const warningCopy = document.createElement("p");
    warningCopy.className = "planner-detail-alert-copy";
    warningCopy.textContent = `Completion of ${selectedNode.missingPrereqs.join(", ")} required before registration.`;
    warning.append(warningHead, warningCopy);
    body.append(warning);
  } else if (selectedNode.completedCode || selectedNode.inProgressCode || selectedNode.plannedCode) {
    const status = document.createElement("div");
    status.className = "planner-detail-alert planner-detail-alert-neutral";
    const statusHead = document.createElement("div");
    statusHead.className = "planner-detail-alert-head";
    const statusLabel = document.createElement("p");
    statusLabel.className = "planner-detail-alert-label";
    statusLabel.textContent = "Planner status";
    statusHead.append(statusLabel);

    const statusCopy = document.createElement("p");
    statusCopy.className = "planner-detail-alert-copy";
    statusCopy.textContent = selectedNode.completedCode
      ? `Already satisfied by ${selectedNode.completedCode}.`
      : selectedNode.inProgressCode
        ? `Currently in progress as ${selectedNode.inProgressCode}.`
        : `Already added to your semester plan as ${selectedNode.plannedCode}.`;
    status.append(statusHead, statusCopy);
    body.append(status);
  }

  const metrics = document.createElement("div");
  metrics.className = "planner-detail-metrics";
  const creditMetric = document.createElement("div");
  creditMetric.className = "planner-detail-metric";
  const creditLabel = document.createElement("p");
  creditLabel.className = "planner-detail-label";
  creditLabel.textContent = "Credits";
  const creditValue = document.createElement("p");
  creditValue.className = "planner-detail-metric-value";
  creditValue.textContent = `${Number(selectedNode.hours ?? 0).toFixed(1)} hrs`;
  creditMetric.append(creditLabel, creditValue);

  const termMetric = document.createElement("div");
  termMetric.className = "planner-detail-metric";
  const termLabel = document.createElement("p");
  termLabel.className = "planner-detail-label";
  termLabel.textContent = selectedNode.isSupplemental ? "Transcript term" : "Planner phase";
  const termValue = document.createElement("p");
  termValue.className = "planner-detail-metric-value";
  termValue.textContent = selectedNode.isSupplemental
    ? selectedNode.term ?? "Transcript"
    : getPlanColumnLabel(selectedNode.column);
  termMetric.append(termLabel, termValue);
  metrics.append(creditMetric, termMetric);

  const actions = document.createElement("div");
  actions.className = "planner-node-detail-actions";
  const transcript = getActiveTranscript();

  if (selectedNode.type === "choice") {
    buildChoiceNodeOptions(selectedNode).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "compare-submit-button planner-detail-toggle planner-detail-toggle-secondary";
      const isCompleted = transcript?.completedCourseCodes.includes(option.code);
      const isInProgress = transcript?.inProgressCourseCodes.includes(option.code);
      button.disabled = isCompleted || isInProgress;
      button.textContent = isCompleted
        ? `${option.code} completed`
        : isInProgress
          ? `${option.code} in progress`
          : isCodeInCart(option.code)
            ? `Remove ${option.code}`
            : `Add ${option.code}`;
      button.addEventListener("click", () => {
        if (isCompleted || isInProgress) {
          return;
        }

        if (isCodeInCart(option.code)) {
          removeFromCart(option.code);
        } else {
          addToCart(option.code, `${option.code} · ${selectedNode.title}`, "required-choice");
        }
      });
      actions.append(button);
    });
  } else {
    const primaryCode = selectedNode.code;
    const isLocked = selectedNode.state === "locked";
    const isCompleted = Boolean(selectedNode.completedCode);
    const isInProgress = Boolean(selectedNode.inProgressCode);

    if (!isCompleted && !isInProgress) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "compare-submit-button planner-detail-toggle";
      toggle.disabled = isLocked;
      toggle.textContent = isCodeInCart(primaryCode)
        ? "Remove from semester plan"
        : "Add to semester plan";
      toggle.addEventListener("click", () => {
        if (isLocked) {
          return;
        }

        if (isCodeInCart(primaryCode)) {
          removeFromCart(primaryCode);
        } else {
          addToCart(primaryCode, `${primaryCode} · ${selectedNode.title}`, "required");
        }
      });
      actions.append(toggle);
    }
  }

  elements.nodeDetail.append(header, codeLine, descriptionWrap, body, metrics, actions);
  ensureNodeDetailPosition();
}

function renderCart() {
  if (!state.cart.length) {
    elements.cartState.hidden = false;
    elements.cartList.hidden = true;
    elements.cartList.innerHTML = "";
    return;
  }

  elements.cartState.hidden = true;
  elements.cartList.hidden = false;
  elements.cartList.innerHTML = "";

  state.cart.forEach((item) => {
    const article = document.createElement("article");
    article.className = "planner-cart-item";

    const copy = document.createElement("div");
    copy.className = "planner-cart-copy";

    const code = document.createElement("p");
    code.className = "result-code";
    code.textContent = item.code;

    const title = document.createElement("p");
    title.className = "planner-cart-title";
    title.textContent = item.title;

    const source = document.createElement("p");
    source.className = "planner-cart-meta";
    source.textContent = `Source: ${item.source}`;

    copy.append(code, title, source);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "result-action-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      removeFromCart(item.code);
    });

    article.append(copy, removeButton);
    elements.cartList.append(article);
  });
}

function appendSuggestionButton(container, config) {
  const card = document.createElement("article");
  card.className = "planner-suggestion-card";

  const copy = document.createElement("div");
  copy.className = "planner-suggestion-copy";

  const code = document.createElement("p");
  code.className = "result-code";
  code.textContent = config.code;

  const title = document.createElement("p");
  title.className = "planner-suggestion-title";
  title.textContent = config.title;

  const meta = document.createElement("p");
  meta.className = "planner-suggestion-meta";
  meta.textContent = config.meta;

  copy.append(code, title, meta);

  const actions = document.createElement("div");
  actions.className = "planner-suggestion-actions";

  if (config.badge) {
    actions.append(createBadge(config.badge, config.badgeClass ?? ""));
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "result-action-button";
  toggle.textContent = isCodeInCart(config.code) ? "Remove" : "Add";
  toggle.addEventListener("click", () => {
    if (isCodeInCart(config.code)) {
      removeFromCart(config.code);
    } else {
      addToCart(config.code, `${config.code} · ${config.title}`, config.source);
    }
  });

  actions.append(toggle);
  card.append(copy, actions);
  container.append(card);
}

function renderSuggestions() {
  elements.requiredSuggestions.innerHTML = "";
  elements.electiveSuggestions.innerHTML = "";
  elements.fastTrackSuggestions.innerHTML = "";

  if (!state.evaluation) {
    return;
  }

  state.evaluation.eligibleRequiredCourses.forEach((node) => {
    if (node.type === "choice") {
      buildChoiceNodeOptions(node).forEach((option) => {
        appendSuggestionButton(elements.requiredSuggestions, {
          code: option.code,
          title: node.title,
          meta: "Required choice",
          source: "required-choice",
          badge: "Required"
        });
      });
      return;
    }

    appendSuggestionButton(elements.requiredSuggestions, {
      code: node.code,
      title: node.title,
      meta: node.missingPrereqs.length
        ? `Missing: ${node.missingPrereqs.join(", ")}`
        : "Prerequisites satisfied",
      source: "required",
      badge: "Required"
    });
  });

  state.evaluation.trackedElectiveSuggestions.forEach((course) => {
    appendSuggestionButton(elements.electiveSuggestions, {
      code: course.code,
      title: course.title,
      meta:
        course.inCart
          ? `${course.track} · Already in your semester graph`
          : course.state === "locked"
            ? `${course.track} · Missing ${course.missingPrereqs.join(", ")}`
            : course.state === "review"
              ? `${course.track} · Advisor review recommended`
              : course.missingTrackCoverage
                ? `${course.track} · Helps cover a missing track`
                : `${course.track} · Ready to consider`,
      source: "tracked-elective",
      badge: course.track,
      badgeClass: course.state === "review" ? "planner-mini-badge-warning" : ""
    });
  });

  state.evaluation.fastTrackOptions
    .filter((course) => course.state === "eligible" || course.state === "candidate")
    .slice(0, 12)
    .forEach((course) => {
      appendSuggestionButton(elements.fastTrackSuggestions, {
        code: course.graduateCode,
        title: `${course.title} ↔ ${course.undergraduateCode}`,
        meta:
          course.state === "eligible"
            ? `Fast track ready · GPA ${course.overallGpa.toFixed(3)}`
            : `Candidate only · advisor review still needed`,
        source: "fast-track",
        badge: course.state === "eligible" ? "Fast track" : "Review",
        badgeClass: course.state === "eligible" ? "planner-mini-badge-fasttrack" : "planner-mini-badge-warning"
      });
    });
}

function createScheduleFlag(text, tone = "") {
  const chip = document.createElement("span");
  chip.className = `planner-schedule-flag ${tone}`.trim();
  chip.textContent = text;
  return chip;
}

function renderScheduleBoard(schedule) {
  elements.scheduleBoard.innerHTML = "";

  const sections = schedule?.sections ?? [];
  if (!sections.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No conflict-free timetable blocks were generated for this option.";
    elements.scheduleBoard.append(empty);
    return;
  }

  const allBlocks = sections.flatMap((section) => section.meetingBlocks ?? []);
  const earliest = Math.min(
    ...allBlocks.map((block) => block.startMinutes),
    8 * 60
  );
  const latest = Math.max(
    ...allBlocks.map((block) => block.endMinutes),
    20 * 60
  );
  const displayStart = Math.floor(earliest / 30) * 30;
  const displayEnd = Math.ceil(latest / 30) * 30;
  const totalMinutes = Math.max(60, displayEnd - displayStart);

  const layout = document.createElement("div");
  layout.className = "planner-schedule-layout";

  const axis = document.createElement("div");
  axis.className = "planner-schedule-axis";
  for (let minutes = displayStart; minutes <= displayEnd; minutes += 30) {
    const label = document.createElement("span");
    label.className = "planner-schedule-axis-label";
    label.textContent = minuteLabel(minutes);
    axis.append(label);
  }
  layout.append(axis);

  const week = document.createElement("div");
  week.className = "planner-schedule-week";

  SCHEDULE_DAY_ORDER.forEach((dayLabel) => {
    const column = document.createElement("div");
    column.className = "planner-schedule-day";

    const heading = document.createElement("div");
    heading.className = "planner-schedule-day-head";
    heading.textContent = dayLabel;
    column.append(heading);

    const lanes = document.createElement("div");
    lanes.className = "planner-schedule-day-lanes";

    for (let minutes = displayStart; minutes < displayEnd; minutes += 30) {
      const row = document.createElement("div");
      row.className = "planner-schedule-grid-line";
      lanes.append(row);
    }

    const dayBlocks = sections.flatMap((section, index) =>
      (section.meetingBlocks ?? [])
        .filter((block) => block.day === dayLabel)
        .map((block) => ({
          ...block,
          section,
          toneClass: SCHEDULE_CARD_TONES[index % SCHEDULE_CARD_TONES.length]
        }))
    );

    dayBlocks.forEach((block) => {
      const node = document.createElement("article");
      node.className = `planner-schedule-class ${block.toneClass}`;
      const top = ((block.startMinutes - displayStart) / totalMinutes) * 100;
      const height = ((block.endMinutes - block.startMinutes) / totalMinutes) * 100;
      node.style.top = `${top}%`;
      node.style.height = `${Math.max(height, 5)}%`;

      const code = document.createElement("p");
      code.className = "planner-schedule-class-code";
      code.textContent = block.section.courseCode;

      const sectionMeta = document.createElement("p");
      sectionMeta.className = "planner-schedule-class-meta";
      sectionMeta.textContent = `${block.section.section} • ${block.beginTime} - ${block.endTime}`;

      const instructor = document.createElement("p");
      instructor.className = "planner-schedule-class-meta";
      instructor.textContent = block.section.instructors?.[0] ?? "Staff / TBD";

      const room = document.createElement("p");
      room.className = "planner-schedule-class-room";
      room.textContent = [block.building, block.room].filter(Boolean).join(" ") || "Location TBD";

      node.append(code, sectionMeta, instructor, room);
      lanes.append(node);
    });

    column.append(lanes);
    week.append(column);
  });

  layout.append(week);
  elements.scheduleBoard.append(layout);
}

function renderScheduleTable(schedule) {
  elements.scheduleTableBody.innerHTML = "";

  if (!schedule?.sections?.length) {
    return;
  }

  schedule.sections.forEach((section) => {
    const row = document.createElement("tr");

    const courseCell = document.createElement("td");
    courseCell.innerHTML = `<strong>${section.courseCode}</strong><br>${section.courseTitle}`;

    const crnCell = document.createElement("td");
    crnCell.textContent = section.crn;

    const sectionCell = document.createElement("td");
    sectionCell.textContent = section.section;

    const instructorCell = document.createElement("td");
    instructorCell.textContent = section.instructors?.join(", ") || "Staff / TBD";

    const modeCell = document.createElement("td");
    modeCell.textContent = section.instructionalMethod || section.scheduleType || "TBA";

    const meetingsCell = document.createElement("td");
    meetingsCell.textContent = (section.meetings ?? [])
      .map((meeting) => {
        const dayLabel = meeting.days?.length ? meeting.days.join("/") : "TBA";
        const timeLabel =
          meeting.beginTime && meeting.endTime
            ? `${meeting.beginTime} - ${meeting.endTime}`
            : "TBA";
        const roomLabel = [meeting.building, meeting.room].filter(Boolean).join(" ");
        return `${dayLabel} ${timeLabel}${roomLabel ? ` · ${roomLabel}` : ""}`;
      })
      .join(" | ");

    const statusCell = document.createElement("td");
    statusCell.textContent = section.openForRegistration ? "Open" : "Closed";

    row.append(
      courseCell,
      crnCell,
      sectionCell,
      instructorCell,
      modeCell,
      meetingsCell,
      statusCell
    );
    elements.scheduleTableBody.append(row);
  });
}

function renderScheduleRecommendation() {
  const hasPlanCourses = state.cart.length > 0;
  const schedule = getSelectedScheduleOption();
  const isStale =
    Boolean(state.scheduleRecommendation) && state.scheduleFingerprint !== getScheduleFingerprint();

  elements.scheduleOptionTabs.innerHTML = "";
  elements.scheduleMeta.innerHTML = "";
  elements.scheduleFlags.innerHTML = "";
  elements.scheduleTableBody.innerHTML = "";
  elements.scheduleBoard.innerHTML = "";
  elements.saveScheduleButton.disabled = true;
  elements.saveScheduleButton.textContent = "Favorite schedule";

  if (!hasPlanCourses) {
    elements.scheduleResult.hidden = true;
    elements.scheduleState.hidden = false;
    elements.scheduleState.textContent =
      "Add courses to the semester plan first. The schedule builder uses those courses as the timetable target.";
    return;
  }

  if (!state.scheduleRecommendation) {
    elements.scheduleResult.hidden = true;
    elements.scheduleState.hidden = false;
    elements.scheduleState.textContent =
      "Shortlist professors from Explore, then ask Planner AI for a schedule or use Build schedule here.";
    return;
  }

  elements.scheduleState.hidden = true;
  elements.scheduleResult.hidden = false;
  elements.scheduleTerm.textContent =
    state.scheduleRecommendation.targetTerm?.termDescription ?? "Upcoming term";

  state.scheduleRecommendation.schedules?.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `planner-schedule-option${option.id === schedule?.id ? " is-active" : ""}`;
    button.textContent = `${option.label} · ${option.summary.scheduledCourseCount}/${option.summary.requestedCourseCount}`;
    button.addEventListener("click", () => {
      state.selectedScheduleId = option.id;
      writePlannerStorage();
      renderScheduleRecommendation();
    });
    elements.scheduleOptionTabs.append(button);
  });

  if (!schedule) {
    elements.scheduleState.hidden = false;
    elements.scheduleState.textContent =
      state.scheduleRecommendation.unavailableCourses?.length
        ? `No schedule options were generated. ${state.scheduleRecommendation.unavailableCourses
            .slice(0, 2)
            .map((course) => `${course.code}: ${course.reason}`)
            .join(" ")}`
        : "No schedule options were generated from the current semester plan.";
    elements.scheduleResult.hidden = true;
    return;
  }

  const favoriteSchedule = buildFavoriteScheduleRecord(schedule);
  const isFavorite = favoriteSchedule ? hasFavoriteSchedule(favoriteSchedule) : false;
  elements.saveScheduleButton.disabled = false;
  elements.saveScheduleButton.textContent = isFavorite ? "Favorited schedule" : "Favorite schedule";
  elements.saveScheduleButton.classList.toggle("is-active", isFavorite);

  const metaBits = [
    `${schedule.summary.scheduledCourseCount}/${schedule.summary.requestedCourseCount} courses scheduled`,
    `${schedule.summary.totalCredits} credit hours`,
    `${schedule.summary.dayCount} class day${schedule.summary.dayCount === 1 ? "" : "s"}`,
    `${schedule.summary.earliestStartLabel} to ${schedule.summary.latestEndLabel}`
  ];

  elements.scheduleMeta.append(createTokenList(metaBits, "No schedule summary"));

  if (schedule.summary.matchedPreferenceCount > 0) {
    elements.scheduleFlags.append(
      createScheduleFlag(
        `${schedule.summary.matchedPreferenceCount} shortlisted instructor match${schedule.summary.matchedPreferenceCount === 1 ? "" : "es"}`,
        "is-preferred"
      )
    );
  }

  if (isStale) {
    elements.scheduleFlags.append(
      createScheduleFlag("Semester plan or shortlist changed. Rebuild this schedule.", "is-warning")
    );
  }

  schedule.unscheduledCourses?.forEach((course) => {
    elements.scheduleFlags.append(
      createScheduleFlag(`${course.code}: ${course.reason}`, "is-subtle")
    );
  });

  renderScheduleBoard(schedule);
  renderScheduleTable(schedule);
}

async function buildScheduleRecommendation(reason = "manual") {
  if (!state.cart.length) {
    renderScheduleRecommendation();
    return null;
  }

  setScheduleBusy(true);
  setHelper(
    elements.chatHelper,
    reason === "question"
      ? "Building a real next-term schedule from your semester plan and shortlisted professors..."
      : "Building a real next-term schedule from your semester plan..."
  );

  try {
    const response = await fetch("/api/build-schedule", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(buildSchedulePayload())
    });
    const payload = await readJsonResponse(
      response,
      "Could not build a schedule from the current semester plan."
    );

    if (!response.ok) {
      throw new Error(payload.error || "Could not build a schedule.");
    }

    state.scheduleRecommendation = payload;
    state.selectedScheduleId = payload.selectedScheduleId ?? payload.schedules?.[0]?.id ?? null;
    state.scheduleFingerprint = getScheduleFingerprint();
    setHelper(
      elements.chatHelper,
      payload.schedules?.length
        ? `Built a ${payload.targetTerm?.termDescription ?? "next-term"} schedule from live public class-search sections. Planner AI can now explain the tradeoffs.`
        : `Checked ${payload.targetTerm?.termDescription ?? "the next term"}, but no schedule options were generated from the current semester plan.`
    );
    renderScheduleRecommendation();
    writePlannerStorage();
    return payload;
  } catch (error) {
    console.error(error);
    setHelper(elements.chatHelper, error.message || "Schedule builder failed.", true);
    throw error;
  } finally {
    setScheduleBusy(false);
  }
}

function createParagraph(className, text) {
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function appendRichText(container, text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let list = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      list = null;
      return;
    }

    const bulletMatch = trimmed.match(/^[-•]\s+(.*)$/);
    if (bulletMatch) {
      if (!list) {
        list = document.createElement("ul");
        list.className = "compare-list";
        container.append(list);
      }
      const item = document.createElement("li");
      item.className = "compare-list-item";
      item.textContent = bulletMatch[1];
      list.append(item);
      return;
    }

    list = null;
    container.append(createParagraph("compare-paragraph", trimmed));
  });
}

function renderPlannerChat() {
  const transcript = getActiveTranscript();
  const hasTranscript = Boolean(transcript && state.evaluation);

  elements.chatForm.hidden = !hasTranscript;
  elements.chatState.hidden = hasTranscript && state.plannerMessages.length > 0;
  elements.chatThread.hidden = !hasTranscript || state.plannerMessages.length === 0;

  if (!hasTranscript) {
    elements.chatState.textContent =
      "Parse a transcript first, then ask the planner to build a next-semester recommendation.";
    return;
  }

  if (state.plannerMessages.length === 0) {
    elements.chatState.textContent =
      "Transcript is loaded. Ask the planner for a next-semester schedule, fast-track path, or prerequisite explanation.";
  }

  elements.chatThread.innerHTML = "";

  state.plannerMessages.forEach((message) => {
    const fragment = elements.messageTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".planner-message");
    const role = fragment.querySelector(".compare-message-role");
    const badge = fragment.querySelector(".compare-message-badge");
    const card = fragment.querySelector(".compare-message-card");

    article.classList.add(message.role === "assistant" ? "is-assistant" : "is-user");
    if (message.role === "user") {
      card.classList.add("compare-user-card", "planner-user-prompt-card");
    }
    role.textContent = message.role === "assistant" ? "Planner AI" : "You";
    badge.textContent = message.role === "assistant" ? "Degree plan" : "Prompt";
    appendRichText(card, message.text);
    elements.chatThread.append(fragment);
  });

  if (state.plannerRequestInFlight) {
    const typing = document.createElement("article");
    typing.className = "compare-message planner-message is-assistant planner-thinking-message";
    const meta = document.createElement("div");
    meta.className = "compare-message-meta";
    meta.append(
      createParagraph("compare-message-role", "Planner AI"),
      createParagraph("compare-message-badge", "Thinking")
    );
    const card = document.createElement("div");
    card.className = "compare-message-card planner-thinking-card";
    const dots = document.createElement("div");
    dots.className = "compare-typing";
    dots.innerHTML = "<span></span><span></span><span></span>";
    card.append(dots);
    typing.append(meta, card);
    elements.chatThread.append(typing);
  }

  requestAnimationFrame(() => {
    elements.chatScroll.scrollTop = elements.chatScroll.scrollHeight;
  });
}

function handleGraphPointerDown(event) {
  if (!state.evaluation || event.button !== 0) {
    return;
  }

  if (event.target.closest(".planner-node") || event.target.closest(".planner-node-detail")) {
    return;
  }

  state.graphPointerId = event.pointerId;
  state.graphPointerMoved = false;
  state.graphDragOrigin = {
    x: event.clientX,
    y: event.clientY
  };
  elements.graphCanvas.classList.add("is-panning");
  elements.graphCanvas.setPointerCapture?.(event.pointerId);
}

function handleGraphPointerMove(event) {
  if (state.graphPointerId !== event.pointerId || !state.graphDragOrigin) {
    return;
  }

  const deltaX = event.clientX - state.graphDragOrigin.x;
  const deltaY = event.clientY - state.graphDragOrigin.y;

  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    state.graphPointerMoved = true;
  }

  state.graphPanX += deltaX;
  state.graphPanY += deltaY;
  state.graphDragOrigin = {
    x: event.clientX,
    y: event.clientY
  };
  applyGraphTransform();
}

function handleGraphPointerUp(event) {
  if (state.graphPointerId !== event.pointerId) {
    return;
  }

  elements.graphCanvas.classList.remove("is-panning");
  elements.graphCanvas.releasePointerCapture?.(event.pointerId);
  const shouldClearSelection = !state.graphPointerMoved;

  state.graphPointerId = null;
  state.graphDragOrigin = null;

  if (shouldClearSelection) {
    state.selectedNodeId = null;
    renderGraph();
    renderNodeDetail();
  }
}

function handleGraphWheel(event) {
  if (!state.evaluation) {
    return;
  }

  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const canvasRect = elements.graphCanvas.getBoundingClientRect();
    zoomGraph(
      state.graphScale * (event.deltaY < 0 ? 1.08 : 0.92),
      event.clientX - canvasRect.left,
      event.clientY - canvasRect.top
    );
    return;
  }

  state.graphPanX -= event.deltaX;
  state.graphPanY -= event.deltaY;
  applyGraphTransform();
  setZoomHint();
}

async function loadDegreePlan(planId = "bs-cs-2025") {
  const response = await fetch(`/api/degree-plan?plan=${encodeURIComponent(planId)}`);
  const payload = await readJsonResponse(
    response,
    "Could not load the degree-plan data from the server."
  );

  if (!response.ok) {
    throw new Error(payload.error || "Could not load degree plan.");
  }

  state.plan = payload.plan;
  state.graphPanInitialized = false;
  state.graphScale = 1;
  elements.degreeSelect.innerHTML = "";
  payload.plans.forEach((plan) => {
    const option = document.createElement("option");
    option.value = plan.id;
    option.textContent = `${plan.title} (${plan.catalog})`;
    option.selected = plan.id === state.plan.id;
    elements.degreeSelect.append(option);
  });
}

async function handleTranscriptUpload(file) {
  setHelper(elements.ingestState, "Parsing transcript PDF...");

  try {
    const parsed = await parseTranscriptFile(file);
    state.pendingParsedTranscript = parsed;
    openTranscriptModal(parsed);
    setHelper(
      elements.ingestState,
      "Transcript parsed. Confirm the detected courses before the planner graph loads."
    );
  } catch (error) {
    console.error(error);
    setHelper(elements.ingestState, error.message || "Could not parse the transcript PDF.", true);
  }
}

async function sendPlannerQuestion(questionText) {
  const question = String(questionText ?? "").trim() || DEFAULT_PLANNER_QUESTION;
  state.plannerMessages.push({
    role: "user",
    text: question
  });
  elements.chatQuestion.value = "";
  state.plannerRequestInFlight = true;
  renderPlannerChat();
  setBusy(elements.chatSubmit, true, "Ask planner", "Thinking...");
  setHelper(elements.chatHelper, "Planner is reasoning over your transcript, graph, and eligible options.");

  if (questionRequestsSchedule(question) && state.cart.length > 0) {
    try {
      await buildScheduleRecommendation("question");
    } catch {
      // Keep going so the planner can still answer even if schedule generation fails.
    }
  }

  const payload = getCurrentPlannerPayload();
  if (!payload) {
    state.plannerRequestInFlight = false;
    setBusy(elements.chatSubmit, false, "Ask planner", "Thinking...");
    renderPlannerChat();
    return;
  }

  try {
    const response = await fetch("/api/planner-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        plannerState: payload,
        question,
        previousResponseId: state.previousResponseId
      })
    });
    const result = await readJsonResponse(response, "Planner chat failed.");

    if (!response.ok) {
      throw new Error(result.error || "Planner chat failed.");
    }

    state.previousResponseId = result.responseId ?? null;
    state.plannerMessages.push({
      role: "assistant",
      text: result.answer || "No planner answer was returned."
    });
    if (Array.isArray(result.addToGraphCodes)) {
      result.addToGraphCodes.forEach((code) => {
        if (!code || isCodeInCart(code)) {
          return;
        }
        addToCart(code, getCourseLabel(code), "planner-ai");
      });
    }
    elements.chatQuestion.value = "";
    setHelper(
      elements.chatHelper,
      Array.isArray(result.addToGraphCodes) && result.addToGraphCodes.length
        ? `Planner AI added ${result.addToGraphCodes.join(", ")} to your semester plan. Follow-ups reuse the updated planner context.`
        : "Follow-up questions reuse the same planner context and updated semester plan."
    );
  } catch (error) {
    console.error(error);
    state.plannerMessages.push({
      role: "assistant",
      text: `Planner error: ${error.message}`
    });
    setHelper(elements.chatHelper, error.message || "Planner chat failed.", true);
  } finally {
    state.plannerRequestInFlight = false;
    setBusy(elements.chatSubmit, false, "Ask planner", "Thinking...");
    renderPlannerChat();
  }
}

function attachEventListeners() {
  elements.degreeSelect.addEventListener("change", async (event) => {
    await loadDegreePlan(event.target.value);
    recomputePlannerState();
  });

  elements.transcriptFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleTranscriptUpload(file);
    }
  });

  elements.manualCourseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addManualCourse(new FormData(elements.manualCourseForm));
  });

  elements.openReviewButton.addEventListener("click", openReviewModal);
  elements.openManualButton.addEventListener("click", () => {
    openManualModal();
  });
  elements.reviewModalClose.addEventListener("click", closeReviewModal);
  elements.reviewModalDismiss.addEventListener("click", closeReviewModal);
  elements.manualModalClose.addEventListener("click", closeManualModal);
  elements.manualModalDismiss.addEventListener("click", closeManualModal);

  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.plannerRequestInFlight) {
      return;
    }
    await sendPlannerQuestion(elements.chatQuestion.value);
  });

  elements.chatQuestion.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (state.plannerRequestInFlight) {
      return;
    }
    await sendPlannerQuestion(elements.chatQuestion.value);
  });

  elements.buildScheduleButton.addEventListener("click", async () => {
    if (state.scheduleRequestInFlight) {
      return;
    }

    try {
      await buildScheduleRecommendation("manual");
    } catch {
      // Error state is already surfaced in the UI helper.
    }
  });

  elements.saveScheduleButton.addEventListener("click", () => {
    const schedule = getSelectedScheduleOption();
    const favoriteSchedule = buildFavoriteScheduleRecord(schedule);
    if (!favoriteSchedule) {
      return;
    }

    if (hasFavoriteSchedule(favoriteSchedule)) {
      removeFavoriteSchedule(favoriteSchedule);
      setHelper(elements.chatHelper, "Removed that timetable from favorite schedules.");
    } else {
      saveFavoriteSchedule(favoriteSchedule);
      setHelper(elements.chatHelper, "Saved that timetable to favorite schedules.");
    }

    renderScheduleRecommendation();
  });

  elements.toggleTranscriptRailButton.addEventListener("click", () => {
    state.transcriptRailHidden = !state.transcriptRailHidden;
    applyPlannerLayoutState();
    writePlannerStorage();
  });

  elements.toggleAssistantRailButton.addEventListener("click", () => {
    state.assistantRailHidden = !state.assistantRailHidden;
    applyPlannerLayoutState();
    writePlannerStorage();
  });

  elements.graphCanvas.addEventListener("pointerdown", handleGraphPointerDown);
  elements.graphCanvas.addEventListener("pointermove", handleGraphPointerMove);
  elements.graphCanvas.addEventListener("pointerup", handleGraphPointerUp);
  elements.graphCanvas.addEventListener("pointercancel", handleGraphPointerUp);
  elements.graphCanvas.addEventListener("wheel", handleGraphWheel, { passive: false });
  elements.zoomOutButton.addEventListener("click", () => {
    zoomGraph(state.graphScale * 0.9);
  });
  elements.zoomResetButton.addEventListener("click", () => {
    state.graphPanInitialized = false;
    state.graphScale = state.graphInitialScale || 1;
    if (state.graphLayout) {
      initializeGraphPan(state.graphLayout);
      setZoomHint();
      drawGraphEdges();
    }
  });
  elements.zoomInButton.addEventListener("click", () => {
    zoomGraph(state.graphScale * 1.1);
  });
  elements.requirementModalClose.addEventListener("click", closeRequirementModal);
  elements.requirementModalDismiss.addEventListener("click", closeRequirementModal);
  elements.transcriptConfirmButton.addEventListener("click", confirmPendingTranscript);
  elements.transcriptCancelButton.addEventListener("click", () => {
    state.pendingParsedTranscript = null;
    elements.transcriptFile.value = "";
    closeTranscriptModal();
    setHelper(elements.ingestState, "Transcript upload cancelled. Re-upload when you're ready.");
  });

  window.addEventListener("resize", () => {
    applyGraphTransform();
    setZoomHint();
    drawGraphEdges();
    applyNodeDetailPosition();
  });
  window.addEventListener("pointermove", handleNodeDetailPointerMove);
  window.addEventListener("pointerup", endNodeDetailDrag);
  window.addEventListener("pointercancel", endNodeDetailDrag);
}

async function init() {
  startSavedCourseBadgeSync();
  attachEventListeners();
  subscribeToSavedCourses(() => {
    syncCartFromSavedPlan();
    recomputePlannerState();
  });
  subscribeToCompareSources(() => {
    renderScheduleRecommendation();
    writePlannerStorage();
  });
  const persisted = readPlannerStorage();
  await loadDegreePlan(persisted?.planId ?? "bs-cs-2025");
  hydratePlannerStorage(persisted);
  applyPlannerLayoutState();
  recomputePlannerState();
}

init().catch((error) => {
  console.error(error);
  setHelper(elements.ingestState, error.message || "Could not initialize planner.", true);
});
