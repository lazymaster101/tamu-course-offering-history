const STORAGE_KEYS = {
  cart: "tamu-course-cart-v1",
  favorites: "tamu-course-favorites-v1"
};

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
  return {
    cart: getSavedCourses("cart").length,
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
