import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";

const PORT = Number(process.env.PORT ?? 4321);
const HOWDY_BASE_URL = process.env.HOWDY_BASE_URL ?? "https://howdy.tamu.edu";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const CONCURRENCY = 2;
const REQUEST_RETRIES = 3;
const RETRY_DELAY_MS = 350;

const PUBLIC_DIR = join(process.cwd(), "public");
const CACHE_DIR = join(process.cwd(), ".cache");
const PREBUILT_INDEX_FILE = join(process.cwd(), "data", "catalog-index.json");
const TERMS_CACHE_FILE = join(CACHE_DIR, "terms.json");
const CATALOG_CACHE_DIR = join(CACHE_DIR, "catalog");
const SECTIONS_CACHE_DIR = join(CACHE_DIR, "sections");

const CAMPUS_LABELS = {
  all: "All Terms",
  "college-station": "College Station",
  galveston: "Galveston",
  qatar: "Qatar",
  professional: "Professional",
  "half-year": "Half Year",
  other: "Other"
};

const catalogIndexPromises = new Map();
let prebuiltCatalogIndexPromise = null;

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function textResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

function wait(delayMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

function shouldRetryHowdyRequest(error, attempt) {
  const statusCode = error.statusCode ?? 0;
  return attempt < REQUEST_RETRIES && (statusCode === 0 || statusCode === 429 || statusCode >= 500);
}

async function readFreshJson(filePath, ttlMs) {
  try {
    const fileStats = await stat(filePath);
    if (Date.now() - fileStats.mtimeMs > ttlMs) {
      return null;
    }
    return await readJsonFile(filePath);
  } catch {
    return null;
  }
}

async function getCachedJson(filePath, ttlMs, fetcher) {
  const fresh = await readFreshJson(filePath, ttlMs);
  if (fresh) {
    return fresh;
  }

  const stale = await readJsonFile(filePath);

  try {
    const nextValue = await fetcher();
    await writeJsonFile(filePath, nextValue);
    return nextValue;
  } catch (error) {
    if (stale) {
      console.warn(`Using stale cache for ${filePath}: ${error.message}`);
      return stale;
    }
    throw error;
  }
}

async function fetchHowdy(path, options = {}) {
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${HOWDY_BASE_URL}${path}`, {
        ...options,
        headers: {
          "user-agent": "tamu-course-offering-history/1.0",
          ...(options.headers ?? {})
        }
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(
          `${response.status} ${response.statusText}: ${body.slice(0, 300)}`
        );
        error.statusCode = response.status;
        throw error;
      }

      return response;
    } catch (error) {
      if (!shouldRetryHowdyRequest(error, attempt)) {
        throw error;
      }

      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

async function fetchHowdyJson(path, options = {}) {
  const response = await fetchHowdy(path, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers ?? {})
    }
  });

  return response.json();
}

async function fetchHowdyBinary(path, options = {}) {
  const response = await fetchHowdy(path, {
    ...options,
    headers: {
      accept: "application/pdf, application/octet-stream;q=0.9, */*;q=0.8",
      ...(options.headers ?? {})
    }
  });

  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentDisposition: response.headers.get("content-disposition"),
    contentLength: response.headers.get("content-length")
  };
}

function inferCampus(termDescription) {
  const description = termDescription.toLowerCase();

  if (description.includes("college station")) {
    return "college-station";
  }
  if (description.includes("galveston")) {
    return "galveston";
  }
  if (description.includes("qatar")) {
    return "qatar";
  }
  if (description.includes("professional")) {
    return "professional";
  }
  if (description.includes("half year")) {
    return "half-year";
  }
  return "other";
}

function campusMatches(campus, requestedCampus) {
  if (!requestedCampus || requestedCampus === "all") {
    return true;
  }
  return campus === requestedCampus;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseCourseCode(query) {
  const match = query
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2,5})[\s-]*([0-9]{3}[A-Z]?)$/);

  if (!match) {
    return null;
  }

  return {
    subject: match[1],
    courseNumber: match[2]
  };
}

function normalizeQueryTokens(query) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function sortByDescendingTerm(left, right) {
  return Number(right.termCode) - Number(left.termCode);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

async function fetchTerms() {
  return getCachedJson(TERMS_CACHE_FILE, CACHE_TTL_MS, async () => {
    const allTerms = await fetchHowdyJson("/api/all-terms");

    return allTerms.map((term) => ({
      code: String(term.STVTERM_CODE),
      description: term.STVTERM_DESC,
      campus: inferCampus(term.STVTERM_DESC),
      startDate: term.STVTERM_START_DATE,
      endDate: term.STVTERM_END_DATE
    }));
  });
}

async function fetchCatalogForTerm(termCode) {
  return getCachedJson(
    join(CATALOG_CACHE_DIR, `${termCode}.json`),
    CACHE_TTL_MS,
    async () =>
      fetchHowdyJson("/api/get-catalog-courses", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({ termCode })
      })
  );
}

async function getPrebuiltCatalogIndex() {
  if (!prebuiltCatalogIndexPromise) {
    prebuiltCatalogIndexPromise = readJsonFile(PREBUILT_INDEX_FILE)
      .then((payload) => payload?.entries ?? null)
      .catch(() => null);
  }

  return prebuiltCatalogIndexPromise;
}

async function fetchSectionsForTerm(termCode) {
  return getCachedJson(
    join(SECTIONS_CACHE_DIR, `${termCode}.json`),
    CACHE_TTL_MS,
    async () =>
      fetchHowdyJson("/api/course-sections", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          startRow: 0,
          endRow: 0,
          termCode,
          publicSearch: "Y"
        })
      })
  );
}

async function buildCatalogIndex(campus = "all") {
  const terms = await fetchTerms();
  const scopedTerms = terms.filter((term) => campusMatches(term.campus, campus));
  const sortedTerms = [...scopedTerms].sort((left, right) => Number(right.code) - Number(left.code));

  const catalogResults = await mapWithConcurrency(sortedTerms, CONCURRENCY, async (term) => {
    try {
      return {
        term,
        rows: await fetchCatalogForTerm(term.code)
      };
    } catch (error) {
      console.warn(`Skipping catalog term ${term.code} (${term.description}): ${error.message}`);
      return {
        term,
        rows: []
      };
    }
  });

  const entries = [];

  for (const { term, rows } of catalogResults) {
    for (const row of rows) {
      const sectionsCount = Number(row.SECTIONS_COUNT ?? 0);
      if (sectionsCount < 1) {
        continue;
      }

      entries.push({
        termCode: term.code,
        termDescription: term.description,
        campus: term.campus,
        subject: row.SCBCRKY_SUBJ_CODE,
        courseNumber: row.SCBCRKY_CRSE_NUMB,
        title: row.COURSE_TITLE || row.SCBCRSE_TITLE,
        sectionsCount,
        college: row.COLL_DESC
      });
    }
  }

  return entries;
}

async function getCatalogIndex(campus = "all") {
  const prebuiltIndex = await getPrebuiltCatalogIndex();

  if (prebuiltIndex?.length) {
    return prebuiltIndex;
  }

  const cacheKey = campus || "all";

  if (!catalogIndexPromises.has(cacheKey)) {
    const nextPromise = buildCatalogIndex(cacheKey).catch((error) => {
      catalogIndexPromises.delete(cacheKey);
      throw error;
    });

    catalogIndexPromises.set(cacheKey, nextPromise);
  }

  return catalogIndexPromises.get(cacheKey);
}

function searchCourses(index, query, campus) {
  const exactCourse = parseCourseCode(query);

  const filtered = index.filter((entry) => {
    if (!campusMatches(entry.campus, campus)) {
      return false;
    }

    if (entry.sectionsCount < 1) {
      return false;
    }

    if (exactCourse) {
      return (
        entry.subject === exactCourse.subject &&
        entry.courseNumber === exactCourse.courseNumber
      );
    }

    const haystack = [
      entry.subject,
      entry.courseNumber,
      entry.title,
      entry.college ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return normalizeQueryTokens(query).every((token) => haystack.includes(token));
  });

  const grouped = new Map();

  for (const entry of filtered) {
    const key = `${entry.subject}-${entry.courseNumber}`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        subject: entry.subject,
        courseNumber: entry.courseNumber,
        title: entry.title,
        latestTermCode: entry.termCode,
        latestTermDescription: entry.termDescription,
        offeringCount: 1,
        campuses: [entry.campus],
        colleges: [entry.college],
        exactMatch: exactCourse
          ? entry.subject === exactCourse.subject &&
            entry.courseNumber === exactCourse.courseNumber
          : false
      });
      continue;
    }

    current.offeringCount += 1;
    current.campuses.push(entry.campus);
    current.colleges.push(entry.college);

    if (Number(entry.termCode) > Number(current.latestTermCode)) {
      current.latestTermCode = entry.termCode;
      current.latestTermDescription = entry.termDescription;
      current.title = entry.title;
    }
  }

  return [...grouped.values()]
    .map((course) => ({
      ...course,
      campuses: uniqueSorted(course.campuses),
      campusLabels: uniqueSorted(course.campuses).map(
        (campusKey) => CAMPUS_LABELS[campusKey] ?? campusKey
      ),
      colleges: uniqueSorted(course.colleges.filter(Boolean))
    }))
    .sort((left, right) => {
      if (left.exactMatch !== right.exactMatch) {
        return left.exactMatch ? -1 : 1;
      }
      if (left.offeringCount !== right.offeringCount) {
        return right.offeringCount - left.offeringCount;
      }
      return `${left.subject} ${left.courseNumber}`.localeCompare(
        `${right.subject} ${right.courseNumber}`
      );
    })
    .slice(0, 50);
}

function buildCourseHistory(index, subject, courseNumber, campus) {
  const matchingTerms = index
    .filter(
      (entry) =>
        entry.subject === subject &&
        entry.courseNumber === courseNumber &&
        campusMatches(entry.campus, campus) &&
        entry.sectionsCount > 0
    )
    .sort(sortByDescendingTerm);

  if (matchingTerms.length === 0) {
    return null;
  }

  const latest = matchingTerms[0];

  return {
    subject,
    courseNumber,
    title: latest.title,
    totalOfferedTerms: matchingTerms.length,
    campusLabels: uniqueSorted(matchingTerms.map((entry) => entry.campus)).map(
      (campusKey) => CAMPUS_LABELS[campusKey] ?? campusKey
    ),
    terms: matchingTerms.map((entry) => ({
      termCode: entry.termCode,
      termDescription: entry.termDescription,
      campus: entry.campus,
      campusLabel: CAMPUS_LABELS[entry.campus] ?? entry.campus,
      sectionsCount: entry.sectionsCount,
      college: entry.college,
      title: entry.title,
      narrative: entry.narrative
    }))
  };
}

function parseJsonField(rawValue, fallback = []) {
  if (!rawValue) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mapSectionRow(row) {
  const instructors = parseJsonField(row.SWV_CLASS_SEARCH_INSTRCTR_JSON, []).map(
    (instructor) => ({
      name: instructor.NAME,
      hasCv: instructor.HAS_CV === "Y"
    })
  );

  const meetings = parseJsonField(row.SWV_CLASS_SEARCH_JSON_CLOB, []).map((meeting) => ({
    meetingType: meeting.SSRMEET_MTYP_CODE,
    days: [
      meeting.SSRMEET_MON_DAY ? "Mon" : "",
      meeting.SSRMEET_TUE_DAY ? "Tue" : "",
      meeting.SSRMEET_WED_DAY ? "Wed" : "",
      meeting.SSRMEET_THU_DAY ? "Thu" : "",
      meeting.SSRMEET_FRI_DAY ? "Fri" : "",
      meeting.SSRMEET_SAT_DAY ? "Sat" : "",
      meeting.SSRMEET_SUN_DAY ? "Sun" : ""
    ].filter(Boolean),
    beginTime: meeting.SSRMEET_BEGIN_TIME,
    endTime: meeting.SSRMEET_END_TIME,
    building: meeting.SSRMEET_BLDG_CODE,
    room: meeting.SSRMEET_ROOM_CODE,
    startDate: meeting.SSRMEET_START_DATE,
    endDate: meeting.SSRMEET_END_DATE
  }));

  return {
    crn: row.SWV_CLASS_SEARCH_CRN,
    termCode: row.SWV_CLASS_SEARCH_TERM,
    title: row.SWV_CLASS_SEARCH_TITLE,
    subject: row.SWV_CLASS_SEARCH_SUBJECT,
    courseNumber: row.SWV_CLASS_SEARCH_COURSE,
    section: row.SWV_CLASS_SEARCH_SECTION,
    scheduleType: row.SWV_CLASS_SEARCH_SCHD,
    instructionalMethod: row.SWV_CLASS_SEARCH_INST_TYPE,
    site: row.SWV_CLASS_SEARCH_SITE,
    session: row.SWV_CLASS_SEARCH_SESSION,
    hoursLow: row.SWV_CLASS_SEARCH_HOURS_LOW,
    hoursHigh: row.SWV_CLASS_SEARCH_HOURS_HIGH,
    hoursIndicator: row.SWV_CLASS_SEARCH_HOURS_IND,
    openForRegistration: row.STUSEAT_OPEN === "Y",
    hasSyllabus: row.SWV_CLASS_SEARCH_HAS_SYL_IND === "Y",
    syllabusMode:
      row.SWV_CLASS_SEARCH_HAS_SYL_IND === "Y"
        ? Number(row.SWV_CLASS_SEARCH_TERM) >= 202631
          ? "simple-syllabus"
          : "legacy"
        : null,
    attributes:
      row.SWV_CLASS_SEARCH_ATTRIBUTES?.split("|").map((attribute) => attribute.trim()) ?? [],
    instructors,
    meetings
  };
}

async function getCourseSections(subject, courseNumber, termCode) {
  const sectionRows = await fetchSectionsForTerm(termCode);

  return sectionRows
    .filter(
      (row) =>
        row.SWV_CLASS_SEARCH_SUBJECT === subject &&
        String(row.SWV_CLASS_SEARCH_COURSE) === String(courseNumber)
    )
    .map(mapSectionRow)
    .sort((left, right) => left.section.localeCompare(right.section, undefined, { numeric: true }));
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function serveFile(response, filePath) {
  const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(response);
}

function binaryResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": payload.contentType,
    "cache-control": "no-store",
    ...(payload.contentDisposition
      ? { "content-disposition": payload.contentDisposition }
      : {}),
    "content-length": payload.buffer.byteLength
  });
  response.end(payload.buffer);
}

async function handleApi(request, response, url) {
  try {
    if (url.pathname === "/api/health") {
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/search-courses") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      const campus = url.searchParams.get("campus") ?? "college-station";

      if (!query) {
        jsonResponse(response, 400, { error: "Missing q query parameter." });
        return;
      }

      const index = await getCatalogIndex(campus);
      const results = searchCourses(index, query, campus);

      jsonResponse(response, 200, {
        query,
        campus,
        count: results.length,
        cacheWarmHint:
          `First search may take longer while local ${(CAMPUS_LABELS[campus] ?? campus).toLowerCase()} term caches are built from TAMU's public APIs.`,
        results
      });
      return;
    }

    if (url.pathname === "/api/course-history") {
      const subject = url.searchParams.get("subject")?.trim().toUpperCase();
      const courseNumber = url.searchParams.get("course")?.trim().toUpperCase();
      const campus = url.searchParams.get("campus") ?? "college-station";

      if (!subject || !courseNumber) {
        jsonResponse(response, 400, { error: "Missing subject or course query parameter." });
        return;
      }

      const index = await getCatalogIndex(campus);
      const history = buildCourseHistory(index, subject, courseNumber, campus);

      if (!history) {
        jsonResponse(response, 404, {
          error: `No offered terms found for ${subject} ${courseNumber}.`
        });
        return;
      }

      jsonResponse(response, 200, history);
      return;
    }

    if (url.pathname === "/api/course-sections") {
      const subject = url.searchParams.get("subject")?.trim().toUpperCase();
      const courseNumber = url.searchParams.get("course")?.trim().toUpperCase();
      const termCode = url.searchParams.get("term")?.trim();

      if (!subject || !courseNumber || !termCode) {
        jsonResponse(response, 400, {
          error: "Missing subject, course, or term query parameter."
        });
        return;
      }

      const sections = await getCourseSections(subject, courseNumber, termCode);

      jsonResponse(response, 200, {
        subject,
        courseNumber,
        termCode,
        count: sections.length,
        sections
      });
      return;
    }

    if (url.pathname === "/api/course-syllabus-info") {
      const termCode = url.searchParams.get("term")?.trim();
      const crn = url.searchParams.get("crn")?.trim();

      if (!termCode || !crn) {
        jsonResponse(response, 400, {
          error: "Missing term or crn query parameter."
        });
        return;
      }

      const syllabusInfo = await fetchHowdyJson(
        `/api/course-syllabus-info?termCode=${encodeURIComponent(termCode)}&crn=${encodeURIComponent(crn)}`
      );

      jsonResponse(response, 200, {
        termCode,
        crn,
        selectionType: syllabusInfo.SWRFASY_SEL_TYPE ?? null,
        linkUrl: syllabusInfo.SWRFASY_URL_LINK ?? null
      });
      return;
    }

    if (url.pathname === "/api/course-syllabus-pdf") {
      const termCode = url.searchParams.get("term")?.trim();
      const crn = url.searchParams.get("crn")?.trim();

      if (!termCode || !crn) {
        jsonResponse(response, 400, {
          error: "Missing term or crn query parameter."
        });
        return;
      }

      const pdfPayload = await fetchHowdyBinary(
        `/api/course-syllabus-pdf?termCode=${encodeURIComponent(termCode)}&crn=${encodeURIComponent(crn)}`
      );

      binaryResponse(response, 200, pdfPayload);
      return;
    }

    jsonResponse(response, 404, { error: "Unknown API route." });
  } catch (error) {
    console.error(error);
    jsonResponse(response, 500, {
      error: error.message || "Unexpected server error."
    });
  }
}

async function handleStatic(response, url) {
  const publicRoot = resolve(PUBLIC_DIR);
  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = resolve(publicRoot, requestedPath);

  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    serveFile(response, join(PUBLIC_DIR, "index.html"));
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.isFile()) {
      serveFile(response, filePath);
      return;
    }
  } catch {
    serveFile(response, join(PUBLIC_DIR, "index.html"));
    return;
  }

  serveFile(response, join(PUBLIC_DIR, "index.html"));
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  await handleStatic(response, url);
}).listen(PORT, () => {
  console.log(`TAMU Syllabus Lookup running at http://localhost:${PORT}`);
});
