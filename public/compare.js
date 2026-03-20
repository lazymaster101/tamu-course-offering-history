import { startSavedCourseBadgeSync } from "./page-shell.js";
import {
  MAX_COMPARE_SOURCES,
  clearCompareSources,
  getCompareSources,
  removeCompareSource,
  subscribeToCompareSources
} from "./compare-sources.js";

const MAX_CLIENT_PDF_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_CLIENT_PDF_BYTES = 3 * 1024 * 1024;
const DEFAULT_COMPARE_HELPER =
  "The first answer can take a bit longer because PDFs need to be processed.";
const DEFAULT_FOLLOWUP_HELPER =
  "Follow-ups reuse the same model context from the first comparison.";

const state = {
  previousResponseId: null,
  lastDocuments: [],
  lastAnswer: "",
  requestInFlight: false
};

const elements = {
  compareForm: document.querySelector("#compare-form"),
  compareFiles: document.querySelector("#compare-files"),
  compareUrls: document.querySelector("#compare-urls"),
  compareQuestion: document.querySelector("#compare-question"),
  compareSubmit: document.querySelector("#compare-submit"),
  compareState: document.querySelector("#compare-state"),
  clearQueuedSources: document.querySelector("#clear-queued-sources"),
  queuedSourcesState: document.querySelector("#queued-sources-state"),
  queuedSourcesList: document.querySelector("#queued-sources-list"),
  queuedSourceTemplate: document.querySelector("#queued-source-template"),
  resultState: document.querySelector("#compare-result-state"),
  resultWrap: document.querySelector("#compare-result"),
  documents: document.querySelector("#compare-documents"),
  answer: document.querySelector("#compare-answer"),
  followupForm: document.querySelector("#compare-followup-form"),
  followupQuestion: document.querySelector("#compare-followup-question"),
  followupSubmit: document.querySelector("#compare-followup-submit"),
  followupState: document.querySelector("#compare-followup-state")
};

function setBusy(button, isBusy, idleLabel, busyLabel) {
  button.disabled = isBusy;
  button.textContent = isBusy ? busyLabel : idleLabel;
}

function setHelper(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function showResultState(message) {
  elements.resultState.hidden = false;
  elements.resultState.textContent = message;
  elements.resultWrap.hidden = true;
}

function showAnswer(answer, documents) {
  elements.resultState.hidden = true;
  elements.resultWrap.hidden = false;
  elements.answer.textContent = answer;
  elements.documents.innerHTML = "";

  documents.forEach((document) => {
    const pill = document.createElement("span");
    pill.className = "syllabus-badge is-muted";
    pill.textContent = document.label;
    elements.documents.append(pill);
  });
}

function formatQueuedSourceCourse(source) {
  return source.subject && source.courseNumber
    ? `${source.subject} ${source.courseNumber}`
    : "Queued syllabus";
}

function formatQueuedSourceMeta(source) {
  return [
    source.termDescription,
    source.sectionsLabel,
    source.instructorLabel,
    source.honorsLabel
  ]
    .filter(Boolean)
    .join(" • ");
}

function renderQueuedSources() {
  const sources = getCompareSources();
  elements.queuedSourcesList.innerHTML = "";

  if (!sources.length) {
    elements.queuedSourcesState.hidden = false;
    elements.queuedSourcesList.hidden = true;
    return;
  }

  elements.queuedSourcesState.hidden = true;
  elements.queuedSourcesList.hidden = false;

  sources.forEach((source) => {
    const fragment = elements.queuedSourceTemplate.content.cloneNode(true);
    fragment.querySelector(".compare-source-course").textContent = formatQueuedSourceCourse(source);
    fragment.querySelector(".compare-source-label").textContent = source.label;
    fragment.querySelector(".compare-source-meta").textContent = formatQueuedSourceMeta(source);
    fragment.querySelector(".compare-source-remove").addEventListener("click", () => {
      removeCompareSource(source.id);
    });
    elements.queuedSourcesList.append(fragment);
  });
}

function parseManualUrlItems() {
  const lines = elements.compareUrls.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((url, index) => ({
    sourceType: "url",
    url,
    label: `Manual URL ${index + 1}`
  }));
}

function ensurePdfFile(file) {
  const lowerName = file.name.toLowerCase();
  const looksLikePdf =
    file.type === "application/pdf" || lowerName.endsWith(".pdf");

  if (!looksLikePdf) {
    throw new Error(`Only PDF uploads are supported right now: ${file.name}`);
  }

  if (file.size > MAX_CLIENT_PDF_BYTES) {
    throw new Error(`Keep each uploaded PDF under 2 MB on hosted deployments: ${file.name}`);
  }
}

function readFileAsBase64(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result ?? "");
      resolvePromise(dataUrl.replace(/^data:[^;]+;base64,/i, ""));
    });

    reader.addEventListener("error", () => {
      rejectPromise(new Error(`Could not read file: ${file.name}`));
    });

    reader.readAsDataURL(file);
  });
}

