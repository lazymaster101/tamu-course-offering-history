import {
  hasSavedCourse,
  saveCourse,
  removeCourse,
  formatSavedCourseCode
} from "./saved-courses.js";
import {
  hasCompareSource,
  saveCompareSource
} from "./compare-sources.js";
import { startSavedCourseBadgeSync } from "./page-shell.js";

const state = {
  activeCourseKey: null,
  activeCampus: "college-station"
};

const elements = {
  form: document.querySelector("#search-form"),
  query: document.querySelector("#query"),
  campus: document.querySelector("#campus"),
  searchButton: document.querySelector("#search-button"),
  resultsState: document.querySelector("#results-state"),
  resultsList: document.querySelector("#results-list"),
  historyState: document.querySelector("#history-state"),
  historyTitle: document.querySelector("#history-title"),
  historySummary: document.querySelector("#history-summary"),
  historyList: document.querySelector("#history-list"),
  courseTemplate: document.querySelector("#course-result-template"),
  termTemplate: document.querySelector("#term-card-template")
};

function setLoading(button, isLoading, label) {
  button.disabled = isLoading;
  button.textContent = label;
}

function showResultsState(message) {
  elements.resultsState.hidden = false;
  elements.resultsState.textContent = message;
  elements.resultsList.hidden = true;
  elements.resultsList.innerHTML = "";
}

function showHistoryState(message, title = "Pick a course") {
  elements.historyTitle.textContent = title;
  elements.historySummary.textContent =
    "Previous offerings will show up here as a compact term-by-term timeline.";
  elements.historyState.hidden = false;
  elements.historyState.textContent = message;
  elements.historyList.hidden = true;
  elements.historyList.innerHTML = "";
}

async function fetchJson(path) {
  const response = await fetch(path);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function formatCourseCode(subject, courseNumber) {
  return `${subject} ${courseNumber}`;
}

function getSavedCampusLabel(course) {
  if (state.activeCampus === "all") {
    return "All Terms";
  }

  if (Array.isArray(course.campusLabels) && course.campusLabels.length === 1) {
    return course.campusLabels[0];
  }

  return Array.isArray(course.campusLabels) && course.campusLabels.length
    ? course.campusLabels.join(" • ")
    : "College Station";
}

function toSavedCourse(course) {
  return {
    subject: course.subject,
    courseNumber: course.courseNumber,
    title: course.title,
    campus: state.activeCampus,
    campusLabel: getSavedCampusLabel(course),
    latestTermCode: course.latestTermCode ?? null,
    latestTermDescription: course.latestTermDescription ?? null,
    offeringCount: course.offeringCount ?? null
  };
}

function formatCampuses(labels) {
  return labels.join(" • ");
}

function setResultActionState(button, isActive, activeLabel, inactiveLabel) {
  button.textContent = isActive ? activeLabel : inactiveLabel;
  button.classList.toggle("is-active", isActive);
}

function updateCourseSaveControls(course, cartButton, favoriteButton) {
  const savedCourse = toSavedCourse(course);
  setResultActionState(
    cartButton,
    hasSavedCourse("cart", savedCourse),
    "In cart",
    "Add to cart"
  );
  setResultActionState(
    favoriteButton,
    hasSavedCourse("favorites", savedCourse),
    "Favorited",
    "Favorite"
  );
}

function renderResults(results) {
  elements.resultsList.innerHTML = "";

  if (!results.length) {
    showResultsState("No offered courses matched that search. Try a tighter code like CSCE 121.");
    return;
  }

  elements.resultsState.hidden = true;
  elements.resultsList.hidden = false;

  for (const course of results) {
    const fragment = elements.courseTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".result-button");
    const cartButton = fragment.querySelector(".result-cart-button");
    const favoriteButton = fragment.querySelector(".result-favorite-button");
    const key = `${course.subject}-${course.courseNumber}`;

    fragment.querySelector(".result-code").textContent = formatCourseCode(
      course.subject,
      course.courseNumber
    );
    fragment.querySelector(".result-title").textContent = course.title;
    fragment.querySelector(".result-meta").textContent = `${course.offeringCount} offered terms • ${formatCampuses(course.campusLabels)}`;

    if (state.activeCourseKey === key) {
      button.classList.add("is-active");
    }

    updateCourseSaveControls(course, cartButton, favoriteButton);

    button.addEventListener("click", () => {
      state.activeCourseKey = key;
      renderResults(results);
      loadHistory(course.subject, course.courseNumber);
    });

    cartButton.addEventListener("click", () => {
      const savedCourse = toSavedCourse(course);

      if (hasSavedCourse("cart", savedCourse)) {
        removeCourse("cart", savedCourse);
      } else {
        saveCourse("cart", savedCourse);
      }

      renderResults(results);
    });

    favoriteButton.addEventListener("click", () => {
      const savedCourse = toSavedCourse(course);

      if (hasSavedCourse("favorites", savedCourse)) {
        removeCourse("favorites", savedCourse);
      } else {
        saveCourse("favorites", savedCourse);
      }

      renderResults(results);
    });

    elements.resultsList.append(fragment);
  }
}

