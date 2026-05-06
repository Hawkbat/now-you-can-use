import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const generatedDir = path.join(rootDir, "generated");
const distDir = path.join(rootDir, "dist");
const srcDir = path.join(rootDir, "src");

function contentHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function versionedFilename(name, content) {
  const extension = path.extname(name);
  const basename = path.basename(name, extension);
  return `${basename}.${contentHash(content)}${extension}`;
}

async function main() {
  const [featuresRaw, metadataRaw, templateHtml, appJs, stylesCss] = await Promise.all([
    readFile(path.join(generatedDir, "features.json"), "utf8"),
    readFile(path.join(generatedDir, "metadata.json"), "utf8"),
    readFile(path.join(srcDir, "index.template.html"), "utf8"),
    readFile(path.join(srcDir, "app.js"), "utf8"),
    readFile(path.join(srcDir, "styles.css"), "utf8"),
  ]);

  const features = JSON.parse(featuresRaw);
  const metadata = JSON.parse(metadataRaw);

  const featuresContent = JSON.stringify(features, null, 2) + "\n";
  const metadataContent = JSON.stringify(metadata, null, 2) + "\n";

  const appFilename = versionedFilename("app.js", appJs);
  const stylesFilename = versionedFilename("styles.css", stylesCss);
  const featuresFilename = versionedFilename("features.json", featuresContent);
  const metadataFilename = versionedFilename("metadata.json", metadataContent);

  const appUrl = `./assets/${appFilename}`;
  const stylesUrl = `./assets/${stylesFilename}`;
  const featuresUrl = `./data/${featuresFilename}`;
  const metadataUrl = `./data/${metadataFilename}`;

  await rm(distDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(path.join(distDir, "assets"), { recursive: true }),
    mkdir(path.join(distDir, "data"), { recursive: true }),
  ]);

  const renderedHtml = templateHtml
    .replaceAll("__GENERATED_AT__", metadata.generatedAt)
    .replaceAll("__TOTAL_FEATURES__", String(features.length))
    .replaceAll("__APP_URL__", appUrl)
    .replaceAll("__STYLES_URL__", stylesUrl)
    .replaceAll("__FEATURES_URL__", featuresUrl)
    .replaceAll("__METADATA_URL__", metadataUrl);

  await Promise.all([
    writeFile(path.join(distDir, "index.html"), renderedHtml, "utf8"),
    writeFile(path.join(distDir, "assets", appFilename), appJs, "utf8"),
    writeFile(path.join(distDir, "assets", stylesFilename), stylesCss, "utf8"),
    writeFile(path.join(distDir, "data", featuresFilename), featuresContent, "utf8"),
    writeFile(path.join(distDir, "data", metadataFilename), metadataContent, "utf8"),
    cp(path.join(srcDir, "icons"), path.join(distDir, "assets", "icons"), { recursive: true }),
  ]);

  // Keep generated output available for debugging and future RSS generation.
  await cp(generatedDir, path.join(distDir, "generated"), { recursive: true });

  console.log(`Built static site in ${path.relative(rootDir, distDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
