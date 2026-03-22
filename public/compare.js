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
const DEFAULT_INITIAL_COMPARE_PROMPT =
  "Compare these syllabi for workload, grading breakdown, exams, projects, attendance, late work, and which section seems easiest to manage for a student with a heavy semester.";
const DEFAULT_COMPARE_HELPER =
  "The first answer can take a bit longer because PDFs need to be processed.";
const DEFAULT_FOLLOWUP_HELPER =
  "Follow-ups reuse the same model context from the first comparison.";
const STRUCTURED_SECTION_TITLES = [
  "QUICK TAKE",
  "SCORECARDS",
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
  messages: [],
  showTyping: false
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
  statusText: document.querySelector("#compare-status-text"),
  messageTemplate: document.querySelector("#compare-message-template"),
  followupForm: document.querySelector("#compare-followup-form"),
  compareQuestionShell: document.querySelector("#compare-question-shell"),
  followupQuestionShell: document.querySelector("#compare-followup-shell"),
  followupQuestion: document.querySelector("#compare-followup-question"),
  followupSubmit: document.querySelector("#compare-followup-submit"),
  followupState: document.querySelector("#compare-followup-state")
};

function logCompareUi(event, details = {}) {
  const snapshot = {
    messageCount: state.messages.length,
    showTyping: state.showTyping,
    previousResponseId: state.previousResponseId,
    resultStateHidden: elements.resultState?.hidden ?? null,
    threadHidden: elements.thread?.hidden ?? null,
    followupHidden: elements.followupForm?.hidden ?? null,
    ...details
  };

  window.__compareUiState = snapshot;
  console.debug(COMPARE_UI_LOG_PREFIX, event, snapshot);
}

function setControlBusy(button, isBusy, busyLabel) {
  if (!button) {
    return;
  }

  button.disabled = isBusy;
  button.classList.toggle("is-busy", isBusy);

  if (busyLabel) {
    button.setAttribute("aria-label", isBusy ? busyLabel : button.dataset.idleLabel || busyLabel);
  }
}