function sortSectionsByNumber(left, right) {
  return left.section.localeCompare(right.section, undefined, { numeric: true });
}

function getDisplayInstructorName(name) {
  return String(name ?? "")
    .replace(/\s+\([A-Z]+\)$/u, "")
    .trim();
}

function getInstructorNames(section) {
  const names = section.instructors
    .map((instructor) => getDisplayInstructorName(instructor.name))
    .filter(Boolean);

  return names.length ? names : ["Staff / Instructor TBD"];
}

function formatMeetingSummary(section) {
  return section.meetings
    .map((meeting) => {
      const dayLabel = meeting.days.length ? meeting.days.join("/") : "No fixed days";
      const timeLabel =
        meeting.beginTime && meeting.endTime
          ? `${meeting.beginTime} - ${meeting.endTime}`
          : "No fixed time";
      const roomLabel = [meeting.building, meeting.room].filter(Boolean).join(" ");
      return `${meeting.meetingType}: ${dayLabel}, ${timeLabel}${roomLabel ? `, ${roomLabel}` : ""}`;
    })
    .join(" | ");
}

function formatSectionList(sections) {
  return [...sections]
    .sort(sortSectionsByNumber)
    .map((section) => section.section)
    .join(", ");
}

function createTextElement(tagName, className, text) {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  return node;
}

function createBadge(label, tone) {
  const badge = document.createElement("span");
  badge.className = `syllabus-badge${tone ? ` is-${tone}` : ""}`;
  badge.textContent = label;
  return badge;
}

function buildSyllabusGroupKey(section) {
  const instructorKey = getInstructorNames(section)
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join("|")
    .toLowerCase();

  return [
    instructorKey || "staff",
    section.isHonors ? "honors" : "standard",
    (section.session ?? "").toLowerCase(),
    (section.instructionalMethod ?? "").toLowerCase(),
    (section.scheduleType ?? "").toLowerCase()
  ].join("::");
}

function groupSectionsBySyllabus(sections) {
  const groups = new Map();

  [...sections].sort(sortSectionsByNumber).forEach((section) => {
    const key = buildSyllabusGroupKey(section);
    const existing = groups.get(key);

    if (existing) {
      existing.sections.push(section);
      if (section.site) {
        existing.sites.add(section.site);
      }
      if (section.hasSyllabus && !existing.representativeSection) {
        existing.representativeSection = section;
      }
      return;
    }

    groups.set(key, {
      key,
      instructorLabel: getInstructorNames(section).join(", "),
      isHonors: Boolean(section.isHonors),
      scheduleType: section.scheduleType,
      instructionalMethod: section.instructionalMethod,
      session: section.session,
      sites: new Set(section.site ? [section.site] : []),
      representativeSection: section.hasSyllabus ? section : null,
      sections: [section]
    });
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sites: [...group.sites],
      sections: group.sections.sort(sortSectionsByNumber)
    }))
    .sort((left, right) => sortSectionsByNumber(left.sections[0], right.sections[0]));
}

