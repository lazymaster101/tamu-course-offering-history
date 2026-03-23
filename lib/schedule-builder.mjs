import { getCourseSections, requireCatalogIndex } from "./vercel-api.mjs";

const DEFAULT_CAMPUS = "college-station";
const MAX_CANDIDATES_PER_COURSE = 6;
const MAX_SEARCH_STATES = 6000;
const MAX_RETURNED_SCHEDULES = 4;
const MAX_HISTORICAL_SYLLABUS_TERMS = 4;
const MAX_HISTORICAL_SYLLABUS_SOURCES = 4;
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeCourseCode(codeOrSubject, courseNumber) {
  if (courseNumber != null) {
    const subject = String(codeOrSubject ?? "").trim().toUpperCase();
    const number = String(courseNumber ?? "").trim().toUpperCase();
    return subject && number ? `${subject} ${number}` : null;
  }

  const match = String(codeOrSubject ?? "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2,5})[\s-]*([0-9]{3}[A-Z]?)$/u);
  return match ? `${match[1]} ${match[2]}` : null;
}

function parseCourseCode(input) {
  const normalized = normalizeCourseCode(input?.code ?? "", null)
    || normalizeCourseCode(input?.subject ?? "", input?.courseNumber ?? "");

  if (!normalized) {
    return null;
  }

  const [subject, courseNumber] = normalized.split(" ");
  return {
    code: normalized,
    subject,
    courseNumber
  };
}

function normalizeInstructorName(name) {
  return String(name ?? "")
    .replace(/\s+\([A-Z]+\)$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function splitInstructorLabel(label) {
  return String(label ?? "")
    .split(/\s*,\s*/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildPreferredInstructorMap(compareSources = []) {
  const preferences = new Map();

  for (const source of compareSources) {
    const parsedCode = parseCourseCode(source);
    if (!parsedCode) {
      continue;
    }

    const normalizedNames = splitInstructorLabel(source.instructorLabel)
      .map(normalizeInstructorName)
      .filter(Boolean);

    if (!normalizedNames.length) {
      continue;
    }

    if (!preferences.has(parsedCode.code)) {
      preferences.set(parsedCode.code, new Set());
    }

    normalizedNames.forEach((name) => preferences.get(parsedCode.code).add(name));
  }

  return preferences;
}

function pickTargetTerm(index, campus, requestedTermCode = null) {
  const candidates = index.filter(
    (entry) => String(entry.campus ?? "").trim().toLowerCase() === campus
  );

  if (!candidates.length) {
    throw createError(`No catalog terms are available for campus ${campus}.`, 404);
  }

  if (requestedTermCode) {
    const exact = candidates.find((entry) => String(entry.termCode) === String(requestedTermCode));
    if (!exact) {
      throw createError(`Term ${requestedTermCode} is not available for ${campus}.`, 404);
    }

    return {
      termCode: String(exact.termCode),
      termDescription: exact.termDescription
    };
  }

  const latest = candidates.reduce((best, entry) => {
    if (!best) {
      return entry;
    }
    return Number(entry.termCode) > Number(best.termCode) ? entry : best;
  }, null);

  return {
    termCode: String(latest.termCode),
    termDescription: latest.termDescription
  };
}

function courseIsOfferedInTerm(index, courseCode, termCode, campus) {
  const parsed = parseCourseCode({ code: courseCode });
  if (!parsed) {
    return false;
  }

  return index.some(
    (entry) =>
      entry.subject === parsed.subject &&
      String(entry.courseNumber) === parsed.courseNumber &&
      String(entry.termCode) === String(termCode) &&
      String(entry.campus ?? "").trim().toLowerCase() === campus
  );
}

function listCourseTerms(index, course, campus, excludeTermCode = null) {
  const seen = new Set();

  return index
    .filter(
      (entry) =>
        entry.subject === course.subject &&
        String(entry.courseNumber) === String(course.courseNumber) &&
        String(entry.campus ?? "").trim().toLowerCase() === campus &&
        String(entry.termCode) !== String(excludeTermCode ?? "")
    )
    .sort((left, right) => Number(right.termCode) - Number(left.termCode))
    .filter((entry) => {
      if (seen.has(String(entry.termCode))) {
        return false;
      }

      seen.add(String(entry.termCode));
      return true;
    });
}

function parseTimeToMinutes(label) {
  const match = String(label ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/iu);

  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "AM") {
    if (hours === 12) {
      hours = 0;
    }
  } else if (hours !== 12) {
    hours += 12;
  }

  return hours * 60 + minutes;
}

function minuteLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "TBA";
  }

  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function buildMeetingBlocks(section) {
  const blocks = [];

  for (const meeting of section.meetings ?? []) {
    const startMinutes = parseTimeToMinutes(meeting.beginTime);
    const endMinutes = parseTimeToMinutes(meeting.endTime);

    if (!meeting.days?.length || startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      continue;
    }

    for (const day of meeting.days) {
      blocks.push({
        day,
        startMinutes,
        endMinutes,
        meetingType: meeting.meetingType,
        building: meeting.building ?? "",
        room: meeting.room ?? "",
        beginTime: meeting.beginTime ?? null,
        endTime: meeting.endTime ?? null
      });
    }
  }

  return blocks.sort((left, right) => {
    const dayDelta = DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day);
    return dayDelta || left.startMinutes - right.startMinutes;
  });
}

function sectionsConflict(leftSection, rightSection) {
  for (const leftBlock of leftSection.meetingBlocks) {
    for (const rightBlock of rightSection.meetingBlocks) {
      if (leftBlock.day !== rightBlock.day) {
        continue;
      }

      if (leftBlock.startMinutes < rightBlock.endMinutes && rightBlock.startMinutes < leftBlock.endMinutes) {
        return true;
      }
    }
  }

  return false;
}

function buildDaySpanSummary(sections) {
  const dayMap = new Map();

  sections.forEach((section) => {
    section.meetingBlocks.forEach((block) => {
      if (!dayMap.has(block.day)) {
        dayMap.set(block.day, []);
      }
      dayMap.get(block.day).push(block);
    });
  });

  let totalGapMinutes = 0;
  let earliestStart = null;
  let latestEnd = null;

  for (const blocks of dayMap.values()) {
    blocks.sort((left, right) => left.startMinutes - right.startMinutes);

    for (let index = 1; index < blocks.length; index += 1) {
      totalGapMinutes += Math.max(0, blocks[index].startMinutes - blocks[index - 1].endMinutes);
    }

    earliestStart = earliestStart == null ? blocks[0].startMinutes : Math.min(earliestStart, blocks[0].startMinutes);
    latestEnd = latestEnd == null
      ? blocks.at(-1).endMinutes
      : Math.max(latestEnd, blocks.at(-1).endMinutes);
  }

  return {
    dayCount: dayMap.size,
    totalGapMinutes,
    earliestStart,
    latestEnd
  };
}

function scoreSection(section, preferredInstructors) {
  const instructorNames = (section.instructors ?? [])
    .map((instructor) => String(instructor.name ?? "").trim())
    .filter(Boolean);
  const normalizedInstructors = instructorNames.map(normalizeInstructorName);
  const preferredMatch = normalizedInstructors.some((name) => preferredInstructors.has(name));
  const meetingBlocks = buildMeetingBlocks(section);

  let score = 0;
  if (preferredMatch) {
    score += 120;
  }
  if (section.openForRegistration) {
    score += 30;
  } else {
    score -= 18;
  }
  if (section.hasSyllabus) {
    score += 4;
  }
  if (meetingBlocks.length === 0) {
    score -= 16;
  }

  meetingBlocks.forEach((block) => {
    if (block.startMinutes < 9 * 60) {
      score -= 5;
    }
    if (block.endMinutes > 18 * 60) {
      score -= 5;
    }
  });

  return {
    ...section,
    preferredInstructorMatch: preferredMatch,
    normalizedInstructorNames: normalizedInstructors,
    instructorNames,
    meetingBlocks,
    scheduleScore: score
  };
}

function summarizeSchedule(sections, requestedCourseCount) {
  const daySpan = buildDaySpanSummary(sections);
  const totalCredits = sections.reduce((sum, section) => sum + Number(section.hoursLow ?? 0), 0);
  const matchedPreferenceCount = sections.filter((section) => section.preferredInstructorMatch).length;
  const totalScore = sections.reduce((sum, section) => sum + Number(section.scheduleScore ?? 0), 0)
    + sections.length * 45
    + matchedPreferenceCount * 18
    - Math.round(daySpan.totalGapMinutes / 20)
    - daySpan.dayCount * 3;

  return {
    totalCredits,
    matchedPreferenceCount,
    requestedCourseCount,
    scheduledCourseCount: sections.length,
    unscheduledCourseCount: Math.max(0, requestedCourseCount - sections.length),
    earliestStart: daySpan.earliestStart,
    latestEnd: daySpan.latestEnd,
    earliestStartLabel: minuteLabel(daySpan.earliestStart),
    latestEndLabel: minuteLabel(daySpan.latestEnd),
    totalGapMinutes: daySpan.totalGapMinutes,
    dayCount: daySpan.dayCount,
    totalScore
  };
}

function serializeSectionForClient(section, course) {
  return {
    courseCode: course.code,
    courseTitle: course.title,
    termCode: String(section.termCode ?? ""),
    crn: String(section.crn ?? ""),
    section: String(section.section ?? ""),
    title: section.title,
    scheduleType: section.scheduleType ?? null,
    instructionalMethod: section.instructionalMethod ?? null,
    site: section.site ?? null,
    session: section.session ?? null,
    hours: Number(section.hoursLow ?? 0),
    openForRegistration: Boolean(section.openForRegistration),
    hasSyllabus: Boolean(section.hasSyllabus),
    syllabusMode: section.syllabusMode ?? null,
    syllabusUrl: section.syllabusUrl ?? null,
    isHonors: Boolean(section.isHonors),
    preferredInstructorMatch: Boolean(section.preferredInstructorMatch),
    instructors: section.instructorNames,
    meetings: (section.meetings ?? []).map((meeting) => ({
      meetingType: meeting.meetingType,
      days: meeting.days ?? [],
      beginTime: meeting.beginTime ?? null,
      endTime: meeting.endTime ?? null,
      building: meeting.building ?? "",
      room: meeting.room ?? "",
      startDate: meeting.startDate ?? null,
      endDate: meeting.endDate ?? null
    })),
    meetingBlocks: section.meetingBlocks.map((block) => ({
      day: block.day,
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes,
      beginTime: block.beginTime,
      endTime: block.endTime,
      building: block.building,
      room: block.room,
      meetingType: block.meetingType
    }))
  };
}

function summarizeMeetingForPrompt(meeting) {
  const days = Array.isArray(meeting?.days) && meeting.days.length ? meeting.days.join("") : "TBA";
  const time =
    meeting?.beginTime && meeting?.endTime
      ? `${meeting.beginTime}-${meeting.endTime}`
      : "TBA";
  const location = [meeting?.building, meeting?.room].filter(Boolean).join(" ");
  return location ? `${days} ${time} @ ${location}` : `${days} ${time}`;
}

function serializeSectionForPlanner(section, course) {
  return {
    courseCode: course.code,
    crn: String(section.crn ?? ""),
    section: String(section.section ?? ""),
    instructors: section.instructorNames,
    openForRegistration: Boolean(section.openForRegistration),
    hasSyllabus: Boolean(section.hasSyllabus),
    syllabusUrl: section.syllabusUrl ?? null,
    syllabusMode: section.syllabusMode ?? null,
    isHonors: Boolean(section.isHonors),
    preferredInstructorMatch: Boolean(section.preferredInstructorMatch),
    instructionalMethod: section.instructionalMethod ?? null,
    scheduleType: section.scheduleType ?? null,
    meetingSummary: (section.meetings ?? []).map(summarizeMeetingForPrompt).filter(Boolean)
  };
}

function buildSyllabusSourcesForCourse(
  course,
  targetTerm,
  sections,
  sourceKind = "upcoming-offering"
) {
  const grouped = new Map();

  sections.forEach((section) => {
    if (!section.hasSyllabus || !section.syllabusUrl) {
      return;
    }

    const instructorLabel = section.instructorNames.join(", ") || "Staff";
    const honorsLabel = section.isHonors ? "Honors" : "Standard";
    const key = [
      section.syllabusUrl,
      instructorLabel,
      honorsLabel
    ].join("::");

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `${targetTerm.termCode}:${course.code}:${instructorLabel}:${honorsLabel}`.toLowerCase(),
        label: `${course.code} • ${targetTerm.termDescription} • ${instructorLabel} • ${honorsLabel}`,
        url: section.syllabusUrl,
        subject: course.subject,
        courseNumber: course.courseNumber,
        termCode: targetTerm.termCode,
        termDescription: targetTerm.termDescription,
        instructorLabel,
        honorsLabel,
        sections: new Set(),
        crns: new Set(),
        preferredInstructorMatch: Boolean(section.preferredInstructorMatch)
      });
    }

    const entry = grouped.get(key);
    entry.sections.add(String(section.section ?? ""));
    entry.crns.add(String(section.crn ?? ""));
    if (section.preferredInstructorMatch) {
      entry.preferredInstructorMatch = true;
    }
  });

  return [...grouped.values()]
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      url: entry.url,
      subject: entry.subject,
      courseNumber: entry.courseNumber,
      termCode: entry.termCode,
      termDescription: entry.termDescription,
      instructorLabel: entry.instructorLabel,
      honorsLabel: entry.honorsLabel,
      sectionsLabel: `Sections ${[...entry.sections].filter(Boolean).join(", ")}`,
      crns: [...entry.crns],
      preferredInstructorMatch: Boolean(entry.preferredInstructorMatch),
      sourceKind
    }))
    .sort((left, right) => {
      if (left.preferredInstructorMatch !== right.preferredInstructorMatch) {
        return left.preferredInstructorMatch ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });
}

