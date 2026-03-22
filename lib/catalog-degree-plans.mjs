const CATALOG_BASE_URL = "https://catalog.tamu.edu";
const UNDERGRADUATE_INDEX_URL = new URL("/undergraduate/", CATALOG_BASE_URL);
const UCC_URL = new URL(
  "/undergraduate/general-information/university-core-curriculum/",
  CATALOG_BASE_URL
);
const FETCH_TIMEOUT_MS = 20000;
const FETCH_RETRIES = 2;

let catalogProgramsCache = null;
let courseDescriptionPathCache = null;
let uccCatalogCache = null;
const programPlanCache = new Map();
const courseCatalogCache = new Map();

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8203;/g, "");
}

function stripTags(html) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCategoryKey(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(String(value ?? ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\^\d+$/u, "")
      .replace(/\b\d+\b$/u, "")
      .replace(/&/g, " and ")
      .replace(/[\/,–—-]+/g, " ")
      .replace(/[^a-z0-9 ]/giu, " ")
      .toLowerCase()
  );
}

function normalizeCourseCode(code) {
  const match = normalizeWhitespace(code).toUpperCase().match(/\b([A-Z]{3,5})\s*(\d{3}[A-Z]?)\b/u);
  return match ? `${match[1]} ${match[2]}` : null;
}

function extractCourseCodes(value) {
  const seen = new Set();
  const matches = [];
  const text = stripTags(value).toUpperCase();
  const pattern = /\b([A-Z]{3,5})\s*(\d{3}[A-Z]?)\b/gu;
  let match = pattern.exec(text);

  while (match) {
    const code = `${match[1]} ${match[2]}`;
    if (!seen.has(code)) {
      seen.add(code);
      matches.push(code);
    }
    match = pattern.exec(text);
  }

  return matches;
}

function parseCreditHours(hoursText) {
  const matches = [...String(hoursText ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
    Number.parseFloat(match[0])
  );

  if (!matches.length) {
    return 0;
  }

  return Math.max(...matches);
}

function isBachelorProgramTitle(title) {
  const normalized = normalizeWhitespace(title);

  if (!/\b(BA|BS|BBA|BFA|BLA|BM|BSN|BGS)\b/i.test(normalized)) {
    return false;
  }

  if (/3\+\d|combined degree program|certificate|minor|concentration$/i.test(normalized)) {
    return false;
  }

  return true;
}

function makeCatalogPlanId(pathname) {
  const trimmed = String(pathname ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/undergraduate\//i, "")
    .replace(/\/+$/u, "");

  return `catalog-major:${trimmed}`;
}

function parseCatalogPlanId(planId) {
  if (!String(planId).startsWith("catalog-major:")) {
    return null;
  }

  return `/undergraduate/${String(planId).slice("catalog-major:".length).replace(/^\/+/u, "")}/`;
}

async function fetchCatalogHtml(url, label) {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS + attempt * 4000);

    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "tamu-course-offering-history/1.0"
        },
        signal: controller.signal
      });
      const body = await response.text();

      if (!response.ok) {
        throw createError(
          `${label} request failed with ${response.status}: ${body.slice(0, 240)}`,
          response.status
        );
      }

      return body;
    } catch (error) {
      const isLastAttempt = attempt >= FETCH_RETRIES;

      if (isLastAttempt) {
        if (error.name === "AbortError") {
          throw createError(`Timed out while fetching ${label}.`, 504);
        }

        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw createError(`Could not fetch ${label}.`, 502);
}

function extractProgramRequirementsHtml(programPageHtml) {
  const match = programPageHtml.match(
    /<div id="programrequirementstextcontainer"[\s\S]*?<a name="programrequirementstext"><\/a>([\s\S]*?)<\/div>\s*<\/main>/iu
  );
  return match?.[1] ?? "";
}

function extractPlanTableHtmls(programRequirementsHtml) {
  return [...String(programRequirementsHtml ?? "").matchAll(/<table[^>]*class="sc_plangrid"[\s\S]*?<\/table>/giu)].map(
    (match) => match[0]
  );
}

function extractFootnotesHtml(programRequirementsHtml) {
  return programRequirementsHtml.match(/<dl class="sc_footnotes"[\s\S]*?<\/dl>/iu)?.[0] ?? "";
}

function extractCourseBlocks(coursePageHtml) {
  const matches = [...String(coursePageHtml ?? "").matchAll(/<div class="courseblock">/giu)];
  if (!matches.length) {
    return [];
  }

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : coursePageHtml.length;
    return coursePageHtml.slice(start, end);
  });
}