function createGroupedSectionItem(section) {
  const item = document.createElement("div");
  item.className = "group-section-item";

  item.append(
    createTextElement("p", "group-section-name", `Section ${section.section} • CRN ${section.crn}`)
  );

  const metaParts = [
    section.openForRegistration ? "Open" : "Closed",
    section.scheduleType,
    section.instructionalMethod
  ].filter(Boolean);

  item.append(createTextElement("p", "group-section-detail", metaParts.join(" • ")));

  const locationParts = [section.site, section.session].filter(Boolean);
  if (locationParts.length) {
    item.append(createTextElement("p", "group-section-detail", locationParts.join(" • ")));
  }

  const meetingSummary = formatMeetingSummary(section);
  if (meetingSummary) {
    item.append(createTextElement("p", "group-section-detail", meetingSummary));
  }

  return item;
}

function formatCompareSectionsLabel(sections) {
  return `Sections ${formatSectionList(sections)}`;
}

function buildCompareSource(group, courseContext) {
  const representativeSection = group.representativeSection;
  const honorsLabel = group.isHonors ? "Honors" : "Standard";

  return {
    url: resolveSyllabusTargetUrl(representativeSection),
    label: [
      `${courseContext.subject} ${courseContext.courseNumber}`,
      courseContext.termDescription,
      group.instructorLabel,
      honorsLabel
    ]
      .filter(Boolean)
      .join(" • "),
    subject: courseContext.subject,
    courseNumber: courseContext.courseNumber,
    termCode: courseContext.termCode,
    termDescription: courseContext.termDescription,
    crn: representativeSection.crn,
    instructorLabel: group.instructorLabel,
    honorsLabel,
    sectionsLabel: formatCompareSectionsLabel(group.sections)
  };
}

function setCompareButtonState(button, compareSource) {
  const isQueued = hasCompareSource(compareSource);
  button.textContent = isQueued ? "Queued for AI" : "Add to AI compare";
  button.classList.toggle("is-active", isQueued);
}

