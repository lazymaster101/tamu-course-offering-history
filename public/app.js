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

function formatCampuses(labels) {
  return labels.join(" • ");
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

    button.addEventListener("click", () => {
      state.activeCourseKey = key;
      renderResults(results);
      loadHistory(course.subject, course.courseNumber);
    });

    elements.resultsList.append(fragment);
  }
}

function createSectionRow(section) {
  const wrapper = document.createElement("article");
  wrapper.className = "section-row";

  const instructorNames = section.instructors.map((instructor) => instructor.name).join(", ");
  const meetingSummary = section.meetings
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

  wrapper.innerHTML = `
    <div class="section-row-header">
      <p class="section-name">Section ${section.section} • CRN ${section.crn}</p>
      <span class="result-meta">${section.scheduleType} • ${section.instructionalMethod}</span>
    </div>
    <p class="section-detail">${section.openForRegistration ? "Open" : "Closed"} for registration${section.site ? ` • ${section.site}` : ""}${section.session ? ` • ${section.session}` : ""}</p>
    ${instructorNames ? `<p class="section-detail">Instructor${section.instructors.length > 1 ? "s" : ""}: ${instructorNames}</p>` : ""}
    ${meetingSummary ? `<p class="section-detail">${meetingSummary}</p>` : ""}
  `;

  if (section.hasSyllabus) {
    const syllabusButton = document.createElement("button");
    syllabusButton.className = "section-link";
    syllabusButton.type = "button";
    syllabusButton.textContent = "Open syllabus";
    wrapper.append(syllabusButton);

    const syllabusState = document.createElement("p");
    syllabusState.className = "section-detail section-status";
    syllabusState.hidden = true;
    wrapper.append(syllabusState);

    syllabusButton.addEventListener("click", () =>
      openSyllabus(section, syllabusButton, syllabusState)
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

async function fetchSyllabusInfo(section) {
  return fetchJson(
    `/api/course-syllabus-info?term=${encodeURIComponent(section.termCode)}&crn=${encodeURIComponent(
      section.crn
    )}`
  );
}

async function fetchSyllabusPdf(section) {
  const response = await fetch(
    `/api/course-syllabus-pdf?term=${encodeURIComponent(section.termCode)}&crn=${encodeURIComponent(
      section.crn
    )}`
  );

  if (!response.ok) {
    let errorMessage = "Could not load the syllabus PDF.";

    try {
      const payload = await response.json();
      errorMessage = payload.error || errorMessage;
    } catch {
      const fallbackMessage = await response.text();
      if (fallbackMessage) {
        errorMessage = fallbackMessage;
      }
    }

    throw new Error(errorMessage);
  }

  return response.blob();
}

async function openSyllabus(section, button, statusNode) {
  setLoading(button, true, "Opening...");
  setSectionStatus(statusNode, "");

  const popup = openPopupWindow();

  try {
    if (section.syllabusMode === "simple-syllabus") {
      const simpleSyllabusUrl = buildSimpleSyllabusUrl(section);
      if (popup) {
        popup.location.replace(simpleSyllabusUrl);
      } else {
        window.open(simpleSyllabusUrl, "_blank", "noreferrer");
      }
      return;
    }

    const syllabusInfo = await fetchSyllabusInfo(section);

    if (syllabusInfo.selectionType === "L" && syllabusInfo.linkUrl) {
      if (popup) {
        popup.location.replace(syllabusInfo.linkUrl);
      } else {
        window.open(syllabusInfo.linkUrl, "_blank", "noreferrer");
      }
      return;
    }

    if (syllabusInfo.selectionType === "F") {
      const pdfBlob = await fetchSyllabusPdf(section);
      const objectUrl = URL.createObjectURL(pdfBlob);

      if (popup) {
        popup.location.replace(objectUrl);
      } else {
        window.open(objectUrl, "_blank", "noreferrer");
      }

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 60_000);
      return;
    }

    throw new Error("TAMU did not return a usable syllabus target for this section.");
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

    response.sections.forEach((section) => {
      container.append(createSectionRow(section));
    });

    const syllabusCount = response.sections.filter(
      (section) => section.hasSyllabus && section.syllabusUrl
    ).length;

    if (!syllabusCount) {
      container.append(
        createInfoNote("TAMU did not expose any syllabus links for this term.")
      );
    }

    if (card) {
      card.dataset.loaded = "loaded";
    }
    if (hint) {
      hint.textContent = syllabusCount
        ? `${syllabusCount} syllabus link${syllabusCount === 1 ? "" : "s"} available`
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

elements.form.addEventListener("submit", handleSearch);
