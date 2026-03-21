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
const STRUCTURED_SECTION_TITLES = [
  "QUICK TAKE",
  "DOCUMENT SNAPSHOTS",
  "KEY DIFFERENCES",
  "RED FLAGS OR MISSING DETAILS",
  "BEST FIT BY STUDENT PRIORITY",
  "DIRECT ANSWER"
];
const COMPARE_UI_LOG_PREFIX = "[compare-ui]";

const state = {
  previousResponseId: null,
  lastDocuments: [],
  requestInFlight: false,
  messages: []
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
  thread: document.querySelector("#compare-thread"),
  typing: document.querySelector("#compare-typing"),
  statusText: document.querySelector("#compare-status-text"),
  messageTemplate: document.querySelector("#compare-message-template"),
  followupForm: document.querySelector("#compare-followup-form"),
  followupQuestion: document.querySelector("#compare-followup-question"),
  followupSubmit: document.querySelector("#compare-followup-submit"),
  followupState: document.querySelector("#compare-followup-state")
};

function logCompareUi(event, details = {}) {
  const snapshot = {
    messageCount: state.messages.length,
    previousResponseId: state.previousResponseId,
    resultStateHidden: elements.resultState?.hidden ?? null,
    threadHidden: elements.thread?.hidden ?? null,
    followupHidden: elements.followupForm?.hidden ?? null,
    ...details
  };

  window.__compareUiState = snapshot;
  console.debug(COMPARE_UI_LOG_PREFIX, event, snapshot);
}

function setBusy(button, isBusy, idleLabel, busyLabel) {
  button.disabled = isBusy;
  button.textContent = isBusy ? busyLabel : idleLabel;
}

function setHelper(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function showEmptyTranscript(message) {
  elements.resultState.hidden = false;
  elements.resultState.textContent = message;
  elements.thread.hidden = true;
  logCompareUi("show-empty", { message });
}

function showTranscript() {
  elements.resultState.hidden = true;
  elements.thread.hidden = false;
  logCompareUi("show-thread");
}

function setTyping(isVisible, message) {
  elements.typing.hidden = !isVisible;

  if (!elements.statusText) {
    return;
  }

  if (isVisible) {
    elements.statusText.textContent = message || "Reading syllabi and building the comparison.";
    return;
  }

  elements.statusText.textContent = state.previousResponseId
    ? "Comparison context is loaded and ready for follow-up questions."
    : "Ready for a new syllabus comparison.";
}

function scrollThreadToBottom() {
  requestAnimationFrame(() => {
    elements.thread.scrollTop = elements.thread.scrollHeight;
  });
}

function createTextWithLabel(className, text) {
  const paragraph = document.createElement("p");
  paragraph.className = className;

  const labelMatch = String(text ?? "").match(/^([^:]{1,48}):\s+(.+)$/);
  if (!labelMatch) {
    paragraph.textContent = text;
    return paragraph;
  }

  const label = document.createElement("strong");
  label.textContent = `${labelMatch[1]}: `;
  paragraph.append(label, document.createTextNode(labelMatch[2]));
  return paragraph;
}

function appendRichText(container, text, baseClassName = "compare-paragraph") {
  const lines = String(text ?? "").split(/\r?\n/);
  const listStack = [];

  function closeListsToDepth(targetDepth) {
    while (listStack.length > targetDepth) {
      listStack.pop();
    }
  }

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      closeListsToDepth(0);
      return;
    }

    const bulletMatch = line.match(/^(\s*)[-•]\s+(.*)$/);
    if (bulletMatch) {
      const indentDepth = Math.floor(bulletMatch[1].length / 2);
      closeListsToDepth(indentDepth);

      let currentList = listStack[indentDepth];
      if (!currentList) {
        currentList = document.createElement("ul");
        currentList.className = "compare-list";

        if (indentDepth === 0) {
          container.append(currentList);
        } else {
          const parentListItem = listStack[indentDepth - 1]?.lastElementChild;
          if (!parentListItem) {
            container.append(currentList);
          } else {
            parentListItem.append(currentList);
          }
        }

        listStack[indentDepth] = currentList;
      }

      const item = document.createElement("li");
      item.className = "compare-list-item";
      item.append(createTextWithLabel("compare-list-line", bulletMatch[2].trim()));
      currentList.append(item);
      return;
    }

    closeListsToDepth(0);
    container.append(createTextWithLabel(baseClassName, trimmed));
  });
}

