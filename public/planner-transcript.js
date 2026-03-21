import { parseDegreePlanText, parseTranscriptText } from "./planner-transcript-parser.js";

const PDFJS_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs";
const PDFJS_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";

let pdfJsPromise = null;

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_MODULE_URL).then((module) => {
      module.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return module;
    });
  }

  return pdfJsPromise;
}

function normalizePdfItemsRows(items) {
  const positionedItems = items
    .map((item) => ({
      x: item.transform[4],
      y: item.transform[5],
      text: String(item.str ?? "").trim()
    }))
    .filter((item) => item.text);

  if (!positionedItems.length) {
    return "";
  }

  const rows = [];
  const sortedItems = [...positionedItems].sort((left, right) => {
    const yDiff = right.y - left.y;
    if (Math.abs(yDiff) > 2) {
      return yDiff;
    }
    return left.x - right.x;
  });

  for (const item of sortedItems) {
    const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= 2);

    if (existingRow) {
      existingRow.items.push(item);
      continue;
    }

    rows.push({
      y: item.y,
      items: [item]
    });
  }

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) =>
      row.items
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

function normalizePdfItemsColumns(items) {
  const positionedItems = items
    .map((item) => ({
      x: item.transform[4],
      y: item.transform[5],
      text: String(item.str ?? "").trim()
    }))
    .filter((item) => item.text);

  if (!positionedItems.length) {
    return "";
  }

  const minX = Math.min(...positionedItems.map((item) => item.x));
  const maxX = Math.max(...positionedItems.map((item) => item.x));
  const splitX = minX + (maxX - minX) / 2;
  const gutter = Math.max(36, (maxX - minX) * 0.08);
  const leftItems = positionedItems.filter((item) => item.x < splitX - gutter / 2);
  const rightItems = positionedItems.filter((item) => item.x >= splitX - gutter / 2);

  const rowsToLines = (columnItems) => {
    const rows = [];
    const sortedItems = [...columnItems].sort((left, right) => {
      const yDiff = right.y - left.y;
      if (Math.abs(yDiff) > 1.5) {
        return yDiff;
      }
      return left.x - right.x;
    });

    for (const item of sortedItems) {
      const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= 1.5);

      if (existingRow) {
        existingRow.items.push(item);
        continue;
      }

      rows.push({
        y: item.y,
        items: [item]
      });
    }

    return rows
      .sort((left, right) => right.y - left.y)
      .map((row) =>
        row.items
          .sort((left, right) => left.x - right.x)
          .map((item) => item.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);
  };

  return [...rowsToLines(leftItems), ...rowsToLines(rightItems)].join("\n");
}

function scoreParsedPayload(parsed) {
  return (
    (parsed.completedCourses?.length ?? 0) * 3 +
    (parsed.inProgressCourses?.length ?? 0) * 2 +
    (parsed.courses?.length ?? 0)
  );
}

function mergeParsedPayloads(primary, secondary) {
  const bySignature = new Map();

  for (const course of [...(primary.courses ?? []), ...(secondary.courses ?? [])]) {
    const signature = [
      course.term,
      course.code,
      course.status,
      course.sourceType
    ].join("|");
    const existing = bySignature.get(signature);

    if (!existing) {
      bySignature.set(signature, course);
      continue;
    }

    const existingScore =
      Number(Boolean(existing.grade)) +
      Number(Boolean(existing.credits)) +
      String(existing.title ?? "").length;
    const nextScore =
      Number(Boolean(course.grade)) +
      Number(Boolean(course.credits)) +
      String(course.title ?? "").length;

    if (nextScore > existingScore) {
      bySignature.set(signature, course);
    }
  }

  const courses = [...bySignature.values()];
  const completedCourses = courses.filter((course) => course.status === "completed");
  const inProgressCourses = courses.filter((course) => course.status === "in-progress");

  return {
    studentName: primary.studentName ?? secondary.studentName ?? null,
    studentId: primary.studentId ?? secondary.studentId ?? null,
    currentPrograms: [...new Set([...(primary.currentPrograms ?? []), ...(secondary.currentPrograms ?? [])])],
    majors: [...new Set([...(primary.majors ?? []), ...(secondary.majors ?? [])])],
    minors: [...new Set([...(primary.minors ?? []), ...(secondary.minors ?? [])])],
    overallGpa: primary.overallGpa ?? secondary.overallGpa ?? null,
    earnedHours: primary.earnedHours ?? secondary.earnedHours ?? null,
    gpaHours: primary.gpaHours ?? secondary.gpaHours ?? null,
    courses,
    completedCourses,
    inProgressCourses,
    completedCourseCodes: [...new Set(completedCourses.map((course) => course.code))],
    inProgressCourseCodes: [...new Set(inProgressCourses.map((course) => course.code))]
  };
}

async function extractPdfTextVariants(file) {
  const pdfJs = await loadPdfJs();
  const fileBuffer = await file.arrayBuffer();
  const pdf = await pdfJs.getDocument({ data: fileBuffer }).promise;
  const rowPages = [];
  const columnPages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    rowPages.push(normalizePdfItemsRows(content.items));
    columnPages.push(normalizePdfItemsColumns(content.items));
  }

  return {
    rowText: rowPages.join("\n\n"),
    columnText: columnPages.join("\n\n")
  };
}

export async function parseTranscriptFile(file) {
  if (!file) {
    throw new Error("Missing transcript file.");
  }

  const { rowText, columnText } = await extractPdfTextVariants(file);
  const looksLikeDegreePlan =
    rowText.includes("PLANNED COURSES") || columnText.includes("PLANNED COURSES");

  if (looksLikeDegreePlan) {
    const rowParsed = parseDegreePlanText(rowText);
    const columnParsed = parseDegreePlanText(columnText);
    return scoreParsedPayload(rowParsed) >= scoreParsedPayload(columnParsed)
      ? mergeParsedPayloads(rowParsed, columnParsed)
      : mergeParsedPayloads(columnParsed, rowParsed);
  }

  const rowParsed = parseTranscriptText(rowText);
  const columnParsed = parseTranscriptText(columnText);
  return scoreParsedPayload(rowParsed) >= scoreParsedPayload(columnParsed)
    ? mergeParsedPayloads(rowParsed, columnParsed)
    : mergeParsedPayloads(columnParsed, rowParsed);
}