function extractSubjectCode(courseCode) {
  return normalizeCourseCode(courseCode)?.split(" ")[0] ?? null;
}

function extractCourseTitle(courseBlockHtml) {
  const rawTitle =
    courseBlockHtml.match(/<h2 class="courseblocktitle">([\s\S]*?)<\/h2>/iu)?.[1] ?? "";
  const cleanTitle = stripTags(rawTitle);
  return cleanTitle.replace(/^[A-Z]{3,5}\s+\d{3}[A-Z]?\s+/u, "").trim();
}

function extractCourseCredits(courseBlockHtml) {
  const match = stripTags(courseBlockHtml).match(/\bCredits\s+(\d+(?:\.\d+)?)\b/iu);
  return match ? Number.parseFloat(match[1]) : 0;
}

function extractCoursePrereqs(courseBlockHtml) {
  const prereqMatch = courseBlockHtml.match(
    /<strong>Prerequisites?:<\/strong>\s*([\s\S]*?)(?:<strong>|<br\/?>)/iu
  );

  if (!prereqMatch) {
    return [];
  }

  return extractCourseCodes(prereqMatch[1]);
}

async function loadUndergraduatePrograms() {
  if (catalogProgramsCache) {
    return catalogProgramsCache;
  }

  const html = await fetchCatalogHtml(UNDERGRADUATE_INDEX_URL, "undergraduate catalog index");
  const anchors = [...html.matchAll(/<a href="(\/undergraduate\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)];
  const deduped = new Map();

  anchors.forEach((match) => {
    const path = decodeHtmlEntities(match[1]).replace(/\/+$/u, "/");
    const title = stripTags(match[2]);

    if (!isBachelorProgramTitle(title)) {
      return;
    }

    if (path === "/undergraduate/engineering/computer-science/bs/") {
      return;
    }

    const id = makeCatalogPlanId(path);
    if (deduped.has(id)) {
      return;
    }

    deduped.set(id, {
      id,
      code: "catalog-major",
      title: normalizeWhitespace(title.replace(/\u200b/gu, "").replace(/\s*-\s*/gu, " - ")),
      catalog: "2025-2026",
      supportLevel: "catalog-backed",
      sourcePath: path
    });
  });

  catalogProgramsCache = [...deduped.values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
  return catalogProgramsCache;
}

async function loadCourseDescriptionPathMap() {
  if (courseDescriptionPathCache) {
    return courseDescriptionPathCache;
  }

  const html = await fetchCatalogHtml(UNDERGRADUATE_INDEX_URL, "course description index");
  const courseMap = new Map();

  [...html.matchAll(/<a href="(\/undergraduate\/course-descriptions\/[^"]+\/)"[^>]*>([\s\S]*?)<\/a>/giu)]
    .forEach((match) => {
      const path = decodeHtmlEntities(match[1]);
      const title = stripTags(match[2]);
      const subjectMatch = title.match(/\(([A-Z]{3,5})\)\s*$/u);
      if (!subjectMatch) {
        return;
      }

      courseMap.set(subjectMatch[1], path);
    });

  courseDescriptionPathCache = courseMap;
  return courseDescriptionPathCache;
}

async function loadSubjectCourseCatalog(subject) {
  const normalizedSubject = String(subject ?? "").toUpperCase().trim();
  if (!normalizedSubject) {
    return new Map();
  }

  if (courseCatalogCache.has(normalizedSubject)) {
    return courseCatalogCache.get(normalizedSubject);
  }

  const descriptionPathMap = await loadCourseDescriptionPathMap();
  const subjectPath =
    descriptionPathMap.get(normalizedSubject) ??
    `/undergraduate/course-descriptions/${normalizedSubject.toLowerCase()}/`;
  const html = await fetchCatalogHtml(new URL(subjectPath, CATALOG_BASE_URL), `${normalizedSubject} course descriptions`);
  const catalog = new Map();

  extractCourseBlocks(html).forEach((courseBlockHtml) => {
    const titleMatch = stripTags(
      courseBlockHtml.match(/<h2 class="courseblocktitle">([\s\S]*?)<\/h2>/iu)?.[1] ?? ""
    );
    const codeMatch = titleMatch.match(/\b([A-Z]{3,5})\s+(\d{3}[A-Z]?)\b/u);
    if (!codeMatch) {
      return;
    }

    const code = `${codeMatch[1]} ${codeMatch[2]}`;
    catalog.set(code, {
      code,
      title: extractCourseTitle(courseBlockHtml),
      hours: extractCourseCredits(courseBlockHtml),
      prereqs: extractCoursePrereqs(courseBlockHtml)
    });
  });

  courseCatalogCache.set(normalizedSubject, catalog);
  return catalog;
}

async function loadUccCatalog() {
  if (uccCatalogCache) {
    return uccCatalogCache;
  }

  const html = await fetchCatalogHtml(UCC_URL, "university core curriculum");
  const categories = [];
  const sectionPattern =
    /<h2[^>]*>([\s\S]*?)<\/h2>\s*(<table class="sc_courselist">[\s\S]*?<\/table>)/giu;

  [...html.matchAll(sectionPattern)].forEach((match) => {
    const headingText = stripTags(match[1]).replace(/\s+\d+$/u, "");
    const headingMatch = headingText.match(/^(.+?)\s*[–-]\s*(\d+)\s*SCH/iu);

    if (!headingMatch) {
      return;
    }

    const title = normalizeWhitespace(headingMatch[1]);
    const slug =
      match[1].match(/<a id="([^"]+)"[^>]*>/iu)?.[1] ??
      title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    categories.push({
      title,
      targetHours: Number.parseInt(headingMatch[2], 10) || 0,
      codes: extractCourseCodes(match[2]),
      slug,
      key: normalizeCategoryKey(title)
    });
  });

  if (!categories.length) {
    categories.push(
      {
        title: "Communication",
        targetHours: 6,
        codes: ["COMM 203", "COMM 205", "COMM 243", "ENGL 103", "ENGL 104", "ENGL 203", "ENGL 210"],
        slug: "communication",
        key: normalizeCategoryKey("Communication")
      },
      {
        title: "Mathematics",
        targetHours: 6,
        codes: ["MATH 140", "MATH 142", "MATH 147", "MATH 148", "MATH 150", "MATH 151", "MATH 152", "MATH 171", "MATH 172", "PHIL 240", "STAT 201"],
        slug: "mathematics",
        key: normalizeCategoryKey("Mathematics")
      },
      {
        title: "American History",
        targetHours: 6,
        codes: ["HIST 105", "HIST 106"],
        slug: "american-history",
        key: normalizeCategoryKey("American History")
      },
      {
        title: "Government / Political Science",
        targetHours: 6,
        codes: ["POLS 206", "POLS 207"],
        slug: "government-political-science",
        key: normalizeCategoryKey("Government / Political Science")
      }
    );
  }

  uccCatalogCache = categories;
  return uccCatalogCache;
}

function sanitizeRequirementLabel(label) {
  return normalizeWhitespace(
    decodeHtmlEntities(String(label ?? ""))
      .replace(/\s+\^\d+(?:,\d+)*$/u, "")
      .replace(/\b\d+(?:,\d+)*\b$/u, "")
  );
}

function findMatchingUccCategory(label, html, uccCategories) {
  const hrefSlug =
    String(html ?? "").match(/university-core-curriculum\/#([a-z0-9-]+)/iu)?.[1] ?? null;

  if (hrefSlug) {
    const slugMatch = uccCategories.find((category) => category.slug === hrefSlug);
    if (slugMatch) {
      return slugMatch;
    }
  }

  const normalizedLabel = normalizeCategoryKey(sanitizeRequirementLabel(label));
  if (!normalizedLabel) {
    return null;
  }

  return (
    uccCategories.find((category) => normalizedLabel === category.key) ??
    uccCategories.find(
      (category) =>
        normalizedLabel.startsWith(category.key) || category.key.startsWith(normalizedLabel)
    ) ??
    null
  );
}

function extractAttribute(attributes, name) {
  const match = String(attributes ?? "").match(new RegExp(`${name}="([^"]*)"`, "iu"));
  return match?.[1] ?? "";
}

function extractTableRows(tableHtml) {
  return [...String(tableHtml ?? "").matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/giu)].map((match) => ({
    attributes: match[1],
    html: match[2],
    className: extractAttribute(match[1], "class")
  }));
}

function extractCells(rowHtml) {
  return [...String(rowHtml ?? "").matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/giu)].map(
    (match) => ({
      tag: match[1],
      attributes: match[2],
      className: extractAttribute(match[2], "class"),
      colspan: Number.parseInt(extractAttribute(match[2], "colspan"), 10) || 1,
      html: match[3],
      text: stripTags(match[3])
    })
  );
}

function buildChoiceNodeId(prefix, codes) {
  return `${prefix}-${codes.map((code) => code.toLowerCase().replace(/\s+/g, "-")).join("-or-")}`;
}

function buildCourseNodeId(code, suffix = "") {
  return `${code.toLowerCase().replace(/\s+/g, "-")}${suffix ? `-${suffix}` : ""}`;
}

function buildRequirementGroupId(label, index) {
  return `group-${index}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function parsePlanTable(tableHtml, uccCategories = []) {
  const graphNodes = [];
  const requirementGroups = [];
  const subjects = new Set();
  const rows = extractTableRows(tableHtml);

  let currentYear = "Program";
  let currentTerm = "Catalog sequence";
  let pendingChoice = null;
  let rowIndex = 0;

  function flushPendingChoice() {
    if (!pendingChoice) {
      return;
    }

    const validOptions = pendingChoice.options.filter(
      (option) => Array.isArray(option.codes) && option.codes.length === 1
    );
    const complexOptions = pendingChoice.options.filter(
      (option) => Array.isArray(option.codes) && option.codes.length > 1
    );

    if (validOptions.length >= 2 && complexOptions.length === 0) {
      const optionCodes = validOptions.map((option) => option.codes[0]);
      optionCodes.forEach((code) => {
        const subject = extractSubjectCode(code);
        if (subject) {
          subjects.add(subject);
        }
      });
      graphNodes.push({
        id: buildChoiceNodeId(pendingChoice.id, optionCodes),
        type: "choice",
        column: pendingChoice.column,
        code: optionCodes.join(" / "),
        title: pendingChoice.title,
        hours: pendingChoice.hours,
        matches: [...new Set(optionCodes)],
        options: [...new Set(optionCodes)],
        prereqs: [],
        required: true,
        catalogGroup: pendingChoice.groupLabel
      });
    } else {
      requirementGroups.push({
        id: buildRequirementGroupId(pendingChoice.title, requirementGroups.length),
        label: pendingChoice.title,
        category: "Catalog choice",
        hours: pendingChoice.hours,
        year: pendingChoice.year,
        term: pendingChoice.term,
        note:
          pendingChoice.options.length > 0
            ? pendingChoice.options
                .map((option) => option.label || option.codes.join(" + "))
                .join(" or ")
            : "Advisor review recommended."
      });
    }

    pendingChoice = null;
  }

  rows.forEach((row) => {
    rowIndex += 1;

    if (/\bplangridyear\b/u.test(row.className)) {
      flushPendingChoice();
      currentYear = stripTags(row.html);
      return;
    }

    if (/\bplangridterm\b/u.test(row.className)) {
      flushPendingChoice();
      const cells = extractCells(row.html);
      currentTerm = cells[0]?.text ?? currentTerm;
      return;
    }

    if (/\bplangridsum\b|\bplangridtotal\b/u.test(row.className)) {
      flushPendingChoice();
      return;
    }

    const cells = extractCells(row.html);
    if (cells.length < 2) {
      return;
    }

    const codeCell = cells[0];
    const titleCell = cells[1] ?? cells[0];
    const hoursCell = cells[cells.length - 1];
    const hoursText = normalizeWhitespace(hoursCell?.text ?? "");
    const hours = parseCreditHours(hoursText);
    const codeText = codeCell?.text ?? "";
    const titleText = normalizeWhitespace(titleCell?.text ?? codeText);
    const isCommentRow =
      codeCell.colspan >= 2 ||
      /\bcomment\b/u.test(codeCell.html) ||
      extractCourseCodes(codeCell.html).length === 0;
    const hasSelectText = /select one of the following/i.test(codeText);
    const extractedCodes = extractCourseCodes(codeCell.html);
    const choiceLikeRow = /\bor\b/iu.test(codeText) && extractedCodes.length >= 2;
    const crosslistedSingleRow =
      extractedCodes.length >= 2 &&
      !choiceLikeRow &&
      !/[&+]/u.test(codeText) &&
      /\//u.test(codeText);

    if (pendingChoice && hoursText === "" && extractedCodes.length > 0) {
      pendingChoice.options.push({
        label: titleText,
        codes: crosslistedSingleRow ? [extractedCodes[0]] : extractedCodes
      });
      return;
    }

    flushPendingChoice();

    if (hasSelectText) {
      const selectLabel = sanitizeRequirementLabel(codeText) || "Catalog choice";
      pendingChoice = {
        id: buildRequirementGroupId(`choice-${rowIndex}`, rowIndex),
        title: selectLabel,
        hours,
        year: currentYear,
        term: currentTerm,
        column: `${currentYear} ${currentTerm}`,
        groupLabel: selectLabel,
        options: []
      };
      return;
    }

    if (isCommentRow) {
      const label = sanitizeRequirementLabel(codeText || titleText || `Requirement group ${rowIndex}`);
      const uccCategory = findMatchingUccCategory(label, codeCell.html, uccCategories);
      const noteCandidate =
        cells.length > 2 ? normalizeWhitespace(titleCell?.text ?? "") : "";
      const note =
        noteCandidate && noteCandidate !== hoursText && !/^\d+(?:\.\d+)?$/u.test(noteCandidate)
          ? noteCandidate
          : "";

      requirementGroups.push({
        id: buildRequirementGroupId(label || `group-${rowIndex}`, rowIndex),
        label: label || `Requirement group ${rowIndex}`,
        category: uccCategory
          ? "University Core Curriculum"
          : /university core curriculum/i.test(codeText)
          ? "University Core Curriculum"
          : /science elective/i.test(codeText)
            ? "Science elective"
            : /general elective/i.test(codeText)
              ? "General elective"
              : "Catalog option",
        hours,
        year: currentYear,
        term: currentTerm,
        note,
        uccCategory: uccCategory?.title ?? null
      });
      return;
    }

    if (choiceLikeRow) {
      extractedCodes.forEach((code) => {
        const subject = extractSubjectCode(code);
        if (subject) {
          subjects.add(subject);
        }
      });

      graphNodes.push({
        id: buildChoiceNodeId(`choice-${rowIndex}`, extractedCodes),
        type: "choice",
        column: `${currentYear} ${currentTerm}`,
        code: extractedCodes.join(" / "),
        title: titleText,
        hours,
        matches: [...new Set(extractedCodes)],
        options: [...new Set(extractedCodes)],
        prereqs: [],
        required: true
      });
      return;
    }

    if (crosslistedSingleRow || extractedCodes.length === 1) {
      const primaryCode = extractedCodes[0];
      const subject = extractSubjectCode(primaryCode);
      if (subject) {
        subjects.add(subject);
      }

      graphNodes.push({
        id: buildCourseNodeId(primaryCode, rowIndex),
        type: "course",
        column: `${currentYear} ${currentTerm}`,
        code: primaryCode,
        title: titleText,
        hours,
        matches: [...new Set(extractedCodes)],
        prereqs: [],
        required: true
      });
      return;
    }

    extractedCodes.forEach((code, codeIndex) => {
      const subject = extractSubjectCode(code);
      if (subject) {
        subjects.add(subject);
      }

      graphNodes.push({
        id: buildCourseNodeId(code, `${rowIndex}-${codeIndex}`),
        type: "course",
        column: `${currentYear} ${currentTerm}`,
        code,
        title: titleText,
        hours,
        matches: [code],
        prereqs: [],
        required: true
      });
    });
  });

  flushPendingChoice();

  return {
    graphNodes,
    requirementGroups,
    subjects: [...subjects]
  };
}

function buildPlaceholderTargets(requirementGroups) {
  let verifiedUccHoursTarget = 0;
  let scienceElectiveHoursTarget = 0;
  let generalElectiveHoursTarget = 0;

  requirementGroups.forEach((group) => {
    if (/university core curriculum/i.test(group.category)) {
      verifiedUccHoursTarget += Number(group.hours ?? 0);
      return;
    }

    if (/science elective/i.test(group.category)) {
      scienceElectiveHoursTarget += Number(group.hours ?? 0);
      return;
    }

    if (/general elective/i.test(group.category)) {
      generalElectiveHoursTarget += Number(group.hours ?? 0);
    }
  });

  return {
    verifiedUccHoursTarget,
    scienceElectiveHoursTarget,
    generalElectiveHoursTarget
  };
}

async function enrichGraphNodes(graphNodes, subjects) {
  const mergedCourseCatalog = {};

  await Promise.all(
    subjects.map(async (subject) => {
      const subjectCatalog = await loadSubjectCourseCatalog(subject);
      subjectCatalog.forEach((value, key) => {
        mergedCourseCatalog[key] = value;
      });
    })
  );

  const enrichedNodes = graphNodes.map((node) => {
    const courseDetail = mergedCourseCatalog[node.code];
    const fallbackHours = Number(node.hours ?? 0);

    return {
      ...node,
      title: courseDetail?.title ?? node.title,
      hours:
        fallbackHours > 0
          ? fallbackHours
          : Number(courseDetail?.hours ?? 0) > 0
            ? Number(courseDetail.hours)
            : 0,
      prereqs: [...new Set(courseDetail?.prereqs ?? node.prereqs ?? [])]
    };
  });

  return {
    graphNodes: enrichedNodes,
    courseCatalog: mergedCourseCatalog
  };
}

function buildCatalogWarnings(planTitle) {
  return [
    `${planTitle} is running in catalog-backed mode. Required named coursework is precise, but department-only advising rules are still advisory.`,
    "Flexible elective buckets come from the public catalog and may still require advisor confirmation before registration."
  ];
}

function inferSchoolFromPath(pathname) {
  const parts = String(pathname ?? "").split("/").filter(Boolean);
  if (parts.length < 3) {
    return "Texas A&M University";
  }
  return decodeHtmlEntities(parts[2].replace(/-/g, " "));
}

function extractProgramTitle(html, sourcePath) {
  const pageTitleHeading =
    html.match(/<h1[^>]*class="[^"]*\bpage-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/iu)?.[1] ?? "";
  const pageTitle = stripTags(pageTitleHeading);

  if (pageTitle) {
    return pageTitle;
  }

  const titleTag = stripTags(html.match(/<title>([\s\S]*?)<\/title>/iu)?.[1] ?? "");
  if (titleTag) {
    return titleTag.split("<")[0].split("›")[0].trim();
  }

  return sourcePath
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase()) || "Catalog degree";
}

function extractTotalProgramHours(programRequirementsHtml, planTableHtml) {
  const explicitMatch = programRequirementsHtml.match(/Total Program Hours\s*(\d+)/iu);
  if (explicitMatch) {
    return Number.parseInt(explicitMatch[1], 10) || 0;
  }

  const planGridMatch = planTableHtml.match(
    /<tr class="plangridtotal[\s\S]*?<td[^>]*class="hourscol">(\d+)<\/td>/iu
  );
  if (planGridMatch) {
    return Number.parseInt(planGridMatch[1], 10) || 0;
  }

  const fallbackMatch = planTableHtml.match(/Total Semester Credit Hours<\/td><td[^>]*>(\d+)<\/td>/iu);
  return fallbackMatch ? Number.parseInt(fallbackMatch[1], 10) || 0 : 0;
}

function extractReferencedUccHours(programRequirementsHtml) {
  const match = String(programRequirementsHtml ?? "").match(
    /(\d+)\s+hours?\s+shown\s+as\s+University Core Curriculum electives/iu
  );
  return match ? Number.parseInt(match[1], 10) || 0 : 0;
}

export async function listCatalogDegreePlans() {
  return clonePlainData(await loadUndergraduatePrograms());
}

export async function getCatalogDegreePlan(planId) {
  const sourcePath = parseCatalogPlanId(planId);
  if (!sourcePath) {
    throw createError(`Unknown catalog degree plan id: ${planId}`, 404);
  }

  if (programPlanCache.has(planId)) {
    return clonePlainData(programPlanCache.get(planId));
  }

  const pageUrl = new URL(sourcePath, CATALOG_BASE_URL);
  const html = await fetchCatalogHtml(pageUrl, `catalog program page ${sourcePath}`);
  const programRequirementsHtml = extractProgramRequirementsHtml(html);
  const planTableHtmls = extractPlanTableHtmls(programRequirementsHtml);

  if (!planTableHtmls.length) {
    throw createError(`Could not parse a program-requirements table for ${sourcePath}.`, 502);
  }

  const uccCategories = await loadUccCatalog();
  const parsedTables = planTableHtmls.map((tableHtml, index) => {
    const parsed = parsePlanTable(tableHtml, uccCategories);
    const idPrefix = `table-${index + 1}`;

    return {
      graphNodes: parsed.graphNodes.map((node) => ({
        ...node,
        id: `${idPrefix}-${node.id}`
      })),
      requirementGroups: parsed.requirementGroups.map((group) => ({
        ...group,
        id: `${idPrefix}-${group.id}`
      })),
      subjects: parsed.subjects
    };
  });
  const mergedPlanTable = {
    graphNodes: parsedTables.flatMap((table) => table.graphNodes),
    requirementGroups: parsedTables.flatMap((table) => table.requirementGroups),
    subjects: [...new Set(parsedTables.flatMap((table) => table.subjects))]
  };
  const enriched = await enrichGraphNodes(mergedPlanTable.graphNodes, mergedPlanTable.subjects);
  const targets = buildPlaceholderTargets(mergedPlanTable.requirementGroups);
  const footnotesHtml = extractFootnotesHtml(programRequirementsHtml);
  const title = extractProgramTitle(html, sourcePath);
  const totalHours = extractTotalProgramHours(programRequirementsHtml, planTableHtmls.join("\n"));
  const referencedUccHours = extractReferencedUccHours(programRequirementsHtml);

  const plan = {
    id: planId,
    code: "catalog-major",
    catalog: "2025-2026",
    title,
    school: inferSchoolFromPath(sourcePath),
    campus: "College Station",
    totalHours,
    supportLevel: "catalog-backed",
    sourcePath,
    sourceUrl: pageUrl.href,
    guidanceNote:
      "This major uses the public TAMU catalog only. Named required coursework is mapped directly, while department-only advising rules remain advisory.",
    verifiedUccHoursTarget: Math.max(targets.verifiedUccHoursTarget, referencedUccHours),
    trackedElectiveHoursTarget: 0,
    trackedElectiveCourseTarget: 0,
    scienceElectiveHoursTarget: targets.scienceElectiveHoursTarget,
    generalElectiveHoursTarget: targets.generalElectiveHoursTarget,
    emphasisHoursTarget: 0,
    graduationRequirements: {
      highImpact: /high impact/i.test(stripTags(footnotesHtml)),
      seminar: null,
      capstone: null
    },
    graphColumns: [
      {
        id: "catalog-major",
        label: "Catalog coursework"
      }
    ],
    graphNodes: enriched.graphNodes,
    trackedElectives: {},
    fastTrack: {
      gpaMinimum: 0,
      coursePairs: []
    },
    verifiedUccMatchers: [...new Set(uccCategories.flatMap((category) => category.codes))],
    scienceElectiveMatchers: [],
    uccCategories,
    catalogRequirementGroups: mergedPlanTable.requirementGroups,
    courseCatalog: enriched.courseCatalog,
    warnings: buildCatalogWarnings(title)
  };

  programPlanCache.set(planId, plan);
  return clonePlainData(plan);
}
