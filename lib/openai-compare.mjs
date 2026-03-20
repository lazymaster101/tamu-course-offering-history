const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_COMPARE_MODEL = process.env.OPENAI_COMPARE_MODEL ?? "gpt-5.2";
const OPENAI_COMPARE_TIMEOUT_MS = 60000;
const DOCUMENT_FETCH_TIMEOUT_MS = 20000;
const MAX_COMPARE_ITEMS = 5;
const MAX_REMOTE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_UPLOADED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_UPLOADED_FILE_BYTES = 3 * 1024 * 1024;
const MAX_REMOTE_TEXT_CHARS = 180000;

function wait(delayMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

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
  return trimmed || "Compare these syllabi for workload, grading, exams, projects, attendance, and major policy differences.";
}

function normalizeLabel(label, fallback) {
  const trimmed = String(label ?? "").trim();
  return trimmed || fallback;
}

function estimateBase64Bytes(base64Value) {
  const normalized = String(base64Value ?? "")
    .trim()
    .replace(/^data:[^;]+;base64,/i, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/\t/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
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

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function resolveSourceUrl(url, requestOrigin) {
  try {
    return new URL(url, requestOrigin).toString();
  } catch {
    throw createError(`Invalid syllabus URL: ${url}`);
  }
}

async function fetchRemoteDocument(item, requestOrigin) {
  const sourceUrl = resolveSourceUrl(item.url, requestOrigin);
  const response = await fetchWithTimeout(
    sourceUrl,
    {
      redirect: "follow",
      headers: {
        "user-agent": "tamu-course-offering-history-ai-compare/1.0"
      }
    },
    DOCUMENT_FETCH_TIMEOUT_MS
  );

  if (!response.ok) {
    throw createError(`Could not fetch syllabus source: ${sourceUrl}`, 400);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const label = normalizeLabel(item.label, sourceUrl);

  if (contentType.includes("application/pdf") || sourceUrl.toLowerCase().endsWith(".pdf")) {
    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.byteLength > MAX_REMOTE_FILE_BYTES) {
      throw createError(`Remote PDF is too large for inline comparison: ${label}`, 400);
    }

    return {
      kind: "pdf",
      label,
      filename: normalizeLabel(item.filename, `${label}.pdf`),
      fileData: bytes.toString("base64")
    };
  }

  const text = htmlToText(await response.text()).slice(0, MAX_REMOTE_TEXT_CHARS);
  if (!text) {
    throw createError(`Could not extract syllabus text from: ${label}`, 400);
  }

  return {
    kind: "text",
    label,
    text
  };
}

function normalizeUploadedDocument(item, index) {
  const label = normalizeLabel(item.label, item.filename || `Uploaded syllabus ${index + 1}`);
  const fileData = String(item.data ?? "")
    .trim()
    .replace(/^data:[^;]+;base64,/i, "");

  if (!fileData) {
    throw createError(`Uploaded file is missing data: ${label}`, 400);
  }

  const fileSizeBytes = estimateBase64Bytes(fileData);

  if (fileSizeBytes > MAX_UPLOADED_FILE_BYTES) {
    throw createError(
      `Uploaded PDF is too large: ${label}. Keep each upload under ${Math.floor(
        MAX_UPLOADED_FILE_BYTES / (1024 * 1024)
      )} MB on hosted deployments.`,
      400
    );
  }

  return {
    kind: "pdf",
    label,
    filename: normalizeLabel(item.filename, `syllabus-${index + 1}.pdf`),
    fileData,
    fileSizeBytes
  };
}

async function normalizeDocuments(items, requestOrigin) {
  if (!Array.isArray(items) || items.length < 2) {
    throw createError("Provide at least two syllabus sources to compare.", 400);
  }

  if (items.length > MAX_COMPARE_ITEMS) {
    throw createError(`Compare at most ${MAX_COMPARE_ITEMS} syllabi at once.`, 400);
  }

  const normalized = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const sourceType = String(item?.sourceType ?? "").trim().toLowerCase();

    if (sourceType === "upload") {
      normalized.push(normalizeUploadedDocument(item, index));
      continue;
    }

    if (sourceType === "url") {
      normalized.push(await fetchRemoteDocument(item, requestOrigin));
      continue;
    }

    throw createError(`Unsupported syllabus source type: ${sourceType}`, 400);
  }

  const totalUploadedBytes = normalized.reduce(
    (sum, item) => sum + (item.kind === "pdf" ? item.fileSizeBytes ?? 0 : 0),
    0
  );

  if (totalUploadedBytes > MAX_TOTAL_UPLOADED_FILE_BYTES) {
    throw createError(
      `Combined uploaded PDFs are too large. Keep total uploads under ${Math.floor(
        MAX_TOTAL_UPLOADED_FILE_BYTES / (1024 * 1024)
      )} MB on hosted deployments.`,
      400
    );
  }

  return normalized;
}

function buildInitialComparisonInput(question, documents) {
  const instructions = [
    "You are a syllabus comparison assistant for college students.",
    "Use only the provided syllabus documents.",
    "If a detail is missing from a document, explicitly say 'Not stated'.",
    "Compare workload, grading, exams, quizzes, projects, attendance, deadlines, late work, and special policies.",
    "Call out meaningful differences, not generic similarities.",
    "Return plain text with these headings exactly:",
    "QUICK TAKE",
    "DOCUMENT SNAPSHOTS",
    "KEY DIFFERENCES",
    "RED FLAGS OR MISSING DETAILS",
    "BEST FIT BY STUDENT PRIORITY",
    "DIRECT ANSWER"
  ].join("\n");

  const content = [
    {
      type: "input_text",
      text: `${instructions}\n\nStudent request:\n${question}`
    }
  ];

  documents.forEach((document, index) => {
    content.push({
      type: "input_text",
      text: `Document ${index + 1} label: ${document.label}`
    });

    if (document.kind === "pdf") {
      content.push({
        type: "input_file",
        filename: document.filename,
        file_data: document.fileData
      });
      return;
    }

    content.push({
      type: "input_text",
      text: `Document ${index + 1} extracted text:\n${document.text}`
    });
  });

  return [
    {
      role: "user",
      content
    }
  ];
}

async function callOpenAiResponses(payload) {
  ensureOpenAiKey();

  const response = await fetchWithTimeout(
    `${OPENAI_API_BASE_URL}/responses`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    OPENAI_COMPARE_TIMEOUT_MS
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw createError(
      data?.error?.message || "OpenAI comparison request failed.",
      response.status
    );
  }

  return data;
}

export async function compareSyllabi({
  items,
  question,
  previousResponseId,
  requestOrigin
}) {
  const normalizedQuestion = normalizeQuestion(question);

  if (previousResponseId) {
    const payload = {
      model: OPENAI_COMPARE_MODEL,
      store: true,
      reasoning: {
        effort: "medium"
      },
      previous_response_id: previousResponseId,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: normalizedQuestion
            }
          ]
        }
      ]
    };

    const response = await callOpenAiResponses(payload);
    return {
      responseId: response.id,
      model: response.model ?? OPENAI_COMPARE_MODEL,
      answer: extractResponseText(response)
    };
  }

  const documents = await normalizeDocuments(items, requestOrigin);

  const payload = {
    model: OPENAI_COMPARE_MODEL,
    store: true,
    reasoning: {
      effort: "medium"
    },
    input: buildInitialComparisonInput(normalizedQuestion, documents)
  };

  const response = await callOpenAiResponses(payload);

  return {
    responseId: response.id,
    model: response.model ?? OPENAI_COMPARE_MODEL,
    answer: extractResponseText(response),
    documents: documents.map((document) => ({
      label: document.label,
      kind: document.kind
    }))
  };
}
