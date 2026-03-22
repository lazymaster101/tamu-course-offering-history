const STORAGE_KEYS = {
  plan: "tamu-course-cart-v1",
  cart: "tamu-course-cart-v1",
  favorites: "tamu-course-favorites-v1"
};
const SCHEDULES_STORAGE_KEY = "tamu-favorite-schedules-v1";

const COLLECTION_NAMES = new Set(Object.keys(STORAGE_KEYS));

function isCollectionName(value) {
  return COLLECTION_NAMES.has(value);
}

function readStorageArray(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorageArray(key, items) {
  window.localStorage.setItem(key, JSON.stringify(items));
}

function emitSavedCoursesChanged() {
  window.dispatchEvent(new CustomEvent("saved-courses-changed"));
}

function requireCollectionName(collectionName) {
  if (!isCollectionName(collectionName)) {
    throw new Error(`Unknown saved-course collection: ${collectionName}`);
  }
}

export function buildSavedCourseId(course) {
  return [
    String(course.subject ?? "").trim().toUpperCase(),
    String(course.courseNumber ?? "").trim().toUpperCase(),
    String(course.campus ?? "college-station").trim().toLowerCase()
  ].join("::");
}

export function toSavedCourseRecord(course) {
  const campus = String(course.campus ?? "college-station").trim().toLowerCase();
  const campusLabel =
    course.campusLabel ??
    (Array.isArray(course.campusLabels) && course.campusLabels.length
      ? course.campusLabels.join(" • ")
      : "College Station");

  return {
    id: buildSavedCourseId({ ...course, campus }),
    subject: String(course.subject ?? "").trim().toUpperCase(),
    courseNumber: String(course.courseNumber ?? "").trim().toUpperCase(),
    title: String(course.title ?? "").trim(),
    campus,
    campusLabel: String(campusLabel).trim(),
    latestTermCode: course.latestTermCode ? String(course.latestTermCode) : null,
    latestTermDescription: course.latestTermDescription
      ? String(course.latestTermDescription)
      : null,
    offeringCount:
      typeof course.offeringCount === "number" ? course.offeringCount : null,
    savedAt: course.savedAt ?? new Date().toISOString()
  };
}

export function getSavedCourses(collectionName) {
  requireCollectionName(collectionName);
  return readStorageArray(STORAGE_KEYS[collectionName]);
}

export function hasSavedCourse(collectionName, course) {
  requireCollectionName(collectionName);
  const courseId = buildSavedCourseId(course);
  return getSavedCourses(collectionName).some((item) => item.id === courseId);
}

export function saveCourse(collectionName, course) {
  requireCollectionName(collectionName);
  const nextCourse = toSavedCourseRecord(course);
  const existing = getSavedCourses(collectionName).filter((item) => item.id !== nextCourse.id);
  existing.unshift(nextCourse);
  writeStorageArray(STORAGE_KEYS[collectionName], existing);
  emitSavedCoursesChanged();
  return nextCourse;
}

export function removeCourse(collectionName, course) {
  requireCollectionName(collectionName);
  const courseId = buildSavedCourseId(course);
  const existing = getSavedCourses(collectionName).filter((item) => item.id !== courseId);
  writeStorageArray(STORAGE_KEYS[collectionName], existing);
  emitSavedCoursesChanged();
}

export function toggleSavedCourse(collectionName, course) {
  if (hasSavedCourse(collectionName, course)) {
    removeCourse(collectionName, course);
    return false;
  }

  saveCourse(collectionName, course);
  return true;
}

export function getSavedCourseCounts() {
  const planCount = getSavedCourses("plan").length;
  return {
    plan: planCount,
    cart: planCount,
    favorites: getSavedCourses("favorites").length
  };
}

export function subscribeToSavedCourses(listener) {
  const handler = () => listener();
  window.addEventListener("saved-courses-changed", handler);
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener("saved-courses-changed", handler);
    window.removeEventListener("storage", handler);
  };
}

export function buildFavoriteScheduleId(scheduleRecord) {
  const termCode = String(scheduleRecord?.termCode ?? "").trim();
  const crns = Array.isArray(scheduleRecord?.sections)
    ? scheduleRecord.sections
        .map((section) => String(section?.crn ?? "").trim())
        .filter(Boolean)
        .sort()
    : [];

  return [termCode || "term", ...crns].join("::");
}