async function buildUploadItems() {
  const files = [...elements.compareFiles.files];

  if (!files.length) {
    return [];
  }

  let totalBytes = 0;
  files.forEach((file) => {
    ensurePdfFile(file);
    totalBytes += file.size;
  });

  if (totalBytes > MAX_TOTAL_CLIENT_PDF_BYTES) {
    throw new Error("Combined uploaded PDFs must stay under 3 MB on hosted deployments.");
  }

  return Promise.all(
    files.map(async (file) => ({
      sourceType: "upload",
      filename: file.name,
      label: file.name,
      data: await readFileAsBase64(file)
    }))
  );
}

function buildQueuedItems() {
  return getCompareSources().map((source) => ({
    sourceType: "url",
    url: source.url,
    label: source.label
  }));
}

function dedupeItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key =
      item.sourceType === "url"
        ? `url::${String(item.url ?? "").trim()}`
        : `upload::${String(item.filename ?? "").trim()}::${String(item.data ?? "").length}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function buildCompareItems() {
  const queuedItems = buildQueuedItems();
  const manualUrlItems = parseManualUrlItems();
  const uploadItems = await buildUploadItems();
  const items = dedupeItems([...queuedItems, ...manualUrlItems, ...uploadItems]);

  if (items.length < 2) {
    throw new Error("Add at least two syllabus sources before comparing.");
  }

  if (items.length > MAX_COMPARE_SOURCES) {
    throw new Error(`Compare at most ${MAX_COMPARE_SOURCES} syllabi at once.`);
  }

  return items;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }

  return body;
}

function resetConversationState() {
  state.previousResponseId = null;
  state.lastDocuments = [];
  state.lastAnswer = "";
  elements.followupForm.hidden = true;
  elements.followupQuestion.value = "";
  setHelper(elements.followupState, DEFAULT_FOLLOWUP_HELPER);
}

async function handleCompareSubmit(event) {
  event.preventDefault();

  if (state.requestInFlight) {
    return;
  }

  try {
    state.requestInFlight = true;
    resetConversationState();
    setBusy(elements.compareSubmit, true, "Compare syllabi", "Comparing...");
    setHelper(elements.compareState, "Preparing sources...");

    const items = await buildCompareItems();
    const payload = await postJson("/api/compare-syllabi", {
      items,
      question: elements.compareQuestion.value.trim()
    });

    state.previousResponseId = payload.responseId ?? null;
    state.lastDocuments = payload.documents ?? [];
    state.lastAnswer = payload.answer ?? "";

    showAnswer(state.lastAnswer, state.lastDocuments);
    elements.followupForm.hidden = !state.previousResponseId;
    setHelper(
      elements.compareState,
      `Compared ${items.length} syllabus sources with ${payload.model ?? "the AI model"}.`
    );
  } catch (error) {
    showResultState(error.message);
    setHelper(elements.compareState, error.message, true);
  } finally {
    state.requestInFlight = false;
    setBusy(elements.compareSubmit, false, "Compare syllabi", "Comparing...");
  }
}

async function handleFollowupSubmit(event) {
  event.preventDefault();

  if (state.requestInFlight) {
    return;
  }

  const question = elements.followupQuestion.value.trim();

  if (!state.previousResponseId) {
    setHelper(elements.followupState, "Run an initial comparison first.", true);
    return;
  }

  if (!question) {
    setHelper(elements.followupState, "Type a follow-up question first.", true);
    return;
  }

  try {
    state.requestInFlight = true;
    setBusy(elements.followupSubmit, true, "Ask follow-up", "Asking...");
    setHelper(elements.followupState, "Running follow-up...");

    const payload = await postJson("/api/compare-syllabi", {
      previousResponseId: state.previousResponseId,
      question
    });

    state.previousResponseId = payload.responseId ?? state.previousResponseId;
    state.lastAnswer = payload.answer ?? state.lastAnswer;

    showAnswer(state.lastAnswer, state.lastDocuments);
    elements.followupQuestion.value = "";
    setHelper(elements.followupState, "Follow-up complete.");
  } catch (error) {
    setHelper(elements.followupState, error.message, true);
  } finally {
    state.requestInFlight = false;
    setBusy(elements.followupSubmit, false, "Ask follow-up", "Asking...");
  }
}

elements.compareForm.addEventListener("submit", handleCompareSubmit);
elements.followupForm.addEventListener("submit", handleFollowupSubmit);
elements.clearQueuedSources.addEventListener("click", () => {
  clearCompareSources();
});

startSavedCourseBadgeSync();
renderQueuedSources();
subscribeToCompareSources(renderQueuedSources);
showResultState("Add at least two syllabus sources, then run a comparison.");
setHelper(elements.compareState, DEFAULT_COMPARE_HELPER);
setHelper(elements.followupState, DEFAULT_FOLLOWUP_HELPER);