async function buildHistoricalSyllabusSourcesForCourse(course, index, campus, targetTerm, preferredInstructors) {
  const priorTerms = listCourseTerms(index, course, campus, targetTerm.termCode)
    .slice(0, MAX_HISTORICAL_SYLLABUS_TERMS);
  const syllabusSources = [];

  for (const term of priorTerms) {
    try {
      const sections = await getCourseSections(course.subject, course.courseNumber, term.termCode);
      const scoredSections = sections
        .map((section) => scoreSection(section, preferredInstructors))
        .sort((left, right) => {
          if (left.preferredInstructorMatch !== right.preferredInstructorMatch) {
            return left.preferredInstructorMatch ? -1 : 1;
          }

          return right.scheduleScore - left.scheduleScore;
        });

      const groupedSources = buildSyllabusSourcesForCourse(
        course,
        {
          termCode: String(term.termCode),
          termDescription: term.termDescription
        },
        scoredSections,
        "historical-offering"
      );

      if (groupedSources.length) {
        syllabusSources.push(...groupedSources);
      }

      if (syllabusSources.length >= MAX_HISTORICAL_SYLLABUS_SOURCES) {
        break;
      }
    } catch (error) {
      console.warn(
        `[planner-syllabi] historical syllabus lookup failed for ${course.code} ${term.termCode}: ${error.message}`
      );
    }
  }

  return syllabusSources.slice(0, MAX_HISTORICAL_SYLLABUS_SOURCES);
}

