import { normalizeCourseCode } from "./planner-transcript-parser.js";

function flattenTrackedElectives(plan) {
  const items = [];

  for (const [track, courses] of Object.entries(plan.trackedElectives ?? {})) {
    for (const course of courses) {
      items.push({
        ...course,
        track
      });
    }
  }

  return items;
}

function isCountedTrackedCourse(course) {
  return course.code !== "CSCE 411" && course.track !== "Untracked";
}

function buildEquivalentCodeMap(plan) {
  const map = new Map();

  for (const node of plan.graphNodes ?? []) {
    map.set(node.code, node.code);
    for (const match of node.matches ?? []) {
      map.set(match, node.code);
    }
  }

  for (const course of flattenTrackedElectives(plan)) {
    map.set(course.code, course.code);
    for (const match of course.matches ?? []) {
      map.set(match, course.code);
    }
  }

  for (const pair of plan.fastTrack?.coursePairs ?? []) {
    map.set(pair.graduateCode, pair.undergraduateCode);
  }

  return map;
}

function expandCourseMap(courses, equivalenceMap) {
  const expanded = new Map();

  for (const course of courses) {
    expanded.set(course.code, course);
    const canonicalCode = equivalenceMap.get(course.code);

    if (canonicalCode && canonicalCode !== course.code && !expanded.has(canonicalCode)) {
      expanded.set(canonicalCode, {
        ...course,
        code: canonicalCode,
        canonicalSourceCode: course.code
      });
    }
  }

  return expanded;
}

function buildMatchedCodeSet(plan, transcriptCourseIndex) {
  const matchedCodes = new Set();

  for (const node of plan.graphNodes ?? []) {
    const matchedCode = node.matches?.find((code) =>
      transcriptCourseIndex.completedCodes.has(code)
    );
    if (matchedCode) {
      matchedCodes.add(matchedCode);
    }
  }

  return matchedCodes;
}

function indexCoursesByCode(plan) {
  const index = new Map();

  for (const node of plan.graphNodes ?? []) {
    if (node.code) {
      index.set(node.code, node);
    }

    for (const match of node.matches ?? []) {
      index.set(match, node);
    }
  }

  for (const course of flattenTrackedElectives(plan)) {
    if (!index.has(course.code)) {
      index.set(course.code, course);
    }
  }

  return index;
}

function buildPlannedSet(plannedCourseCodes) {
  return new Set(
    plannedCourseCodes
      .map((code) => normalizeCourseCode(...String(code).split(/\s+/, 2)))
      .filter(Boolean)
  );
}

function buildTranscriptCourseIndex(plan, transcript) {
  const equivalenceMap = buildEquivalentCodeMap(plan);
  const completedMap = expandCourseMap(transcript.completedCourses, equivalenceMap);
  const inProgressMap = expandCourseMap(transcript.inProgressCourses, equivalenceMap);

  return {
    equivalenceMap,
    completedMap,
    inProgressMap,
    completedCodes: new Set(completedMap.keys()),
    inProgressCodes: new Set(inProgressMap.keys())
  };
}

function getCourseCodesFromPlanNode(node) {
  return node.matches?.length ? node.matches : [node.code].filter(Boolean);
}

function evaluateGraphNodes(plan, transcriptCourseIndex, plannedSet) {
  const completedSet = transcriptCourseIndex.completedCodes;
  const inProgressSet = transcriptCourseIndex.inProgressCodes;
  const activeSet = new Set([...completedSet, ...inProgressSet, ...plannedSet]);

  return (plan.graphNodes ?? []).map((node) => {
    const candidateCodes = getCourseCodesFromPlanNode(node);
    const completedCode = candidateCodes.find((code) => completedSet.has(code)) ?? null;
    const inProgressCode = candidateCodes.find((code) => inProgressSet.has(code)) ?? null;
    const plannedCode = candidateCodes.find((code) => plannedSet.has(code)) ?? null;
    const missingPrereqs = (node.prereqs ?? []).filter((code) => !activeSet.has(code));

    let state = "locked";
    if (completedCode) {
      state = "completed";
    } else if (inProgressCode) {
      state = "in-progress";
    } else if (plannedCode) {
      state = "planned";
    } else if (missingPrereqs.length === 0) {
      state = "eligible";
    }

    return {
      ...node,
      state,
      completedCode,
      inProgressCode,
      plannedCode,
      missingPrereqs
    };
  });
}

function sumCredits(courseCodes, courseMap) {
  let total = 0;

  for (const code of courseCodes) {
    const course = courseMap.get(code);
    if (!course) {
      continue;
    }

    total += Number(course.credits ?? 0);
  }

  return total;
}

