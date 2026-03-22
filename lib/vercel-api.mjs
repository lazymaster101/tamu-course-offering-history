import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { compareSyllabi } from "./openai-compare.mjs";

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue == null || String(rawValue).trim() === "") {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(rawValue).trim(), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

const HOWDY_BASE_URL = process.env.HOWDY_BASE_URL ?? "https://howdy.tamu.edu";
const REQUEST_RETRIES = 3;
const RETRY_DELAY_MS = 350;
const HOWDY_REQUEST_TIMEOUT_MS = Math.max(
  readPositiveIntegerEnv("HOWDY_REQUEST_TIMEOUT_MS", 30000),
  30000
);
const COURSE_SECTIONS_REQUEST_TIMEOUT_MS = Math.max(
  readPositiveIntegerEnv("COURSE_SECTIONS_REQUEST_TIMEOUT_MS", 45000),
  30000
);
const COURSE_SECTIONS_REQUEST_RETRIES = 2;
const COURSE_SECTIONS_RETRY_DELAY_MS = 250;
const COURSE_SECTIONS_RETRY_TIMEOUT_STEP_MS = 15000;
const SECTION_CACHE_TTL_MS = readPositiveIntegerEnv("SECTION_CACHE_TTL_MS", 1000 * 60 * 20);
const SYLLABUS_INFO_REQUEST_RETRIES = 1;
const SYLLABUS_INFO_RETRY_DELAY_MS = 200;
const SYLLABUS_INFO_TIMEOUT_MS = 2500;
const PREBUILT_INDEX_URL = new URL("../data/catalog-index.json", import.meta.url);

const CAMPUS_LABELS = {
  all: "All Terms",
  "college-station": "College Station",
  galveston: "Galveston",
  qatar: "Qatar",
  professional: "Professional",
  "half-year": "Half Year",
  other: "Other"
};

let prebuiltCatalogIndexPromise = null;
const syllabusTargetPromiseCache = new Map();
const courseSectionsCache = new Map();
const courseSectionsPromiseCache = new Map();

function wait(delayMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

function decodeResponseBuffer(buffer, contentEncoding) {
  const encoding = String(contentEncoding ?? "").trim().toLowerCase();

  if (!encoding || encoding === "identity") {
    return buffer;
  }

  if (encoding === "gzip" || encoding === "x-gzip") {
    return gunzipSync(buffer);
  }

  if (encoding === "deflate") {
    return inflateSync(buffer);
  }

  if (encoding === "br") {
    return brotliDecompressSync(buffer);
  }

  return buffer;
}

function shouldRetryHowdyRequest(error, attempt) {
  const statusCode = error.statusCode ?? 0;
  return attempt < REQUEST_RETRIES && (statusCode === 0 || statusCode === 429 || statusCode >= 500);
}

async function fetchHowdy(path, options = {}) {
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${HOWDY_BASE_URL}${path}`, {
        ...options,
        headers: {
          "user-agent": "tamu-course-offering-history-vercel/1.0",
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

async function postHowdyJsonRaw(path, payload, timeoutMs = COURSE_SECTIONS_REQUEST_TIMEOUT_MS) {
  const requestBody = JSON.stringify(payload);

  for (let attempt = 0; attempt <= COURSE_SECTIONS_REQUEST_RETRIES; attempt += 1) {
    try {
      const requestTimeoutMs = timeoutMs + attempt * COURSE_SECTIONS_RETRY_TIMEOUT_STEP_MS;
      const targetUrl = new URL(path, HOWDY_BASE_URL);
      const responsePayload = await new Promise((resolvePromise, rejectPromise) => {
        const request = httpsRequest(
          targetUrl,
          {
            method: "POST",
            agent: false,
            headers: {
              accept: "application/json",
              "accept-encoding": "br, gzip, deflate",
              connection: "close",
              "content-type": "application/json; charset=utf-8",
              "content-length": Buffer.byteLength(requestBody),
              "user-agent": "tamu-course-offering-history-vercel/1.0"
            }
          },
          (response) => {
            const chunks = [];

            response.on("data", (chunk) => {
              chunks.push(chunk);
            });

            response.on("end", () => {
              const rawBuffer = Buffer.concat(chunks);
              const body = decodeResponseBuffer(
                rawBuffer,
                response.headers["content-encoding"]
              ).toString("utf8");
              const statusCode = response.statusCode ?? 0;

              if (statusCode < 200 || statusCode >= 300) {
                const error = new Error(
                  `${statusCode} ${response.statusMessage ?? "Request failed"}: ${body.slice(0, 300)}`
                );
                error.statusCode = statusCode;
                rejectPromise(error);
                return;
              }

              try {
                resolvePromise(JSON.parse(body));
              } catch (error) {
                rejectPromise(error);
              }
            });

            response.on("error", rejectPromise);
            response.on("aborted", () => {
              const error = new Error("Howdy response stream was aborted.");
              error.statusCode = 0;
              rejectPromise(error);
            });
          }
        );

        request.setTimeout(requestTimeoutMs, () => {
          const error = new Error(`Howdy request timed out after ${requestTimeoutMs} ms.`);
          error.statusCode = 504;
          request.destroy(error);
        });

        request.on("error", rejectPromise);
        request.write(requestBody);
        request.end();
      });

      return responsePayload;
    } catch (error) {
      console.warn(
        `[course-sections] attempt ${attempt + 1} failed for ${path}: ${error.message}`
      );
      const canRetry =
        attempt < COURSE_SECTIONS_REQUEST_RETRIES &&
        shouldRetryHowdyRequest(error, attempt);

      if (!canRetry) {
        throw error;
      }

      await wait(COURSE_SECTIONS_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

function getCachedSectionRows(termCode) {
  const cachedEntry = courseSectionsCache.get(termCode);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.rows;
  }

  return null;
}

function getStaleSectionRows(termCode) {
  return courseSectionsCache.get(termCode)?.rows ?? null;
}

function setCachedSectionRows(termCode, rows) {
  courseSectionsCache.set(termCode, {
    rows,
    expiresAt: Date.now() + SECTION_CACHE_TTL_MS
  });
}

async function fetchSectionsForTerm(termCode) {
  const freshRows = getCachedSectionRows(termCode);

  if (freshRows) {
    return freshRows;
  }

  if (courseSectionsPromiseCache.has(termCode)) {
    return courseSectionsPromiseCache.get(termCode);
  }

  const pendingRequest = (async () => {
    const staleRows = getStaleSectionRows(termCode);

    try {
      const rows = await postHowdyJsonRaw("/api/course-sections", {
        startRow: 0,
        endRow: 0,
        termCode,
        publicSearch: "Y"
      });

      setCachedSectionRows(termCode, rows);
      return rows;
    } catch (error) {
      if (staleRows) {
        console.warn(
          `[course-sections] using stale cached rows for term ${termCode}: ${error.message}`
        );
        return staleRows;
      }

      throw error;
    } finally {
      courseSectionsPromiseCache.delete(termCode);
    }
  })();

  courseSectionsPromiseCache.set(termCode, pendingRequest);
  return pendingRequest;
}

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function redirectResponse(statusCode, location) {
  return new Response(null, {
    status: statusCode,
    headers: {
      "cache-control": "no-store",
      location
    }
  });
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

function buildOpenSyllabusPath(termCode, crn) {
  return `/api/open-syllabus?term=${encodeURIComponent(termCode)}&crn=${encodeURIComponent(crn)}`;
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

async function fetchHowdyInfoJson(path) {
  for (let attempt = 0; attempt <= SYLLABUS_INFO_REQUEST_RETRIES; attempt += 1) {
    try {
      const targetUrl = new URL(path, HOWDY_BASE_URL);
      const payload = await new Promise((resolvePromise, rejectPromise) => {
        const request = httpsRequest(
          targetUrl,
          {
            method: "GET",
            headers: {
              accept: "application/json",
              "accept-encoding": "br, gzip, deflate",
              connection: "close",
              "user-agent": "tamu-course-offering-history-vercel/1.0"
            }
          },
          (response) => {
            const chunks = [];

            response.on("data", (chunk) => {
              chunks.push(chunk);
            });

            response.on("end", () => {
              const rawBuffer = Buffer.concat(chunks);
              const body = decodeResponseBuffer(
                rawBuffer,
                response.headers["content-encoding"]
              ).toString("utf8");
              const statusCode = response.statusCode ?? 0;

              if (statusCode < 200 || statusCode >= 300) {
                const error = new Error(
                  `${statusCode} ${response.statusMessage ?? "Request failed"}: ${body.slice(0, 300)}`
                );
                error.statusCode = statusCode;
                rejectPromise(error);
                return;
              }

              try {
                resolvePromise(JSON.parse(body));
              } catch (error) {
                rejectPromise(error);
              }
            });

            response.on("error", rejectPromise);
            response.on("aborted", () => {
              const error = new Error("Howdy syllabus info response was aborted.");
              error.statusCode = 0;
              rejectPromise(error);
            });
          }
        );

        request.setTimeout(SYLLABUS_INFO_TIMEOUT_MS, () => {
          const error = new Error("Howdy syllabus info request timed out.");
          error.statusCode = 0;
          request.destroy(error);
        });

        request.on("error", rejectPromise);
        request.end();
      });

      return payload;
    } catch (error) {
      const canRetry =
        attempt < SYLLABUS_INFO_REQUEST_RETRIES &&
        shouldRetryHowdyRequest(error, attempt);

      if (!canRetry) {
        throw error;
      }

      await wait(SYLLABUS_INFO_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

async function resolveLegacySyllabusTarget(termCode, crn) {
  const cacheKey = `${termCode}:${crn}`;

  if (syllabusTargetPromiseCache.has(cacheKey)) {
    return syllabusTargetPromiseCache.get(cacheKey);
  }

  const fallbackUrl = buildLegacyPublicSyllabusPdfUrl(termCode, crn);
  const targetPromise = (async () => {
    let resolvedFromHowdy = false;

    try {
      const syllabusInfo = await fetchHowdyInfoJson(
        `/api/course-syllabus-info?termCode=${encodeURIComponent(termCode)}&crn=${encodeURIComponent(crn)}`
      );
      resolvedFromHowdy = true;

      if (
        syllabusInfo.SWRFASY_SEL_TYPE === "L" &&
        isValidLegacyLinkTarget(syllabusInfo.SWRFASY_URL_LINK)
      ) {
        return syllabusInfo.SWRFASY_URL_LINK;
      }

      return fallbackUrl;
    } catch (error) {
      console.warn(
        `Falling back to public syllabus PDF for ${termCode}/${crn}: ${error.message}`
      );
      return fallbackUrl;
    } finally {
      if (!resolvedFromHowdy) {
        syllabusTargetPromiseCache.delete(cacheKey);
      }
    }
  })();

  syllabusTargetPromiseCache.set(cacheKey, targetPromise);
  return targetPromise;
}

function detectHonors(title, attributes) {
  const normalizedTitle = String(title ?? "").trim().toUpperCase();
  return normalizedTitle.startsWith("HNR-") || attributes.some((attribute) => /honors/i.test(attribute));
}

export function handleApiError(error) {
  console.error(error);
  return jsonResponse(error.statusCode ?? 500, {
    error: error.message || "Unexpected server error."
  });
}

export function healthResponse() {
  return jsonResponse(200, { ok: true });
}

async function getPrebuiltCatalogIndex() {
  if (!prebuiltCatalogIndexPromise) {
    prebuiltCatalogIndexPromise = readFile(PREBUILT_INDEX_URL, "utf8")
      .then((raw) => JSON.parse(raw))
      .then((payload) => payload?.entries ?? null)
      .catch(() => null);
  }

  return prebuiltCatalogIndexPromise;
}

export async function requireCatalogIndex() {
  const index = await getPrebuiltCatalogIndex();

  if (!index?.length) {
    throw new Error(
      "Catalog index unavailable. Run `npm run build` before deploying this app."
    );
  }

  return index;
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

function searchCourses(index, query, campus) {
  const exactCourse = parseCourseCode(query);

  const filtered = index.filter((entry) => {
    if (!campusMatches(entry.campus, campus)) {
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
        campusMatches(entry.campus, campus)
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
      narrative: entry.narrative ?? null
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
  const attributes =
    row.SWV_CLASS_SEARCH_ATTRIBUTES?.split("|").map((attribute) => attribute.trim()) ?? [];
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
    isHonors: detectHonors(row.SWV_CLASS_SEARCH_TITLE, attributes),
    syllabusMode:
      row.SWV_CLASS_SEARCH_HAS_SYL_IND === "Y"
        ? Number(row.SWV_CLASS_SEARCH_TERM) >= 202631
          ? "simple-syllabus"
          : "legacy"
        : null,
    syllabusUrl:
      row.SWV_CLASS_SEARCH_HAS_SYL_IND === "Y"
        ? Number(row.SWV_CLASS_SEARCH_TERM) >= 202631
          ? buildSimpleSyllabusUrl(row.SWV_CLASS_SEARCH_TERM, row.SWV_CLASS_SEARCH_CRN)
          : buildOpenSyllabusPath(row.SWV_CLASS_SEARCH_TERM, row.SWV_CLASS_SEARCH_CRN)
        : null,
    attributes,
    instructors,
    meetings
  };
}

export async function getCourseSections(subject, courseNumber, termCode) {
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

export async function searchCoursesResponse(url) {
  const query = url.searchParams.get("q")?.trim() ?? "";
  const campus = url.searchParams.get("campus") ?? "college-station";

  if (!query) {
    return jsonResponse(400, { error: "Missing q query parameter." });
  }

  const index = await requireCatalogIndex();
  const results = searchCourses(index, query, campus);

  return jsonResponse(200, {
    query,
    campus,
    count: results.length,
    cacheWarmHint:
      "Searches are backed by a prebuilt TAMU catalog index generated during deployment.",
    results
  });
}

export async function courseHistoryResponse(url) {
  const subject = url.searchParams.get("subject")?.trim().toUpperCase();
  const courseNumber = url.searchParams.get("course")?.trim().toUpperCase();
  const campus = url.searchParams.get("campus") ?? "college-station";

  if (!subject || !courseNumber) {
    return jsonResponse(400, { error: "Missing subject or course query parameter." });
  }

  const index = await requireCatalogIndex();
  const history = buildCourseHistory(index, subject, courseNumber, campus);

  if (!history) {
    return jsonResponse(404, {
      error: `No offered terms found for ${subject} ${courseNumber}.`
    });
  }

  return jsonResponse(200, history);
}

export async function courseSectionsResponse(url) {
  const subject = url.searchParams.get("subject")?.trim().toUpperCase();
  const courseNumber = url.searchParams.get("course")?.trim().toUpperCase();
  const termCode = url.searchParams.get("term")?.trim();

  if (!subject || !courseNumber || !termCode) {
    return jsonResponse(400, {
      error: "Missing subject, course, or term query parameter."
    });
  }

  const sections = await getCourseSections(subject, courseNumber, termCode);

  return jsonResponse(200, {
    subject,
    courseNumber,
    termCode,
    count: sections.length,
    sections
  });
}

export async function syllabusInfoResponse(url) {
  const termCode = url.searchParams.get("term")?.trim();
  const crn = url.searchParams.get("crn")?.trim();

  if (!termCode || !crn) {
    return jsonResponse(400, {
      error: "Missing term or crn query parameter."
    });
  }

  const syllabusInfo = await fetchHowdyJson(
    `/api/course-syllabus-info?termCode=${encodeURIComponent(termCode)}&crn=${encodeURIComponent(crn)}`
  );

  return jsonResponse(200, {
    termCode,
    crn,
    selectionType: syllabusInfo.SWRFASY_SEL_TYPE ?? null,
    linkUrl: syllabusInfo.SWRFASY_URL_LINK ?? null
  });
}

export async function syllabusPdfResponse(url) {
  const termCode = url.searchParams.get("term")?.trim();
  const crn = url.searchParams.get("crn")?.trim();

  if (!termCode || !crn) {
    return jsonResponse(400, {
      error: "Missing term or crn query parameter."
    });
  }

  const targetUrl = `${HOWDY_BASE_URL}/api/course-syllabus-pdf?termCode=${encodeURIComponent(
    termCode
  )}&crn=${encodeURIComponent(crn)}`;

  return redirectResponse(307, targetUrl);
}

export async function openSyllabusResponse(url) {
  const termCode = url.searchParams.get("term")?.trim();
  const crn = url.searchParams.get("crn")?.trim();

  if (!termCode || !crn) {
    return jsonResponse(400, {
      error: "Missing term or crn query parameter."
    });
  }

  if (Number(termCode) >= 202631) {
    return redirectResponse(307, buildSimpleSyllabusUrl(termCode, crn));
  }

  const targetUrl = await resolveLegacySyllabusTarget(termCode, crn);
  return redirectResponse(307, targetUrl);
}

export async function compareSyllabiResponse(request, url) {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method Not Allowed"
    });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, {
      error: "Request body must be valid JSON."
    });
  }

  const result = await compareSyllabi({
    items: payload?.items,
    question: payload?.question,
    previousResponseId: payload?.previousResponseId,
    requestOrigin: url.origin
  });

  return jsonResponse(200, result);
}