function setHelper(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function formatMessageTimestamp() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
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

function syncStatusSubtitle() {
  if (!elements.statusText) {
    return;
  }

  const sourceCount = getCompareSources().length;

  if (state.previousResponseId) {
    const comparedCount = state.lastDocuments.length || sourceCount || 2;
    elements.statusText.textContent = `Comparing ${comparedCount} courses using Curator comparison engine.`;
    return;
  }

  if (sourceCount >= 2) {
    elements.statusText.textContent = `Comparing ${sourceCount} courses using Curator comparison engine.`;
    return;
  }

  elements.statusText.textContent = "Comparing shortlisted syllabi with the Curator comparison engine.";
}

function setTyping(isVisible) {
  state.showTyping = isVisible;
  syncStatusSubtitle();
  renderConversation();
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

function parseScorecardsSection(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const cards = [];
  let currentCard = null;

  lines.forEach((line) => {
    const categoryMatch = line.trim().match(/^Category:\s*(.+)$/i);
    if (categoryMatch) {
      currentCard = {
        title: categoryMatch[1].trim(),
        rows: []
      };
      cards.push(currentCard);
      return;
    }

    const scoreMatch = line.trim().match(/^-+\s*(Document\s+\d+|[^:]+):\s*(\d{1,3})\/100\s*[—-]\s*(.+)$/i);
    if (scoreMatch && currentCard) {
      currentCard.rows.push({
        label: scoreMatch[1].trim(),
        score: Math.max(0, Math.min(100, Number(scoreMatch[2]))),
        note: scoreMatch[3].trim()
      });
      return;
    }

    if (!line.trim()) {
      return;
    }

    if (currentCard) {
      currentCard.rows.push({
        label: "Note",
        score: null,
        note: line.trim()
      });
    }
  });

  return cards;
}

function createScoreBar(score) {
  const track = document.createElement("div");
  track.className = "compare-score-track";
  const fill = document.createElement("div");
  fill.className = "compare-score-fill";
  fill.style.width = `${Math.max(0, Math.min(100, Number(score ?? 0)))}%`;
  track.append(fill);
  return track;
}

function renderSectionBlock(section) {
  const sectionNode = document.createElement("section");
  sectionNode.className = "compare-section-card";

  const titleRow = document.createElement("div");
  titleRow.className = "compare-section-title-row";

  const title = document.createElement("h3");
  title.className = "compare-section-title";
  title.textContent = section.title === "SCORECARDS" ? "Scored Comparison" : toTitleCase(section.title);

  if (section.title === "QUICK TAKE") {
    const icon = document.createElement("div");
    icon.className = "compare-section-icon";
    icon.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>';
    titleRow.append(icon);
  }

  titleRow.append(title);
  sectionNode.append(titleRow);

  const body = document.createElement("div");
  body.className = "compare-section-body";

  if (section.title === "SCORECARDS") {
    const cards = parseScorecardsSection(section.body);
    const grid = document.createElement("div");
    grid.className = "compare-score-grid";

    cards.forEach((card) => {
      const cardNode = document.createElement("article");
      cardNode.className = "compare-score-card";
      const cardTitle = document.createElement("div");
      cardTitle.className = "compare-score-card-title";
      cardTitle.textContent = card.title;
      cardNode.append(cardTitle);

      card.rows.forEach((row) => {
        const rowNode = document.createElement("div");
        rowNode.className = "compare-score-row";

        const rowTop = document.createElement("div");
        rowTop.className = "compare-score-row-top";
        const label = document.createElement("span");
        label.className = "compare-score-label";
        label.textContent = row.label;
        rowTop.append(label);

        if (Number.isFinite(row.score)) {
          const score = document.createElement("span");
          score.className = "compare-score-value";
          score.textContent = `${row.score}/100`;
          rowTop.append(score);
        }

        rowNode.append(rowTop);

        if (Number.isFinite(row.score)) {
          rowNode.append(createScoreBar(row.score));
        }

        const note = document.createElement("p");
        note.className = "compare-score-note";
        note.textContent = row.note;
        rowNode.append(note);

        cardNode.append(rowNode);
      });

      grid.append(cardNode);
    });

    body.append(grid);
  } else if (section.title === "DOCUMENT SNAPSHOTS") {
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

function toTitleCase(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

  const quickTake = structured.sections.find((section) => section.title === "QUICK TAKE");
  const scorecards = structured.sections.find((section) => section.title === "SCORECARDS");
  const remainingSections = structured.sections.filter(
    (section) => section.title !== "QUICK TAKE" && section.title !== "SCORECARDS"
  );

  if (quickTake) {
    card.append(renderSectionBlock(quickTake));
  }

  if (scorecards) {
    card.append(renderSectionBlock(scorecards));
  }

  remainingSections.forEach((section) => {
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
    const avatar = document.createElement("div");
    avatar.className = "compare-ai-avatar";
    avatar.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>';
    article.prepend(avatar);
    card.append(renderAssistantMessageCard(message));
  }

  elements.thread.append(fragment);
}

function renderTypingMessage() {
  const message = document.createElement("article");
  message.className = "compare-message is-assistant is-thinking";

  const avatar = document.createElement("div");
  avatar.className = "compare-ai-avatar";
  avatar.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>';

  const bubble = document.createElement("div");
  bubble.className = "compare-message-card compare-thinking-card";

  const dots = document.createElement("div");
  dots.className = "compare-typing";
  dots.setAttribute("aria-label", "AI is thinking");
  dots.setAttribute("aria-live", "polite");

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.className = "compare-typing-dot";
    dots.append(dot);
  }

  bubble.append(dots);
  message.append(avatar, bubble);
  elements.thread.append(message);
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
  if (state.showTyping) {
    renderTypingMessage();
  }
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
    : "Shortlisted syllabus";
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
  syncStatusSubtitle();

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
  state.showTyping = false;
  logCompareUi("reset-conversation");
  elements.compareQuestionShell.hidden = false;
  elements.followupQuestionShell.hidden = true;
  elements.followupSubmit.setAttribute("form", "compare-form");
  elements.followupSubmit.dataset.idleLabel = "Compare shortlisted syllabi";
  elements.followupSubmit.setAttribute("aria-label", "Compare shortlisted syllabi");
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
    setControlBusy(elements.compareSubmit, true, "Adding syllabus source");
    setControlBusy(elements.followupSubmit, true, "Comparing shortlisted syllabi");
    setHelper(elements.compareState, "Preparing sources...");

    const items = await buildCompareItems();
    const prompt = elements.compareQuestion.value.trim();
    const displayPrompt = prompt || DEFAULT_INITIAL_COMPARE_PROMPT;
    elements.compareQuestion.value = "";

    addMessage({
      role: "user",
      badge: "Initial compare",
      content: displayPrompt,
      meta: `Sent ${formatMessageTimestamp()}`
    });
    setTyping(true);

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
    setTyping(false);

    addMessage({
      role: "assistant",
      badge: payload.model ?? "AI model",
      content: payload.answer ?? "",
      documents: state.lastDocuments
    });

    elements.compareQuestionShell.hidden = Boolean(state.previousResponseId);
    elements.followupQuestionShell.hidden = !state.previousResponseId;
    elements.followupSubmit.removeAttribute("form");
    elements.followupSubmit.dataset.idleLabel = "Ask follow-up";
    elements.followupSubmit.setAttribute("aria-label", "Ask follow-up");
    logCompareUi("compare-finished", {
      compareStateText: elements.compareState.textContent
    });
    setHelper(
      elements.compareState,
      `Compared ${items.length} syllabus sources with ${payload.model ?? "the AI model"}.`
    );
  } catch (error) {
    setTyping(false);
    logCompareUi("compare-error", { errorMessage: error.message });
    addMessage({
      role: "assistant",
      badge: "Error",
      content: error.message
    });
    setHelper(elements.compareState, error.message, true);
  } finally {
    state.requestInFlight = false;
    setControlBusy(elements.compareSubmit, false, "Add syllabus source");
    setControlBusy(elements.followupSubmit, false, state.previousResponseId ? "Ask follow-up" : "Compare shortlisted syllabi");
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
    setControlBusy(elements.compareSubmit, true, "Adding syllabus source");
    setControlBusy(elements.followupSubmit, true, "Asking follow-up");
    setHelper(elements.followupState, "Running follow-up...");
    elements.followupQuestion.value = "";

    addMessage({
      role: "user",
      badge: "Follow-up",
      content: question,
      meta: `Sent ${formatMessageTimestamp()}`
    });
    setTyping(true);

    const payload = await postJson("/api/compare-syllabi", {
      previousResponseId: state.previousResponseId,
      question
    });
    logCompareUi("followup-response", {
      payloadModel: payload.model ?? null,
      payloadAnswerLength: typeof payload.answer === "string" ? payload.answer.length : null
    });

    state.previousResponseId = payload.responseId ?? state.previousResponseId;
    setTyping(false);

    addMessage({
      role: "assistant",
      badge: payload.model ?? "AI model",
      content: payload.answer ?? "",
      documents: state.lastDocuments
    });

    setHelper(elements.followupState, "Follow-up complete.");
  } catch (error) {
    setTyping(false);
    logCompareUi("followup-error", { errorMessage: error.message });
    addMessage({
      role: "assistant",
      badge: "Error",
      content: error.message
    });
    setHelper(elements.followupState, error.message, true);
  } finally {
    state.requestInFlight = false;
    setControlBusy(elements.compareSubmit, false, "Add syllabus source");
    setControlBusy(elements.followupSubmit, false, "Ask follow-up");
  }
}

function handleEnterToSubmit(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

elements.compareForm.addEventListener("submit", handleCompareSubmit);
elements.followupForm.addEventListener("submit", handleFollowupSubmit);
elements.compareQuestion.addEventListener("keydown", handleEnterToSubmit);
elements.followupQuestion.addEventListener("keydown", handleEnterToSubmit);
elements.clearQueuedSources.addEventListener("click", () => {
  clearCompareSources();
});
elements.compareSubmit.addEventListener("click", () => {
  elements.compareFiles.click();
});

startSavedCourseBadgeSync();
renderQueuedSources();
subscribeToCompareSources(renderQueuedSources);
renderConversation();
setHelper(elements.compareState, DEFAULT_COMPARE_HELPER);
setHelper(elements.followupState, DEFAULT_FOLLOWUP_HELPER);
elements.compareQuestionShell.hidden = false;
elements.followupQuestionShell.hidden = true;
elements.followupSubmit.setAttribute("form", "compare-form");
elements.followupSubmit.setAttribute("aria-label", "Compare shortlisted syllabi");
elements.compareSubmit.dataset.idleLabel = "Add syllabus source";
elements.followupSubmit.dataset.idleLabel = "Compare shortlisted syllabi";
logCompareUi("boot");