function createSyllabusGroupCard(group, courseContext) {
  const wrapper = document.createElement("article");
  wrapper.className = "section-row syllabus-group-card";

  const header = document.createElement("div");
  header.className = "syllabus-group-header";

  const primary = document.createElement("div");
  primary.className = "syllabus-group-primary";
  primary.append(createTextElement("p", "section-name", group.instructorLabel));

  const badges = document.createElement("div");
  badges.className = "syllabus-group-badges";
  badges.append(createBadge(group.isHonors ? "Honors" : "Standard", group.isHonors ? "honors" : "standard"));
  badges.append(
    createBadge(
      `${group.sections.length} section${group.sections.length === 1 ? "" : "s"}`,
      "muted"
    )
  );
  primary.append(badges);
  header.append(primary);

  const headerMeta = [group.scheduleType, group.instructionalMethod].filter(Boolean).join(" • ");
  if (headerMeta) {
    header.append(createTextElement("span", "result-meta", headerMeta));
  }

  wrapper.append(header);

  const summaryParts = [`Sections ${formatSectionList(group.sections)}`];
  if (group.session) {
    summaryParts.push(group.session);
  }
  if (group.sites.length) {
    summaryParts.push(group.sites.join(" • "));
  }
  wrapper.append(createTextElement("p", "section-detail", summaryParts.join(" • ")));

  const syllabusSections = group.sections.filter((section) => section.hasSyllabus);

  if (group.representativeSection) {
    const noteSections = syllabusSections.length ? syllabusSections : group.sections;
    const syllabusNote =
      noteSections.length > 1
        ? `Shared syllabus for sections ${formatSectionList(noteSections)}.`
        : `Syllabus available for section ${noteSections[0].section}.`;
    wrapper.append(createTextElement("p", "section-detail group-syllabus-note", syllabusNote));
  } else {
    wrapper.append(
      createTextElement(
        "p",
        "section-detail group-syllabus-note",
        "TAMU did not expose a syllabus for this instructor group."
      )
    );
  }

  const sectionList = document.createElement("div");
  sectionList.className = "group-section-list";
  group.sections.forEach((section) => {
    sectionList.append(createGroupedSectionItem(section));
  });
  wrapper.append(sectionList);

  if (group.representativeSection) {
    const compareSource = buildCompareSource(group, courseContext);
    const syllabusButton = document.createElement("button");
    syllabusButton.className = "section-link";
    syllabusButton.type = "button";
    syllabusButton.textContent =
      group.sections.length > 1 ? "Open shared syllabus" : "Open syllabus";
    wrapper.append(syllabusButton);

    const syllabusState = document.createElement("p");
    syllabusState.className = "section-detail section-status";
    syllabusState.hidden = true;
    wrapper.append(syllabusState);

    if (compareSource.url) {
      const compareButton = document.createElement("button");
      compareButton.className = "result-action-button compare-link-button";
      compareButton.type = "button";
      setCompareButtonState(compareButton, compareSource);
      compareButton.addEventListener("click", () => {
        saveCompareSource(compareSource);
        setCompareButtonState(compareButton, compareSource);
        setSectionStatus(
          syllabusState,
          "Queued for AI compare. Stay here and keep adding syllabi, or open AI Compare from the nav when ready."
        );
      });
      wrapper.append(compareButton);
    }

    syllabusButton.addEventListener("click", () =>
      openSyllabus(group.representativeSection, syllabusButton, syllabusState)
    );
  }

  return wrapper;
}

function openPopupWindow() {
  const popup = window.open("", "_blank");
  if (popup) {
    popup.opener = null;
  }
  return popup;
}

function setSectionStatus(node, message) {
  node.hidden = !message;
  node.textContent = message;
}

function buildSimpleSyllabusUrl(section) {
  return `https://tamu.simplesyllabus.com/ui/syllabus-redirect?type=html&attribute[4]=${section.crn}.${section.termCode}`;
}

function buildLegacySyllabusUrl(section) {
  return `/api/open-syllabus?term=${encodeURIComponent(section.termCode)}&crn=${encodeURIComponent(
    section.crn
  )}`;
}

function resolveSyllabusTargetUrl(section) {
  const explicitUrl = section.syllabusUrl;

  if (explicitUrl) {
    return new URL(explicitUrl, window.location.href).href;
  }

  if (section.syllabusMode === "simple-syllabus") {
    return buildSimpleSyllabusUrl(section);
  }

  if (section.syllabusMode === "legacy") {
    return new URL(buildLegacySyllabusUrl(section), window.location.href).href;
  }

  return null;
}

async function openSyllabus(section, button, statusNode) {
  setLoading(button, true, "Opening...");
  setSectionStatus(statusNode, "");

  const popup = openPopupWindow();

  try {
    const syllabusTargetUrl = resolveSyllabusTargetUrl(section);

    if (!syllabusTargetUrl) {
      throw new Error("TAMU did not expose a usable syllabus target for this section.");
    }

    if (popup) {
      popup.location.replace(syllabusTargetUrl);
    } else {
      window.open(syllabusTargetUrl, "_blank", "noreferrer");
    }
  } catch (error) {
    if (popup) {
      popup.close();
    }
    setSectionStatus(statusNode, error.message);
  } finally {
    setLoading(button, false, "Open syllabus");
  }
}

function createInfoNote(message) {
  const note = document.createElement("div");
  note.className = "empty-state inline-note";
  note.textContent = message;
  return note;
}

