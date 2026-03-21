import { getSavedCourseCounts, subscribeToSavedCourses } from "./saved-courses.js";
import { getCompareSources, subscribeToCompareSources } from "./compare-sources.js";

const AUTOCOMPLETE_DATALIST_ID = "course-search-autocomplete";
const autocompleteTimers = new WeakMap();
const autocompleteControllers = new WeakMap();
const autocompleteAttached = new WeakSet();

function getQuickSearchValue() {
  const url = new URL(window.location.href);
  const query = url.searchParams.get("q")?.trim();
  const subject = url.searchParams.get("subject")?.trim().toUpperCase();
  const course = url.searchParams.get("course")?.trim().toUpperCase();

  if (query) {
    return query;
  }

  if (subject && course) {
    return `${subject} ${course}`;
  }

  return "";
}

function syncQuickSearchInputs() {
  const value = getQuickSearchValue();
  document.querySelectorAll(".app-quick-search-input").forEach((node) => {
    if (node instanceof HTMLInputElement) {
      node.value = value;
    }
  });
}

function ensureAutocompleteDatalist() {
  let datalist = document.querySelector(`#${AUTOCOMPLETE_DATALIST_ID}`);
  if (datalist instanceof HTMLDataListElement) {
    return datalist;
  }

  datalist = document.createElement("datalist");
  datalist.id = AUTOCOMPLETE_DATALIST_ID;
  document.body.append(datalist);
  return datalist;
}

function setAutocompleteOptions(options) {
  const datalist = ensureAutocompleteDatalist();
  datalist.innerHTML = "";

  options.forEach((course) => {
    const option = document.createElement("option");
    option.value = `${course.subject} ${course.courseNumber}`;
    option.label = course.title;
    option.textContent = `${course.title} • ${course.offeringCount ?? 0} terms`;
    datalist.append(option);
  });
}

async function fetchAutocompleteOptions(query, campus, signal) {
  const response = await fetch(
    `/api/search-courses?q=${encodeURIComponent(query)}&campus=${encodeURIComponent(campus)}`,
    { signal }
  );

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results.slice(0, 8) : [];
}

export function attachCourseAutocomplete(
  input,
  getCampus = () => "college-station"
) {
  if (!(input instanceof HTMLInputElement) || autocompleteAttached.has(input)) {
    return;
  }

  autocompleteAttached.add(input);
  input.setAttribute("list", AUTOCOMPLETE_DATALIST_ID);
  ensureAutocompleteDatalist();

  const runAutocomplete = () => {
    const query = input.value.trim();
    const campus = String(getCampus?.() ?? "college-station").trim().toLowerCase() || "college-station";

    window.clearTimeout(autocompleteTimers.get(input));
    autocompleteControllers.get(input)?.abort();

    if (query.length < 2) {
      setAutocompleteOptions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      autocompleteControllers.set(input, controller);

      try {
        const options = await fetchAutocompleteOptions(query, campus, controller.signal);
        if (input.value.trim() !== query) {
          return;
        }
        setAutocompleteOptions(options);
      } catch {
        setAutocompleteOptions([]);
      } finally {
        if (autocompleteControllers.get(input) === controller) {
          autocompleteControllers.delete(input);
        }
      }
    }, 180);

    autocompleteTimers.set(input, timer);
  };

  input.addEventListener("input", runAutocomplete);
  input.addEventListener("focus", runAutocomplete);
}

function initQuickSearchAutocomplete() {
  document.querySelectorAll(".app-quick-search-input").forEach((node) => {
    attachCourseAutocomplete(node, () => {
      const url = new URL(window.location.href);
      return url.searchParams.get("campus")?.trim().toLowerCase() || "college-station";
    });
  });
}

function syncShellNavState() {
  const page = document.body?.dataset.page ?? "";
  const rawHash = window.location.hash || "#plan";
  const currentHash = rawHash === "#cart" ? "#plan" : rawHash;

  document.querySelectorAll("[data-shell-page]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.shellPage === page);
  });

  document.querySelectorAll("[data-shell-section]").forEach((link) => {
    const section = link.dataset.shellSection;
    const isActiveSavedSection =
      page === "saved" && currentHash === `#${section}`;
    link.classList.toggle("is-active", isActiveSavedSection);
  });
}

export function syncSavedCourseBadges() {
  const counts = getSavedCourseCounts();
  const planNodes = document.querySelectorAll(
    '#cart-count-badge, #cart-count-summary, [data-saved-count="cart"], [data-saved-count="plan"]'
  );
  const favoriteNodes = document.querySelectorAll(
    '#favorite-count-badge, #favorite-count-summary, [data-saved-count="favorites"]'
  );
  const shortlistNodes = document.querySelectorAll('[data-shortlist-count]');
  const shortlistCount = getCompareSources().length;

  planNodes.forEach((node) => {
    node.textContent = String(counts.plan);
  });

  favoriteNodes.forEach((node) => {
    node.textContent = String(counts.favorites);
  });

  shortlistNodes.forEach((node) => {
    node.textContent = String(shortlistCount);
  });
}

export function startSavedCourseBadgeSync() {
  syncSavedCourseBadges();
  syncQuickSearchInputs();
  syncShellNavState();
  initQuickSearchAutocomplete();

  const unsubscribeSaved = subscribeToSavedCourses(syncSavedCourseBadges);
  const unsubscribeShortlist = subscribeToCompareSources(syncSavedCourseBadges);
  window.addEventListener("hashchange", syncShellNavState);

  return () => {
    unsubscribeSaved?.();
    unsubscribeShortlist?.();
    window.removeEventListener("hashchange", syncShellNavState);
  };
}