function dedupeSchedules(candidates) {
  const unique = new Map();

  candidates.forEach((candidate) => {
    const key = [
      candidate.sections.map((section) => section.crn).sort().join("|"),
      candidate.unscheduledCourses.map((course) => course.code).sort().join("|")
    ].join("::");

    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  });

  return [...unique.values()];
}

function buildScheduleOptions(courseCandidates) {
  const orderedCourses = [...courseCandidates].sort(
    (left, right) => left.candidates.length - right.candidates.length
  );
  const scheduleCandidates = [];
  let searchStates = 0;

  function walk(index, selectedSections, unscheduledCourses) {
    if (searchStates >= MAX_SEARCH_STATES) {
      return;
    }

    searchStates += 1;

    if (index >= orderedCourses.length) {
      const summary = summarizeSchedule(selectedSections, orderedCourses.length);
      scheduleCandidates.push({
        sections: [...selectedSections],
        unscheduledCourses: [...unscheduledCourses],
        summary
      });
      return;
    }

    const course = orderedCourses[index];
    let placedAny = false;

    course.candidates.forEach((section) => {
      if (selectedSections.some((existing) => sectionsConflict(existing, section))) {
        return;
      }

      placedAny = true;
      selectedSections.push(section);
      walk(index + 1, selectedSections, unscheduledCourses);
      selectedSections.pop();
    });

    if (!placedAny || scheduleCandidates.length < MAX_RETURNED_SCHEDULES) {
      walk(index + 1, selectedSections, [
        ...unscheduledCourses,
        {
          code: course.code,
          title: course.title,
          reason: placedAny
            ? "No conflict-free section fit this schedule."
            : "No sections were available after filtering."
        }
      ]);
    }
  }

  walk(0, [], []);

  return dedupeSchedules(scheduleCandidates)
    .sort((left, right) => {
      if (left.summary.scheduledCourseCount !== right.summary.scheduledCourseCount) {
        return right.summary.scheduledCourseCount - left.summary.scheduledCourseCount;
      }
      return right.summary.totalScore - left.summary.totalScore;
    })
    .slice(0, MAX_RETURNED_SCHEDULES);
}