function parseStructuredAnswer(answer) {
  const lines = String(answer ?? "").split(/\r?\n/);
  const sections = [];
  let currentTitle = null;
  let currentLines = [];
  let introLines = [];

  function flushSection() {
    if (!currentTitle) {
      return;
    }

    sections.push({
      title: currentTitle,
      body: currentLines.join("\n").trim()
    });
    currentLines = [];
  }

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (STRUCTURED_SECTION_TITLES.includes(trimmed)) {
      flushSection();
      currentTitle = trimmed;
      return;
    }

    if (!currentTitle) {
      introLines.push(line);
      return;
    }

    currentLines.push(line);
  });

  flushSection();

  return {
    intro: introLines.join("\n").trim(),
    sections
  };
}

function parseDocumentSnapshotsSection(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const cards = [];
  let currentCard = null;

  lines.forEach((line) => {
    const topLevelMatch = line.match(/^- (.+)$/);
    const nestedMatch = line.match(/^\s+[-•]\s+(.+)$/);

    if (topLevelMatch) {
      currentCard = {
        title: topLevelMatch[1].trim(),
        details: []
      };
      cards.push(currentCard);
      return;
    }

    if (nestedMatch && currentCard) {
      currentCard.details.push(nestedMatch[1].trim());
      return;
    }

    if (!line.trim()) {
      return;
    }

    if (currentCard) {
      currentCard.details.push(line.trim());
      return;
    }

    cards.push({
      title: line.trim(),
      details: []
    });
  });

  return cards;
}

function renderSectionBlock(section) {
  const sectionNode = document.createElement("section");
  sectionNode.className = "compare-section-card";

  const heading = document.createElement("div");
  heading.className = "compare-section-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "section-kicker";
  eyebrow.textContent = "AI Section";
  const title = document.createElement("h3");
  title.className = "compare-section-title";
  title.textContent = section.title;
  heading.append(eyebrow, title);
  sectionNode.append(heading);

  const body = document.createElement("div");
  body.className = "compare-section-body";

  if (section.title === "DOCUMENT SNAPSHOTS") {
    const cards = parseDocumentSnapshotsSection(section.body);
    const grid = document.createElement("div");
    grid.className = "compare-document-grid";

    cards.forEach((card) => {
      const cardNode = document.createElement("article");
      cardNode.className = "compare-document-card";
      const cardTitle = document.createElement("h4");
      cardTitle.className = "compare-document-title";
      cardTitle.textContent = card.title;
      cardNode.append(cardTitle);

      if (card.details.length) {
        appendRichText(cardNode, card.details.map((detail) => `- ${detail}`).join("\n"));
      }

      grid.append(cardNode);
    });

    body.append(grid);
  } else {
    appendRichText(body, section.body);
  }

  sectionNode.append(body);

  if (section.title === "QUICK TAKE") {
    sectionNode.classList.add("is-summary");
  }

  if (section.title === "DIRECT ANSWER") {
    sectionNode.classList.add("is-accent");
  }

  return sectionNode;
}

function renderAssistantMessageCard(message) {
  const card = document.createElement("div");
  card.className = "compare-assistant-response";

  if (message.documents?.length) {
    const documents = document.createElement("div");
    documents.className = "compare-document-list";
    message.documents.forEach((item) => {
      const pill = document.createElement("span");
      pill.className = "syllabus-badge is-muted";
      pill.textContent = item.label;
      documents.append(pill);
    });
    card.append(documents);
  }

  const structured = parseStructuredAnswer(message.content);
  if (structured.sections.length && structured.intro) {
    const intro = document.createElement("div");
    intro.className = "compare-message-intro";
    appendRichText(intro, structured.intro);
    card.append(intro);
  }

  if (!structured.sections.length) {
    const fallback = document.createElement("div");
    fallback.className = "compare-response";
    appendRichText(fallback, message.content);
    card.append(fallback);
    return card;
  }

  structured.sections.forEach((section) => {
    card.append(renderSectionBlock(section));
  });

  return card;
}