function formatHistorySummary(history) {
  const newestTerm = history.terms[0];
  const oldestTerm = history.terms.at(-1);
  const campusLabel = history.campusLabels.join(" • ");

  return `${history.totalOfferedTerms} offered terms • ${oldestTerm.termDescription} through ${newestTerm.termDescription}${campusLabel ? ` • ${campusLabel}` : ""}`;
}

function updateExplorerUrl(subject, courseNumber) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("subject", subject);
  nextUrl.searchParams.set("course", courseNumber);
  nextUrl.searchParams.set("campus", state.activeCampus);
  window.history.replaceState({}, "", nextUrl);
}

async function loadSections(subject, courseNumber, termCode, container, button, card, hint) {
  container.hidden = false;
  container.innerHTML = `<div class="empty-state loading">Loading sections…</div>`;
  setLoading(button, true, "Loading...");
  if (card) {
    card.dataset.loaded = "loading";
  }
  if (hint) {
    hint.textContent = "Loading sections and syllabus links...";
  }

  try {
    const response = await fetchJson(
      `/api/course-sections?subject=${encodeURIComponent(subject)}&course=${encodeURIComponent(
        courseNumber
      )}&term=${encodeURIComponent(termCode)}`
    );

    container.innerHTML = "";

    if (!response.sections.length) {
      container.innerHTML = `<div class="empty-state">No section rows came back for this term, even though the catalog reported offerings.</div>`;
      if (card) {
        card.dataset.loaded = "loaded";
      }
      if (hint) {
        hint.textContent = "No section rows returned for this term";
      }
      return;
    }

    const groupedSections = groupSectionsBySyllabus(response.sections);
    groupedSections.forEach((group) => {
      container.append(
        createSyllabusGroupCard(group, {
          subject,
          courseNumber,
          termCode,
          termDescription:
            card?.querySelector(".term-title")?.textContent || termCode
        })
      );
    });

    const syllabusGroupCount = groupedSections.filter(
      (group) => group.representativeSection
    ).length;

    if (!syllabusGroupCount) {
      container.append(
        createInfoNote("TAMU did not expose any syllabus links for this term.")
      );
    }

    if (card) {
      card.dataset.loaded = "loaded";
    }
    if (hint) {
      hint.textContent = syllabusGroupCount
        ? `${syllabusGroupCount} syllabus group${syllabusGroupCount === 1 ? "" : "s"} across ${response.sections.length} section${response.sections.length === 1 ? "" : "s"}`
        : "No syllabus links exposed by TAMU for this term";
    }
  } catch (error) {
    container.innerHTML = `<div class="empty-state">${error.message}</div>`;
    if (card) {
      card.dataset.loaded = "error";
    }
    if (hint) {
      hint.textContent = "Could not load this term";
    }
  } finally {
    setLoading(button, false, "Refresh sections");
  }
}

function renderHistory(history) {
  elements.historyTitle.textContent = `${history.subject} ${history.courseNumber}`;
  elements.historySummary.textContent = formatHistorySummary(history);
  elements.historyState.hidden = true;
  elements.historyList.hidden = false;
  elements.historyList.innerHTML = "";

  for (const term of history.terms) {
    const fragment = elements.termTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".term-card");
    const hint = fragment.querySelector(".term-hint");
    const button = fragment.querySelector(".term-button");
    const sectionsContainer = fragment.querySelector(".term-sections");

    fragment.querySelector(".term-code").textContent = term.termCode;
    fragment.querySelector(".term-title").textContent = term.termDescription;
    fragment.querySelector(".term-meta").textContent = `${term.sectionsCount} sections • ${term.campusLabel}${term.college ? ` • ${term.college}` : ""}`;
    fragment.querySelector(".term-narrative").textContent =
      term.narrative || "No catalog narrative was returned for this term.";

    button.textContent = "Refresh sections";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      loadSections(
        history.subject,
        history.courseNumber,
        term.termCode,
        sectionsContainer,
        button,
        card,
        hint
      );
    });

    card.addEventListener("toggle", () => {
      if (
        card.open &&
        card.dataset.loaded !== "loaded" &&
        card.dataset.loaded !== "loading"
      ) {
        loadSections(
          history.subject,
          history.courseNumber,
          term.termCode,
          sectionsContainer,
          button,
          card,
          hint
        );
      }
    });

    card.dataset.termCode = term.termCode;
    card.dataset.loaded = "idle";
    elements.historyList.append(fragment);
  }

  const firstTermCard = elements.historyList.querySelector(".term-card");
  if (firstTermCard) {
    firstTermCard.open = true;
  }
}