export async function buildScheduleRecommendation({
  planCourses,
  compareSources,
  campus = DEFAULT_CAMPUS,
  requestedTermCode = null
}) {
  const parsedCourses = [...new Map(
    (planCourses ?? [])
      .map((course) => {
        const parsed = parseCourseCode(course);
        if (!parsed) {
          return null;
        }

        return [
          parsed.code,
          {
            ...parsed,
            title: String(course?.title ?? parsed.code).trim() || parsed.code
          }
        ];
      })
      .filter(Boolean)
  ).values()];

  if (!parsedCourses.length) {
    throw createError("Add courses to the semester plan before building a schedule.", 400);
  }

  const index = await requireCatalogIndex();
  const targetTerm = pickTargetTerm(index, campus, requestedTermCode);
  const preferredInstructorMap = buildPreferredInstructorMap(compareSources);
  const courseCandidates = [];
  const unavailableCourses = [];

  for (const course of parsedCourses) {
    let sections = [];

    try {
      sections = await getCourseSections(course.subject, course.courseNumber, targetTerm.termCode);
    } catch (error) {
      unavailableCourses.push({
        code: course.code,
        title: course.title,
        reason: `Live section fetch failed for ${course.code} in ${targetTerm.termDescription}: ${error.message}`
      });
      continue;
    }

    const preferredInstructors = preferredInstructorMap.get(course.code) ?? new Set();
    const candidates = sections
      .map((section) => scoreSection(section, preferredInstructors))
      .sort((left, right) => {
        if (left.preferredInstructorMatch !== right.preferredInstructorMatch) {
          return left.preferredInstructorMatch ? -1 : 1;
        }
        if (left.openForRegistration !== right.openForRegistration) {
          return left.openForRegistration ? -1 : 1;
        }
        return right.scheduleScore - left.scheduleScore;
      })
      .slice(0, MAX_CANDIDATES_PER_COURSE);

    if (!candidates.length) {
      unavailableCourses.push({
        code: course.code,
        title: course.title,
        reason: courseIsOfferedInTerm(index, course.code, targetTerm.termCode, campus)
          ? `No section rows came back for ${course.code} in ${targetTerm.termDescription}.`
          : `${course.code} is not offered in ${targetTerm.termDescription}.`
      });
      continue;
    }

    courseCandidates.push({
      ...course,
      preferredInstructors: [...preferredInstructors],
      candidates
    });
  }

  const schedules = (courseCandidates.length ? buildScheduleOptions(courseCandidates) : []).map((candidate, index) => ({
    id: `schedule-${index + 1}`,
    label: `Option ${index + 1}`,
    summary: candidate.summary,
    unscheduledCourses: [
      ...candidate.unscheduledCourses,
      ...unavailableCourses
    ],
    sections: candidate.sections.map((section) => {
      const course = courseCandidates.find((entry) => entry.code === `${section.subject} ${section.courseNumber}`);
      return serializeSectionForClient(section, course ?? {
        code: `${section.subject} ${section.courseNumber}`,
        title: section.title
      });
    })
  }));

  return {
    campus,
    targetTerm,
    requestedCourseCount: parsedCourses.length,
    scheduledCourseCount: schedules[0]?.summary?.scheduledCourseCount ?? 0,
    preferredInstructorCourses: courseCandidates
      .filter((course) => course.preferredInstructors.length)
      .map((course) => ({
        code: course.code,
        instructors: course.preferredInstructors
      })),
    unavailableCourses,
    schedules,
    selectedScheduleId: schedules[0]?.id ?? null
  };
}

