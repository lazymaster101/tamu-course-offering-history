import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const HOWDY_BASE_URL = process.env.HOWDY_BASE_URL ?? "https://howdy.tamu.edu";
const CONCURRENCY = 2;
const REQUEST_RETRIES = 3;
const RETRY_DELAY_MS = 350;
const OUTPUT_FILE = join(process.cwd(), "data", "catalog-index.json");

function wait(delayMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

function inferCampus(termDescription) {
  const description = termDescription.toLowerCase();

  if (description.includes("college station")) {
    return "college-station";
  }
  if (description.includes("galveston")) {
    return "galveston";
  }
  if (description.includes("qatar")) {
    return "qatar";
  }
  if (description.includes("professional")) {
    return "professional";
  }
  if (description.includes("half year")) {
    return "half-year";
  }
  return "other";
}

async function fetchHowdyJson(path, options = {}) {
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${HOWDY_BASE_URL}${path}`, {
        ...options,
        headers: {
          "user-agent": "tamu-course-offering-history-build/1.0",
          accept: "application/json",
          ...(options.headers ?? {})
        }
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(
          `${response.status} ${response.statusText}: ${body.slice(0, 300)}`
        );
        error.statusCode = response.status;
        throw error;
      }

      return response.json();
    } catch (error) {
      const statusCode = error.statusCode ?? 0;
      const shouldRetry =
        attempt < REQUEST_RETRIES && (statusCode === 0 || statusCode === 429 || statusCode >= 500);

      if (!shouldRetry) {
        throw error;
      }

      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

async function fetchTerms() {
  const allTerms = await fetchHowdyJson("/api/all-terms");

  return allTerms
    .map((term) => ({
      code: String(term.STVTERM_CODE),
      description: term.STVTERM_DESC,
      campus: inferCampus(term.STVTERM_DESC)
    }))
    .sort((left, right) => Number(right.code) - Number(left.code));
}

async function fetchCatalogForTerm(termCode) {
  return fetchHowdyJson("/api/get-catalog-courses", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ termCode })
  });
}

async function buildCatalogIndex() {
  const terms = await fetchTerms();
  const entries = [];

  console.log(`Building catalog index from ${terms.length} TAMU terms...`);

  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index];

    try {
      const rows = await fetchCatalogForTerm(term.code);
      let offeredCount = 0;

      for (const row of rows) {
        const sectionsCount = Number(row.SECTIONS_COUNT ?? 0);
        if (sectionsCount < 1) {
          continue;
        }

        entries.push({
          termCode: term.code,
          termDescription: term.description,
          campus: term.campus,
          subject: row.SCBCRKY_SUBJ_CODE,
          courseNumber: row.SCBCRKY_CRSE_NUMB,
          title: row.COURSE_TITLE || row.SCBCRSE_TITLE,
          sectionsCount,
          college: row.COLL_DESC
        });
        offeredCount += 1;
      }

      console.log(
        `[${index + 1}/${terms.length}] ${term.code} ${term.description}: ${offeredCount} offered rows`
      );
    } catch (error) {
      console.warn(
        `[${index + 1}/${terms.length}] Skipping ${term.code} ${term.description}: ${error.message}`
      );
    }
  }

  return entries;
}

async function main() {
  const index = await buildCatalogIndex();
  const payload = {
    generatedAt: new Date().toISOString(),
    entryCount: index.length,
    entries: index
  };

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(payload), "utf8");

  console.log(`Wrote ${payload.entryCount} catalog entries to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