function renderMessage(message) {
  const fragment = elements.messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".compare-message");
  const role = fragment.querySelector(".compare-message-role");
  const badge = fragment.querySelector(".compare-message-badge");
  const card = fragment.querySelector(".compare-message-card");

  article.classList.add(message.role === "user" ? "is-user" : "is-assistant");
  role.textContent = message.role === "user" ? "You" : "Compare AI";
  badge.textContent = message.badge ?? (message.role === "user" ? "Prompt" : "Response");

  if (message.role === "user") {
    card.classList.add("compare-user-card");
    appendRichText(card, message.content);
    if (message.meta) {
      const meta = document.createElement("p");
      meta.className = "compare-message-note";
      meta.textContent = message.meta;
      card.append(meta);
    }
  } else {
    card.append(renderAssistantMessageCard(message));
  }

  elements.thread.append(fragment);
}

function renderConversation() {
  elements.thread.innerHTML = "";
  logCompareUi("render-start");

  if (!state.messages.length) {
    showEmptyTranscript("Add at least two syllabus sources, then run a comparison.");
    return;
  }

  showTranscript();
  state.messages.forEach(renderMessage);
  logCompareUi("render-finish", { renderedMessages: elements.thread.children.length });
  scrollThreadToBottom();
}

function addMessage(message) {
  state.messages.push(message);
  logCompareUi("add-message", {
    addedRole: message.role,
    addedBadge: message.badge ?? null,
    answerLength: typeof message.content === "string" ? message.content.length : null
  });
  renderConversation();
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
  const looksLikePdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");

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
  state.messages = [];
  logCompareUi("reset-conversation");
  elements.followupForm.hidden = true;
  elements.followupQuestion.value = "";
  setTyping(false);
  setHelper(elements.followupState, DEFAULT_FOLLOWUP_HELPER);
  renderConversation();
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
    const prompt = elements.compareQuestion.value.trim();

    addMessage({
      role: "user",
      badge: "Initial compare",
      content: prompt,
      meta: `${items.length} syllabus sources queued for this comparison.`
    });
    setTyping(true, "Reading syllabi and building the comparison.");

    const payload = await postJson("/api/compare-syllabi", {
      items,
      question: prompt
    });
    logCompareUi("compare-response", {
      payloadModel: payload.model ?? null,
      payloadAnswerLength: typeof payload.answer === "string" ? payload.answer.length : null,
      payloadDocumentCount: Array.isArray(payload.documents) ? payload.documents.length : null
    });

    state.previousResponseId = payload.responseId ?? null;
    state.lastDocuments = payload.documents ?? [];

    addMessage({
      role: "assistant",
      badge: payload.model ?? "AI model",
      content: payload.answer ?? "",
      documents: state.lastDocuments
    });

    elements.followupForm.hidden = !state.previousResponseId;
    logCompareUi("compare-finished", {
      compareStateText: elements.compareState.textContent
    });
    setHelper(
      elements.compareState,
      `Compared ${items.length} syllabus sources with ${payload.model ?? "the AI model"}.`
    );
  } catch (error) {
    logCompareUi("compare-error", { errorMessage: error.message });
    addMessage({
      role: "assistant",
      badge: "Error",
      content: error.message
    });
    setHelper(elements.compareState, error.message, true);
  } finally {
    setTyping(false);
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

    addMessage({
      role: "user",
      badge: "Follow-up",
      content: question
    });
    setTyping(true, "Thinking through the follow-up against the saved comparison context.");

    const payload = await postJson("/api/compare-syllabi", {
      previousResponseId: state.previousResponseId,
      question
    });
    logCompareUi("followup-response", {
      payloadModel: payload.model ?? null,
      payloadAnswerLength: typeof payload.answer === "string" ? payload.answer.length : null
    });

    state.previousResponseId = payload.responseId ?? state.previousResponseId;

    addMessage({
      role: "assistant",
      badge: payload.model ?? "AI model",
      content: payload.answer ?? "",
      documents: state.lastDocuments
    });

    elements.followupQuestion.value = "";
    setHelper(elements.followupState, "Follow-up complete.");
  } catch (error) {
    logCompareUi("followup-error", { errorMessage: error.message });
    addMessage({
      role: "assistant",
      badge: "Error",
      content: error.message
    });
    setHelper(elements.followupState, error.message, true);
  } finally {
    setTyping(false);
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
renderConversation();
setHelper(elements.compareState, DEFAULT_COMPARE_HELPER);
setHelper(elements.followupState, DEFAULT_FOLLOWUP_HELPER);
logCompareUi("boot");