function evaluateFlexibleProgress(plan, transcript, graphNodeStates, transcriptCourseIndex, plannedSet) {
  const completedCourseMap = transcriptCourseIndex.completedMap;
  const activeCourseMap = new Map([
    ...completedCourseMap,
    ...transcriptCourseIndex.inProgressMap
  ]);
  const matchedRequiredCodes = buildMatchedCodeSet(plan, transcriptCourseIndex);

  const trackedCatalog = flattenTrackedElectives(plan);
  const trackedCoursesCompleted = trackedCatalog.filter(
    (course) => isCountedTrackedCourse(course) && completedCourseMap.has(course.code)
  );
  const trackedCoursesActive = trackedCatalog.filter(
    (course) =>
      isCountedTrackedCourse(course) &&
      (completedCourseMap.has(course.code) ||
        transcriptCourseIndex.inProgressCodes.has(course.code) ||
        plannedSet.has(course.code))
  );
  const trackedHours = trackedCoursesCompleted
    .reduce(
      (sum, course) => sum + Number(course.hours ?? completedCourseMap.get(course.code)?.credits ?? 0),
      0
    );
  const activeTrackedHours = trackedCoursesActive
    .reduce(
      (sum, course) => sum + Number(course.hours ?? activeCourseMap.get(course.code)?.credits ?? 0),
      0
    );
  const trackCoverage = [...new Set(trackedCoursesCompleted.map((course) => course.track))];
  const activeTrackCoverage = [...new Set(trackedCoursesActive.map((course) => course.track))];

  const verifiedUccCodes = plan.verifiedUccMatchers.filter(
    (code) => completedCourseMap.has(code) && !matchedRequiredCodes.has(code)
  );
  const scienceElectiveCodes = plan.scienceElectiveMatchers.filter(
    (code) => completedCourseMap.has(code) && !matchedRequiredCodes.has(code)
  );

  const alreadyCounted = new Set([
    ...matchedRequiredCodes,
    ...verifiedUccCodes,
    ...scienceElectiveCodes,
    ...trackedCoursesCompleted.map((course) => course.code)
  ]);

  const remainingCompletedCourses = transcript.completedCourses.filter(
    (course) => !alreadyCounted.has(course.code) && Number(course.credits ?? 0) > 0
  );
  const generalElectiveHours = remainingCompletedCourses.reduce(
    (sum, course) => sum + Number(course.credits ?? 0),
    0
  );

  return {
    requiredCore: {
      completedCount: graphNodeStates.filter((node) => node.state === "completed").length,
      inProgressCount: graphNodeStates.filter((node) => node.state === "in-progress").length,
      plannedCount: graphNodeStates.filter((node) => node.state === "planned").length,
      totalCount: graphNodeStates.length
    },
    verifiedUccHours: sumCredits(verifiedUccCodes, completedCourseMap),
    scienceElectiveHours: sumCredits(scienceElectiveCodes, completedCourseMap),
    generalElectiveHours,
    trackedElectiveHours: trackedHours,
    activeTrackedElectiveHours: activeTrackedHours,
    trackedElectiveCourseCount: trackedCoursesCompleted.length,
    activeTrackedElectiveCourseCount: trackedCoursesActive.length,
    trackCoverage,
    activeTrackCoverage,
    emphasisAreaHours: 0,
    note:
      "UCC and emphasis-area progress are partially verified. Advisor-reviewed requirements stay advisory in this first version."
  };
}

function describeMissingPrereqs(course, completedSet, activeSet) {
  const knownMissing = (course.prereqs ?? []).filter((code) => !activeSet.has(code));
  return {
    knownMissing,
    advisorReviewRequired: (course.prereqs ?? []).length === 0
  };
}

function evaluateTrackedElectiveSuggestions(plan, transcriptCourseIndex, plannedSet, planData) {
  const completedSet = transcriptCourseIndex.completedCodes;
  const inProgressSet = transcriptCourseIndex.inProgressCodes;
  const activeSet = new Set([
    ...completedSet,
    ...inProgressSet,
    ...plannedSet
  ]);
  const trackNames = Object.keys(planData.trackedElectives ?? {}).filter((track) => track !== "Untracked");
  const activeTrackedCourses = flattenTrackedElectives(planData).filter(
    (course) => isCountedTrackedCourse(course) && activeSet.has(course.code)
  );
  const activeTrackCoverage = new Set(activeTrackedCourses.map((course) => course.track));
  const outstandingTrackedHours = Math.max(
    0,
    (planData.trackedElectiveHoursTarget ?? 18) -
      activeTrackedCourses.reduce((sum, course) => sum + Number(course.hours ?? 0), 0)
  );
  const outstandingTrackedCourseCount = Math.max(
    0,
    (planData.trackedElectiveCourseTarget ?? 6) - activeTrackedCourses.length
  );
  const missingTracks = trackNames.filter((track) => !activeTrackCoverage.has(track));
  return flattenTrackedElectives(plan)
    .filter(
      (course) =>
        isCountedTrackedCourse(course) &&
        !completedSet.has(course.code) &&
        !inProgressSet.has(course.code)
    )
    .map((course) => {
      const { knownMissing, advisorReviewRequired } = describeMissingPrereqs(
        course,
        completedSet,
        activeSet
      );

      return {
        ...course,
        inCart: plannedSet.has(course.code),
        missingTrackCoverage: missingTracks.includes(course.track),
        state:
          knownMissing.length === 0
            ? advisorReviewRequired
              ? "review"
              : "eligible"
            : "locked",
        missingPrereqs: knownMissing,
        advisorReviewRequired
      };
    })
    .sort((left, right) => {
      const stateRank = { eligible: 0, review: 1, locked: 2 };
      const trackPriorityLeft = missingTracks.includes(left.track) ? 0 : 1;
      const trackPriorityRight = missingTracks.includes(right.track) ? 0 : 1;
      return (
        trackPriorityLeft - trackPriorityRight ||
        stateRank[left.state] - stateRank[right.state] ||
        Number(right.inCart) - Number(left.inCart) ||
        left.code.localeCompare(right.code)
      );
    });
}

