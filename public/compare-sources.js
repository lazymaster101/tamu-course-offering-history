const STORAGE_KEY = "tamu-compare-sources-v1";
export const MAX_COMPARE_SOURCES = 5;

function readSources() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSources(items) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function emitChanged() {
  window.dispatchEvent(new CustomEvent("compare-sources-changed"));
}

export function buildCompareSourceId(source) {
  const url = String(source.url ?? "").trim();
  const crn = String(source.crn ?? "").trim();
  const termCode = String(source.termCode ?? "").trim();

  if (termCode && crn) {
    return `${termCode}::${crn}`;
  }

  return url || crypto.randomUUID();
}

export function normalizeCompareSource(source) {
  return {
    id: buildCompareSourceId(source),
    label: String(source.label ?? "").trim() || "Untitled syllabus source",
    url: String(source.url ?? "").trim(),
    subject: String(source.subject ?? "").trim().toUpperCase() || null,
    courseNumber: String(source.courseNumber ?? "").trim().toUpperCase() || null,
    termCode: String(source.termCode ?? "").trim() || null,
    termDescription: String(source.termDescription ?? "").trim() || null,
    crn: String(source.crn ?? "").trim() || null,
    instructorLabel: String(source.instructorLabel ?? "").trim() || null,
    honorsLabel: String(source.honorsLabel ?? "").trim() || null,
    sectionsLabel: String(source.sectionsLabel ?? "").trim() || null,
    savedAt: source.savedAt ?? new Date().toISOString()
  };
}

export function getCompareSources() {
  return readSources();
}

export function hasCompareSource(source) {
  const sourceId = buildCompareSourceId(source);
  return getCompareSources().some((item) => item.id === sourceId);
}

export function saveCompareSource(source) {
  const nextSource = normalizeCompareSource(source);
  const nextItems = getCompareSources().filter((item) => item.id !== nextSource.id);
  nextItems.unshift(nextSource);
  writeSources(nextItems.slice(0, MAX_COMPARE_SOURCES));
  emitChanged();
  return nextSource;
}

export function removeCompareSource(sourceOrId) {
  const sourceId =
    typeof sourceOrId === "string" ? sourceOrId : buildCompareSourceId(sourceOrId);
  const nextItems = getCompareSources().filter((item) => item.id !== sourceId);
  writeSources(nextItems);
  emitChanged();
}

export function clearCompareSources() {
  writeSources([]);
  emitChanged();
}

export function toggleCompareSource(source) {
  if (hasCompareSource(source)) {
    removeCompareSource(source);
    return false;
  }

  saveCompareSource(source);
  return true;
}

export function subscribeToCompareSources(listener) {
  const handler = () => listener();
  window.addEventListener("compare-sources-changed", handler);
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener("compare-sources-changed", handler);
    window.removeEventListener("storage", handler);
  };
}
