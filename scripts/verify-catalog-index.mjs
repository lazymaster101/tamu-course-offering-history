import { readFile } from "node:fs/promises";
import { join } from "node:path";

const indexFile = join(process.cwd(), "data", "catalog-index.json");

async function main() {
  const raw = await readFile(indexFile, "utf8");
  const payload = JSON.parse(raw);

  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw new Error("data/catalog-index.json exists but does not contain catalog entries.");
  }

  console.log(
    `Verified catalog index: ${payload.entries.length} entries (${payload.generatedAt ?? "unknown timestamp"})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
