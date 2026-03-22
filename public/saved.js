import {
  buildExplorerUrl,
  formatSavedCourseCode,
  getFavoriteSchedules,
  getSavedCourses,
  hasSavedCourse,
  removeCourse,
  removeFavoriteSchedule,
  saveCourse,
  subscribeToSavedCourses
} from "./saved-courses.js";
import {
  getCompareSources,
  removeCompareSource,
  subscribeToCompareSources
} from "./compare-sources.js";
import { startSavedCourseBadgeSync } from "./page-shell.js";

const elements = {
  planState: document.querySelector("#plan-state"),
  planList: document.querySelector("#plan-list"),
  schedulesState: document.querySelector("#schedules-state"),
  schedulesList: document.querySelector("#schedules-list"),
  shortlistState: document.querySelector("#shortlist-state"),
  shortlistList: document.querySelector("#shortlist-list"),
  favoritesState: document.querySelector("#favorites-state"),
  favoritesList: document.querySelector("#favorites-list"),
  courseTemplate: document.querySelector("#saved-course-template"),
  shortlistTemplate: document.querySelector("#saved-shortlist-template"),
  scheduleTemplate: document.querySelector("#saved-schedule-template")
};

function setActionButtonState(button, isActive, activeLabel, inactiveLabel) {
  button.textContent = isActive ? activeLabel : inactiveLabel;
  button.classList.toggle("is-active", isActive);
}

function formatCourseMeta(course) {
  const parts = [course.campusLabel];

  if (course.offeringCount) {
    parts.push(`${course.offeringCount} offered terms`);
  }

  if (course.latestTermDescription) {
    parts.push(`Latest seen: ${course.latestTermDescription}`);
  }

  return parts.join(" • ");
}

function formatShortlistCode(source) {
  if (source.subject && source.courseNumber) {
    return `${source.subject} ${source.courseNumber}`;
  }

  return "Shortlisted syllabus";
}

function formatShortlistMeta(source) {
  return [
    source.termDescription,
    source.sectionsLabel,
    source.instructorLabel,
    source.honorsLabel
  ]
    .filter(Boolean)
    .join(" • ");
}

function createTag(label, tone) {
  const tag = document.createElement("span");
  tag.className = `syllabus-badge${tone ? ` is-${tone}` : ""}`;
  tag.textContent = label;
  return tag;
}

function createSavedCourseCard(course, primaryCollection) {
  const fragment = elements.courseTemplate.content.cloneNode(true);
  const tags = fragment.querySelector(".saved-course-tags");
  const titleNode = fragment.querySelector(".saved-course-title");
  const codeNode = fragment.querySelector(".saved-course-code");
  const metaNode = fragment.querySelector(".saved-course-meta");
  const openLink = fragment.querySelector(".saved-course-link");
  const togglePlanButton = fragment.querySelector(".saved-toggle-cart");
  const toggleFavoriteButton = fragment.querySelector(".saved-toggle-favorite");

  codeNode.textContent = formatSavedCourseCode(course);
  titleNode.textContent = course.title;
  metaNode.textContent = formatCourseMeta(course);
  openLink.href = buildExplorerUrl(course);
  openLink.textContent = "Open offerings";

  tags.append(createTag(primaryCollection === "plan" ? "Semester Plan" : "Favorite", "muted"));
  tags.append(createTag(course.campusLabel, "standard"));

  setActionButtonState(
    togglePlanButton,
    hasSavedCourse("plan", course),
    "Remove from semester plan",
    "Add to semester plan"
  );
  setActionButtonState(
    toggleFavoriteButton,
    hasSavedCourse("favorites", course),
    "Remove favorite",
    "Add favorite"
  );

  togglePlanButton.addEventListener("click", () => {
    if (hasSavedCourse("plan", course)) {
      removeCourse("plan", course);
    } else {
      saveCourse("plan", course);
    }
    renderSavedCollections();
  });

  toggleFavoriteButton.addEventListener("click", () => {
    if (hasSavedCourse("favorites", course)) {
      removeCourse("favorites", course);
    } else {
      saveCourse("favorites", course);
    }
    renderSavedCollections();
  });

  return fragment;
}

