import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const requiredFiles = [
  "generated/features.json",
  "generated/metadata.json",
  "dist/index.html",
];

function pickVersionedFile(files, pattern, description) {
  const match = files.find((file) => pattern.test(file));
  if (!match) {
    throw new Error(`Missing ${description} file.`);
  }
  return match;
}

async function main() {
  for (const file of requiredFiles) {
    await access(path.join(rootDir, file));
  }

  const [assetFiles, dataFiles, indexHtml] = await Promise.all([
    readdir(path.join(rootDir, "dist", "assets")),
    readdir(path.join(rootDir, "dist", "data")),
    readFile(path.join(rootDir, "dist", "index.html"), "utf8"),
  ]);

  const appFile = pickVersionedFile(assetFiles, /^app\.[a-f0-9]{12}\.js$/, "versioned app");
  const stylesFile = pickVersionedFile(assetFiles, /^styles\.[a-f0-9]{12}\.css$/, "versioned stylesheet");
  const featuresFile = pickVersionedFile(dataFiles, /^features\.[a-f0-9]{12}\.json$/, "versioned features data");
  const metadataFile = pickVersionedFile(dataFiles, /^metadata\.[a-f0-9]{12}\.json$/, "versioned metadata");

  const expectedReferences = [
    `./assets/${appFile}`,
    `./assets/${stylesFile}`,
    `./data/${featuresFile}`,
    `./data/${metadataFile}`,
  ];

  for (const reference of expectedReferences) {
    if (!indexHtml.includes(reference)) {
      throw new Error(`index.html is missing reference to ${reference}`);
    }
  }

  const featuresRaw = await readFile(path.join(rootDir, "generated/features.json"), "utf8");
  const features = JSON.parse(featuresRaw);

  if (!Array.isArray(features) || features.length === 0) {
    throw new Error("Expected generated/features.json to contain at least one feature.");
  }

  const first = features[0];
  const requiredFields = ["id", "title", "dateSupported", "milestone", "groupPrefix", "paths", "browsers"];
  for (const field of requiredFields) {
    if (!(field in first)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  console.log("Output validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
