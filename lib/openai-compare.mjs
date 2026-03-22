import { request as httpsRequest } from "node:https";

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue == null || String(rawValue).trim() === "") {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(rawValue).trim(), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1";
const HOWDY_BASE_URL = process.env.HOWDY_BASE_URL ?? "https://howdy.tamu.edu";
const OPENAI_COMPARE_MODEL = process.env.OPENAI_COMPARE_MODEL ?? "gpt-5-mini";
const OPENAI_COMPARE_TIMEOUT_MS = readPositiveIntegerEnv("OPENAI_COMPARE_TIMEOUT_MS", 180000);
const DOCUMENT_FETCH_TIMEOUT_MS = readPositiveIntegerEnv("DOCUMENT_FETCH_TIMEOUT_MS", 45000);
const DOCUMENT_FETCH_REQUEST_RETRIES = 1;
const DOCUMENT_FETCH_RETRY_DELAY_MS = 300;
const SYLLABUS_INFO_TIMEOUT_MS = 2500;
const SYLLABUS_INFO_REQUEST_RETRIES = 1;
const SYLLABUS_INFO_RETRY_DELAY_MS = 200;
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

function toPdfDataUrl(base64Value) {
  const normalized = String(base64Value ?? "")
    .trim()
    .replace(/^data:[^;]+;base64,/i, "");
  return `data:application/pdf;base64,${normalized}`;
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

function buildSimpleSyllabusUrl(termCode, crn) {
  return `https://tamu.simplesyllabus.com/ui/syllabus-redirect?type=html&attribute[4]=${encodeURIComponent(
    crn
  )}.${encodeURIComponent(termCode)}`;
}

function buildLegacyPublicSyllabusPdfUrl(termCode, crn) {
  return `${HOWDY_BASE_URL}/main/api/class-search/syllabus-pdf?crn=${encodeURIComponent(
    crn
  )}&term=${encodeURIComponent(termCode)}`;
}

function isValidLegacyLinkTarget(linkUrl) {
  if (!linkUrl) {
    return false;
  }

  try {
    const parsed = new URL(linkUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
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

function shouldRetryDocumentFetch(error, attempt) {
  const statusCode = error.statusCode ?? 0;
  return (
    attempt < DOCUMENT_FETCH_REQUEST_RETRIES &&
    (statusCode === 0 || statusCode === 429 || statusCode === 504 || statusCode >= 500)
  );
}

async function fetchWithTimeout(url, options, timeoutMs, timeoutMessage) {
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
        timeoutMessage ?? `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        504
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isHowdySource(sourceUrl) {
  try {
    const parsedSource = new URL(sourceUrl);
    const parsedHowdy = new URL(HOWDY_BASE_URL);
    return parsedSource.origin === parsedHowdy.origin;
  } catch {
    return false;
  }
}

async function fetchRemoteBodyRaw(sourceUrl, timeoutMs = DOCUMENT_FETCH_TIMEOUT_MS, redirectCount = 0) {
  if (redirectCount > 4) {
    throw createError(`Too many redirects while fetching syllabus source: ${sourceUrl}`, 400);
  }

  const targetUrl = new URL(sourceUrl);

  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpsRequest(
      targetUrl,
      {
        method: "GET",
        headers: {
          accept: "application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          connection: "close",
          "user-agent": "tamu-course-offering-history-ai-compare/1.0"
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const locationHeader = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && locationHeader) {
          response.resume();
          resolvePromise(
            fetchRemoteBodyRaw(new URL(locationHeader, targetUrl).toString(), timeoutMs, redirectCount + 1)
          );
          return;
        }

        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const body = Buffer.concat(chunks);

          if (statusCode < 200 || statusCode >= 300) {
            const error = createError(
              `Could not fetch syllabus source: ${sourceUrl} (${statusCode})`,
              statusCode
            );
            rejectPromise(error);
            return;
          }

          resolvePromise({
            url: targetUrl.toString(),
            contentType: String(response.headers["content-type"] ?? ""),
            body
          });
        });

        response.on("error", rejectPromise);
      }
    );

    request.setTimeout(timeoutMs, () => {
      rejectPromise(
        createError(`Fetching syllabus content timed out for ${sourceUrl}.`, 504)
      );
      request.destroy();
    });

    request.on("error", rejectPromise);
    request.end();
  });
}

async function fetchRemoteBody(sourceUrl) {
  for (let attempt = 0; attempt <= DOCUMENT_FETCH_REQUEST_RETRIES; attempt += 1) {
    try {
      if (isHowdySource(sourceUrl)) {
        return await fetchRemoteBodyRaw(sourceUrl);
      }

      const response = await fetchWithTimeout(
        sourceUrl,
        {
          redirect: "follow",
          headers: {
            "user-agent": "tamu-course-offering-history-ai-compare/1.0"
          }
        },
        DOCUMENT_FETCH_TIMEOUT_MS,
        `Fetching syllabus content timed out for ${sourceUrl}.`
      );

      if (!response.ok) {
        throw createError(
          `Could not fetch syllabus source: ${sourceUrl} (${response.status})`,
          response.status
        );
      }

      return {
        url: response.url || sourceUrl,
        contentType: response.headers.get("content-type") ?? "",
        body: Buffer.from(await response.arrayBuffer())
      };
    } catch (error) {
      if (!shouldRetryDocumentFetch(error, attempt)) {
        throw error;
      }

      await wait(DOCUMENT_FETCH_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

async function fetchJsonWithRetry(url, options, timeoutMs, retries, retryDelayMs) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      if (!response.ok) {
        const error = createError(
          `Request failed with ${response.status} for ${url}`,
          response.status
        );
        throw error;
      }

      return await response.json();
    } catch (error) {
      const canRetry = attempt < retries && ((error.statusCode ?? 0) >= 500 || (error.statusCode ?? 0) === 0);

      if (!canRetry) {
        throw error;
      }

      await wait(retryDelayMs * (attempt + 1));
    }
  }
}

function resolveSourceUrl(url, requestOrigin) {
  try {
    return new URL(url, requestOrigin).toString();
  } catch {
    throw createError(`Invalid syllabus URL: ${url}`);
  }
}

async function resolveInternalSyllabusUrl(sourceUrl, requestOrigin) {
  const parsedSource = new URL(sourceUrl);
  const parsedOrigin = new URL(requestOrigin);

  if (parsedSource.origin !== parsedOrigin.origin) {
    return sourceUrl;
  }

  if (parsedSource.pathname === "/api/course-syllabus-pdf") {
    const termCode = parsedSource.searchParams.get("term")?.trim();
    const crn = parsedSource.searchParams.get("crn")?.trim();

    if (termCode && crn) {
      return buildLegacyPublicSyllabusPdfUrl(termCode, crn);
    }

    return sourceUrl;
  }

  if (parsedSource.pathname !== "/api/open-syllabus") {
    return sourceUrl;
  }

  const termCode = parsedSource.searchParams.get("term")?.trim();
  const crn = parsedSource.searchParams.get("crn")?.trim();

  if (!termCode || !crn) {
    return sourceUrl;
  }

  if (Number(termCode) >= 202631) {
    return buildSimpleSyllabusUrl(termCode, crn);
  }

  const fallbackUrl = buildLegacyPublicSyllabusPdfUrl(termCode, crn);

  try {
    const syllabusInfo = await fetchJsonWithRetry(
      `${HOWDY_BASE_URL}/api/course-syllabus-info?termCode=${encodeURIComponent(
        termCode
      )}&crn=${encodeURIComponent(crn)}`,
      {
        headers: {
          accept: "application/json",
          "user-agent": "tamu-course-offering-history-ai-compare/1.0"
        }
      },
      SYLLABUS_INFO_TIMEOUT_MS,
      SYLLABUS_INFO_REQUEST_RETRIES,
      SYLLABUS_INFO_RETRY_DELAY_MS
    );

    if (
      syllabusInfo.SWRFASY_SEL_TYPE === "L" &&
      isValidLegacyLinkTarget(syllabusInfo.SWRFASY_URL_LINK)
    ) {
      return syllabusInfo.SWRFASY_URL_LINK;
    }

    return fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

async function fetchRemoteDocument(item, requestOrigin) {
  const sourceUrl = await resolveInternalSyllabusUrl(
    resolveSourceUrl(item.url, requestOrigin),
    requestOrigin
  );
  const remoteDocument = await fetchRemoteBody(sourceUrl);
  const contentType = remoteDocument.contentType;
  const label = normalizeLabel(item.label, remoteDocument.url || sourceUrl);

  if (contentType.includes("application/pdf") || sourceUrl.toLowerCase().endsWith(".pdf")) {
    const bytes = remoteDocument.body;

    if (bytes.byteLength > MAX_REMOTE_FILE_BYTES) {
      throw createError(`Remote PDF is too large for inline comparison: ${label}`, 400);
    }

    return {
      kind: "pdf",
      label,
      filename: normalizeLabel(item.filename, `${label}.pdf`),
      fileData: toPdfDataUrl(bytes.toString("base64"))
    };
  }

  const text = htmlToText(remoteDocument.body.toString("utf8")).slice(0, MAX_REMOTE_TEXT_CHARS);
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
    fileData: toPdfDataUrl(fileData),
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
    "For each comparison, invent grounded relative scores from 0 to 100 for the most decision-useful categories based only on the evidence in the syllabi.",
    "Each scorecard category must compare both documents side by side and reflect a real syllabus decision area, not a vague vibe.",
    "Always include a SCORECARDS section immediately after QUICK TAKE.",
    "In SCORECARDS, use this exact plain-text pattern for each category:",
    "Category: Workload Velocity",
    "- Document 1: 82/100 — short evidence-based explanation",
    "- Document 2: 61/100 — short evidence-based explanation",
    "Include 4 to 6 categories total.",
    "Prefer categories like Workload Velocity, Grading Flexibility, Attendance Burden, Late Work Flexibility, Project Intensity, Exam Pressure, and Heavy-Semester Friendliness when supported.",
    "Return plain text with these headings exactly:",
    "QUICK TAKE",
    "SCORECARDS",
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
    OPENAI_COMPARE_TIMEOUT_MS,
    "The AI comparison took too long. Try comparing fewer syllabi, shortening the prompt, or increasing OPENAI_COMPARE_TIMEOUT_MS in your .env."
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