function normalizeFavoriteScheduleSection(section) {
  return {
    courseCode: String(section?.courseCode ?? "").trim().toUpperCase(),
    courseTitle: String(section?.courseTitle ?? "").trim(),
    crn: String(section?.crn ?? "").trim(),
    section: String(section?.section ?? "").trim(),
    hours: Number.isFinite(Number(section?.hours)) ? Number(section.hours) : 0,
    instructors: Array.isArray(section?.instructors)
      ? section.instructors.map((name) => String(name ?? "").trim()).filter(Boolean)
      : [],
    meetings: Array.isArray(section?.meetings)
      ? section.meetings.map((meeting) => ({
          meetingType: String(meeting?.meetingType ?? "").trim(),
          days: Array.isArray(meeting?.days)
            ? meeting.days.map((day) => String(day ?? "").trim()).filter(Boolean)
            : [],
          beginTime: meeting?.beginTime ?? null,
          endTime: meeting?.endTime ?? null,
          building: String(meeting?.building ?? "").trim(),
          room: String(meeting?.room ?? "").trim()
        }))
      : []
  };
}

export function normalizeFavoriteSchedule(scheduleRecord) {
  const sections = Array.isArray(scheduleRecord?.sections)
    ? scheduleRecord.sections.map(normalizeFavoriteScheduleSection)
    : [];

  return {
    id: buildFavoriteScheduleId({ ...scheduleRecord, sections }),
    label: String(scheduleRecord?.label ?? "").trim() || "Favorite schedule",
    campus: String(scheduleRecord?.campus ?? "college-station").trim().toLowerCase(),
    campusLabel: String(scheduleRecord?.campusLabel ?? "College Station").trim(),
    termCode: String(scheduleRecord?.termCode ?? "").trim() || null,
    termDescription: String(scheduleRecord?.termDescription ?? "").trim() || null,
    optionId: String(scheduleRecord?.optionId ?? "").trim() || null,
    totalCredits:
      Number.isFinite(Number(scheduleRecord?.totalCredits))
        ? Number(scheduleRecord.totalCredits)
        : sections.reduce((sum, section) => sum + Number(section?.hours ?? 0), 0),
    scheduledCourseCount:
      Number.isFinite(Number(scheduleRecord?.scheduledCourseCount))
        ? Number(scheduleRecord.scheduledCourseCount)
        : sections.length,
    requestedCourseCount:
      Number.isFinite(Number(scheduleRecord?.requestedCourseCount))
        ? Number(scheduleRecord.requestedCourseCount)
        : sections.length,
    sections,
    savedAt: scheduleRecord?.savedAt ?? new Date().toISOString()
  };
}

export function getFavoriteSchedules() {
  return readStorageArray(SCHEDULES_STORAGE_KEY);
}

export function hasFavoriteSchedule(scheduleRecord) {
  const scheduleId = buildFavoriteScheduleId(scheduleRecord);
  return getFavoriteSchedules().some((item) => item.id === scheduleId);
}

export function saveFavoriteSchedule(scheduleRecord) {
  const nextSchedule = normalizeFavoriteSchedule(scheduleRecord);
  const nextItems = getFavoriteSchedules().filter((item) => item.id !== nextSchedule.id);
  nextItems.unshift(nextSchedule);
  writeStorageArray(SCHEDULES_STORAGE_KEY, nextItems);
  emitSavedCoursesChanged();
  return nextSchedule;
}

export function removeFavoriteSchedule(scheduleRecordOrId) {
  const scheduleId =
    typeof scheduleRecordOrId === "string"
      ? scheduleRecordOrId
      : buildFavoriteScheduleId(scheduleRecordOrId);
  const nextItems = getFavoriteSchedules().filter((item) => item.id !== scheduleId);
  writeStorageArray(SCHEDULES_STORAGE_KEY, nextItems);
  emitSavedCoursesChanged();
}

export function toggleFavoriteSchedule(scheduleRecord) {
  if (hasFavoriteSchedule(scheduleRecord)) {
    removeFavoriteSchedule(scheduleRecord);
    return false;
  }

  saveFavoriteSchedule(scheduleRecord);
  return true;
}

export function buildExplorerUrl(course) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("subject", String(course.subject ?? "").trim().toUpperCase());
  url.searchParams.set("course", String(course.courseNumber ?? "").trim().toUpperCase());
  url.searchParams.set("campus", String(course.campus ?? "college-station").trim().toLowerCase());
  return url.toString();
}

export function formatSavedCourseCode(course) {
  return `${course.subject} ${course.courseNumber}`;
}