function createShortlistCard(source) {
  const fragment = elements.shortlistTemplate.content.cloneNode(true);
  const tags = fragment.querySelector(".saved-course-tags");
  const codeNode = fragment.querySelector(".saved-shortlist-code");
  const titleNode = fragment.querySelector(".saved-shortlist-title");
  const metaNode = fragment.querySelector(".saved-shortlist-meta");
  const openLink = fragment.querySelector(".saved-shortlist-open");
  const compareLink = fragment.querySelector(".saved-shortlist-compare");
  const removeButton = fragment.querySelector(".saved-shortlist-remove");

  codeNode.textContent = formatShortlistCode(source);
  titleNode.textContent = source.label;
  metaNode.textContent = formatShortlistMeta(source);
  openLink.href = source.url || "/compare.html";
  compareLink.href = "/compare.html";

  tags.append(createTag("Shortlist", "muted"));
  if (source.honorsLabel) {
    tags.append(createTag(source.honorsLabel, source.honorsLabel === "Honors" ? "honors" : "standard"));
  }

  removeButton.addEventListener("click", () => {
    removeCompareSource(source.id);
    renderSavedCollections();
  });

  return fragment;
}

function formatScheduleMeta(schedule) {
  const parts = [
    schedule.termDescription,
    schedule.campusLabel,
    `${schedule.scheduledCourseCount}/${schedule.requestedCourseCount} courses`,
    `${schedule.totalCredits} hrs`
  ].filter(Boolean);

  return parts.join(" • ");
}

function createScheduleCard(schedule) {
  const fragment = elements.scheduleTemplate.content.cloneNode(true);
  const tags = fragment.querySelector(".saved-course-tags");
  const codeNode = fragment.querySelector(".saved-schedule-code");
  const titleNode = fragment.querySelector(".saved-schedule-title");
  const metaNode = fragment.querySelector(".saved-schedule-meta");
  const sectionsNode = fragment.querySelector(".saved-schedule-sections");
  const openLink = fragment.querySelector(".saved-schedule-open");
  const removeButton = fragment.querySelector(".saved-schedule-remove");

  codeNode.textContent = schedule.termCode || "Saved schedule";
  titleNode.textContent = schedule.label || schedule.termDescription || "Favorite schedule";
  metaNode.textContent = formatScheduleMeta(schedule);
  openLink.href = "/planner.html";

  tags.append(createTag("Schedule", "muted"));
  tags.append(createTag(schedule.campusLabel || "College Station", "standard"));

  (schedule.sections ?? []).forEach((section) => {
    const chip = document.createElement("p");
    chip.className = "saved-schedule-section";
    chip.textContent = `${section.courseCode} • ${section.section} • ${
      section.instructors?.[0] || "Staff / TBD"
    }`;
    sectionsNode.append(chip);
  });

  removeButton.addEventListener("click", () => {
    removeFavoriteSchedule(schedule.id);
    renderSavedCollections();
  });

  return fragment;
}

function renderCourseCollection(collectionName, stateNode, listNode) {
  const courses = getSavedCourses(collectionName);
  listNode.innerHTML = "";

  if (!courses.length) {
    stateNode.hidden = false;
    listNode.hidden = true;
    return;
  }

  stateNode.hidden = true;
  listNode.hidden = false;
  courses.forEach((course) => {
    listNode.append(createSavedCourseCard(course, collectionName));
  });
}

function renderShortlistCollection() {
  const sources = getCompareSources();
  elements.shortlistList.innerHTML = "";

  if (!sources.length) {
    elements.shortlistState.hidden = false;
    elements.shortlistList.hidden = true;
    return;
  }

  elements.shortlistState.hidden = true;
  elements.shortlistList.hidden = false;
  sources.forEach((source) => {
    elements.shortlistList.append(createShortlistCard(source));
  });
}

function renderFavoriteSchedulesCollection() {
  const schedules = getFavoriteSchedules();
  elements.schedulesList.innerHTML = "";

  const countNode = document.querySelector("[data-saved-schedule-count]");
  if (countNode) {
    countNode.textContent = String(schedules.length);
  }

  if (!schedules.length) {
    elements.schedulesState.hidden = false;
    elements.schedulesList.hidden = true;
    return;
  }

  elements.schedulesState.hidden = true;
  elements.schedulesList.hidden = false;
  schedules.forEach((schedule) => {
    elements.schedulesList.append(createScheduleCard(schedule));
  });
}

function renderSavedCollections() {
  renderCourseCollection("plan", elements.planState, elements.planList);
  renderFavoriteSchedulesCollection();
  renderShortlistCollection();
  renderCourseCollection("favorites", elements.favoritesState, elements.favoritesList);
}

startSavedCourseBadgeSync();
renderSavedCollections();
subscribeToSavedCourses(renderSavedCollections);
subscribeToCompareSources(renderSavedCollections);