function evaluateFastTrack(plan, transcriptCourseIndex, plannedSet, transcript) {
  const overallGpa = Number(transcript.overallGpa ?? 0);
  const completedSet = transcriptCourseIndex.completedCodes;
  const activeSet = new Set([
    ...completedSet,
    ...transcriptCourseIndex.inProgressCodes,
    ...plannedSet
  ]);
  const courseIndex = indexCoursesByCode(plan);

  return (plan.fastTrack?.coursePairs ?? []).map((pair) => {
    const pairedUndergrad = courseIndex.get(pair.undergraduateCode);
    const pairedCourseCompleted = completedSet.has(pair.undergraduateCode);
    const base331Satisfied = activeSet.has("CSCE 331");
    const pairedMissingPrereqs =
      pair.graduateCode === "CSCE 629"
        ? ["CSCE 221"].filter((code) => !activeSet.has(code))
        : (pairedUndergrad?.prereqs ?? []).filter((code) => !activeSet.has(code));
    const advisorReviewRequired =
      !(pairedUndergrad?.prereqs?.length ?? 0) && pair.graduateCode !== "CSCE 629";

    const baselineReady =
      overallGpa >= (plan.fastTrack?.gpaMinimum ?? 3.5) &&
      base331Satisfied &&
      pairedMissingPrereqs.length === 0 &&
      !pairedCourseCompleted;

    return {
      ...pair,
      state: baselineReady ? (advisorReviewRequired ? "candidate" : "eligible") : "not-ready",
      overallGpa,
      gpaMinimum: plan.fastTrack?.gpaMinimum ?? 3.5,
      pairedCourseCompleted,
      missingPrereqs: [
        ...(base331Satisfied ? [] : ["CSCE 331"]),
        ...pairedMissingPrereqs
      ],
      advisorReviewRequired
    };
  });
}

function buildGraphEdges(plan) {
  const codeToNodeId = new Map();

  for (const node of plan.graphNodes ?? []) {
    for (const code of getCourseCodesFromPlanNode(node)) {
      codeToNodeId.set(code, node.id);
    }
  }

  const edges = [];

  for (const node of plan.graphNodes ?? []) {
    for (const prereq of node.prereqs ?? []) {
      const fromNodeId = codeToNodeId.get(prereq);
      if (!fromNodeId) {
        continue;
      }

      edges.push({
        from: fromNodeId,
        to: node.id,
        code: prereq
      });
    }
  }

  return edges;
}

export function evaluatePlannerState(plan, transcript, plannedCourseCodes = []) {
  const plannedSet = new Set(plannedCourseCodes);
  const transcriptCourseIndex = buildTranscriptCourseIndex(plan, transcript);
  const graphNodes = evaluateGraphNodes(plan, transcriptCourseIndex, plannedSet);
  const graphEdges = buildGraphEdges(plan);
  const flexibleProgress = evaluateFlexibleProgress(
    plan,
    transcript,
    graphNodes,
    transcriptCourseIndex,
    plannedSet
  );
  const trackedElectiveSuggestions = evaluateTrackedElectiveSuggestions(
    plan,
    transcriptCourseIndex,
    plannedSet,
    plan
  );
  const fastTrackOptions = evaluateFastTrack(plan, transcriptCourseIndex, plannedSet, transcript);

  const eligibleRequiredCourses = graphNodes.filter((node) => node.state === "eligible");
  const plannedCourses = plannedCourseCodes
    .map((code) => normalizeCourseCode(...String(code).split(/\s+/, 2)))
    .filter(Boolean);

  return {
    planId: plan.id,
    transcriptSummary: {
      studentName: transcript.studentName,
      studentId: transcript.studentId,
      overallGpa: transcript.overallGpa,
      earnedHours: transcript.earnedHours,
      majors: transcript.majors ?? [],
      minors: transcript.minors ?? [],
      currentPrograms: transcript.currentPrograms ?? []
    },
    plannedCourses,
    graphNodes,
    graphEdges,
    flexibleProgress,
    eligibleRequiredCourses,
    trackedElectiveSuggestions,
    fastTrackOptions,
    warnings: [
      "UCC, emphasis-area, and minor validation are advisory in this first version.",
      "Tracked-elective prerequisites are only auto-checked where the underlying source material made them explicit."
    ]
  };
}