async function loadHistory(subject, courseNumber) {
  showHistoryState("Loading semester history...", formatCourseCode(subject, courseNumber));
  updateExplorerUrl(subject, courseNumber);

  try {
    const history = await fetchJson(
      `/api/course-history?subject=${encodeURIComponent(subject)}&course=${encodeURIComponent(
        courseNumber
      )}&campus=${encodeURIComponent(state.activeCampus)}`
    );

    renderHistory(history);
  } catch (error) {
    showHistoryState(error.message, formatCourseCode(subject, courseNumber));
  }
}

async function handleSearch(event) {
  event.preventDefault();

  const query = elements.query.value.trim();
  const campus = elements.campus.value;
  state.activeCampus = campus;
  state.activeCourseKey = null;

  if (!query) {
    showResultsState("Type a course code or title before searching.");
    showHistoryState("Matching semester history will appear here.");
    return;
  }

  showResultsState("Searching course catalog history...");
  showHistoryState("Search results will drive the semester timeline.");
  setLoading(elements.searchButton, true, "Working...");

  try {
    const payload = await fetchJson(
      `/api/search-courses?q=${encodeURIComponent(query)}&campus=${encodeURIComponent(campus)}`
    );

    renderResults(payload.results);

    if (payload.results.length === 1) {
      const onlyMatch = payload.results[0];
      state.activeCourseKey = `${onlyMatch.subject}-${onlyMatch.courseNumber}`;
      renderResults(payload.results);
      await loadHistory(onlyMatch.subject, onlyMatch.courseNumber);
    } else {
      showHistoryState("Select one of the course matches on the left to load its semester-by-semester offering history.");
    }
  } catch (error) {
    showResultsState(error.message);
    showHistoryState("Search failed. Check the server terminal for details.");
  } finally {
    setLoading(elements.searchButton, false, "Search offerings");
  }
}

async function initializeFromUrl() {
  const url = new URL(window.location.href);
  const subject = url.searchParams.get("subject")?.trim().toUpperCase();
  const courseNumber = url.searchParams.get("course")?.trim().toUpperCase();
  const campus = url.searchParams.get("campus")?.trim().toLowerCase();

  if (campus) {
    state.activeCampus = campus;
    elements.campus.value = campus;
  }

  if (!subject || !courseNumber) {
    return;
  }

  const query = formatSavedCourseCode({ subject, courseNumber });
  elements.query.value = query;
  showResultsState("Loading shared course link...");
  showHistoryState("Loading semester history...");
  setLoading(elements.searchButton, true, "Working...");

  try {
    const payload = await fetchJson(
      `/api/search-courses?q=${encodeURIComponent(query)}&campus=${encodeURIComponent(
        state.activeCampus
      )}`
    );
    const exactMatch = payload.results.find(
      (course) => course.subject === subject && course.courseNumber === courseNumber
    );

    renderResults(payload.results);

    if (!exactMatch) {
      showHistoryState(`No offered terms found for ${query}.`, query);
      return;
    }

    state.activeCourseKey = `${subject}-${courseNumber}`;
    renderResults(payload.results);
    await loadHistory(subject, courseNumber);
  } catch (error) {
    showResultsState(error.message);
    showHistoryState("Could not load the shared course link.", query);
  } finally {
    setLoading(elements.searchButton, false, "Search offerings");
  }
}

elements.form.addEventListener("submit", handleSearch);
startSavedCourseBadgeSync();
initializeFromUrl();