export async function buildUpcomingOfferingContext({
  planCourses,
  compareSources,
  campus = DEFAULT_CAMPUS,
  requestedTermCode = null
}) {
  const parsedCourses = [...new Map(
    (planCourses ?? [])
      .map((course) => {
        const parsed = parseCourseCode(course);
        if (!parsed) {
          return null;
        }

        return [
          parsed.code,
          {
            ...parsed,
            title: String(course?.title ?? parsed.code).trim() || parsed.code
          }
        ];
      })
      .filter(Boolean)
  ).values()];

  if (!parsedCourses.length) {
    return null;
  }

  const index = await requireCatalogIndex();
  const targetTerm = pickTargetTerm(index, campus, requestedTermCode);
  const preferredInstructorMap = buildPreferredInstructorMap(compareSources);
  const offerings = [];
  const unavailableCourses = [];

  for (const course of parsedCourses) {
    let sections = [];

    try {
      sections = await getCourseSections(course.subject, course.courseNumber, targetTerm.termCode);
    } catch (error) {
      unavailableCourses.push({
        code: course.code,
        title: course.title,
        reason: `Live section fetch failed for ${course.code} in ${targetTerm.termDescription}: ${error.message}`
      });
      continue;
    }

    const preferredInstructors = preferredInstructorMap.get(course.code) ?? new Set();
    const scoredSections = sections
      .map((section) => scoreSection(section, preferredInstructors))
      .sort((left, right) => {
        if (left.preferredInstructorMatch !== right.preferredInstructorMatch) {
          return left.preferredInstructorMatch ? -1 : 1;
        }
        if (left.openForRegistration !== right.openForRegistration) {
          return left.openForRegistration ? -1 : 1;
        }
        return right.scheduleScore - left.scheduleScore;
      });

    if (!scoredSections.length) {
      unavailableCourses.push({
        code: course.code,
        title: course.title,
        reason: courseIsOfferedInTerm(index, course.code, targetTerm.termCode, campus)
          ? `No section rows came back for ${course.code} in ${targetTerm.termDescription}.`
          : `${course.code} is not offered in ${targetTerm.termDescription}.`
      });
      continue;
    }

    const currentTermSyllabusSources = buildSyllabusSourcesForCourse(course, targetTerm, scoredSections);

    offerings.push({
      code: course.code,
      title: course.title,
      preferredInstructors: [...preferredInstructors],
      sectionCount: scoredSections.length,
      syllabusSectionCount: scoredSections.filter((section) => section.hasSyllabus).length,
      sections: scoredSections.map((section) => serializeSectionForPlanner(section, course)),
      syllabusSources:
        currentTermSyllabusSources.length > 0
          ? currentTermSyllabusSources
          : await buildHistoricalSyllabusSourcesForCourse(
              course,
              index,
              campus,
              targetTerm,
              preferredInstructors
            )
    });
  }

  return {
    campus,
    targetTerm,
    offerings,
    unavailableCourses
  };
}
