import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcd from "@mdn/browser-compat-data" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "generated");

const TARGET_BROWSERS = [
  { id: "chrome", label: "Chrome" },
  { id: "firefox", label: "Firefox" },
  { id: "edge", label: "Edge" },
  { id: "safari", label: "Safari" },
  { id: "chrome_android", label: "Chrome Android" },
  { id: "firefox_android", label: "Firefox Android" },
  { id: "safari_ios", label: "Safari iOS" },
];

const TARGET_BROWSER_MAP = Object.fromEntries(TARGET_BROWSERS.map((browser) => [browser.id, browser]));

const MILESTONES = [
  {
    id: "desktop",
    label: "Desktop baseline",
    browserIds: ["chrome", "firefox", "edge", "safari"],
  },
  {
    id: "mobile",
    label: "Mobile baseline",
    browserIds: ["chrome_android", "firefox_android", "safari_ios"],
  },
  {
    id: "all",
    label: "All platforms baseline",
    browserIds: ["chrome", "firefox", "edge", "safari", "chrome_android", "firefox_android", "safari_ios"],
  },
];

const SOURCE_GROUPS = ["api", "css", "html", "javascript", "http", "manifests", "svg", "mathml", "mediatypes", "webassembly", "webdriver", "webextensions"];

const NON_MERGEABLE_PREFIXES = new Set([
  "css",
  "css.at-rules",
  "css.properties",
  "css.selectors",
  "css.types",
  "html",
  "html.elements",
  "html.global_attributes",
  "http",
  "http.headers",
  "http.methods",
  "http.status",
  "javascript",
  "javascript.builtins",
  "javascript.classes",
  "javascript.functions",
  "javascript.grammar",
  "javascript.operators",
  "javascript.statements",
  "manifests",
  "manifests.webapp",
  "mathml",
  "mathml.elements",
  "mediatypes",
  "mediatypes.image",
  "svg",
  "svg.attributes",
  "svg.elements",
  "webassembly",
  "webdriver",
  "webdriver.bidi",
  "webdriver.classic",
  "webextensions",
  "webextensions.api",
  "webextensions.manifest",
]);

function normalizeVersion(version) {
  if (typeof version === "number") {
    return String(version);
  }

  if (typeof version !== "string") {
    return null;
  }

  const cleaned = version
    .replace(/[\s≤≥<>=~]/g, "")
    .replace(/_/g, ".")
    .split("-")[0]
    .trim();

  if (!cleaned || /preview|tp|nightly|beta/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

const releaseCache = new Map();

function releaseEntries(browserId) {
  if (releaseCache.has(browserId)) {
    return releaseCache.get(browserId);
  }

  const releases = bcd.browsers[browserId]?.releases ?? {};

  const entries = Object.entries(releases)
    .filter(([, info]) => info.release_date)
    .map(([version, info]) => ({
      version,
      date: new Date(info.release_date),
      releaseDate: info.release_date,
      status: info.status,
    }))
    .sort((a, b) => a.date - b.date);

  releaseCache.set(browserId, entries);
  return entries;
}

function earliestReleaseDate(browserId) {
  const entries = releaseEntries(browserId);
  return entries.length ? entries[0] : null;
}

function findReleaseByVersion(browserId, version) {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    return null;
  }

  const entries = releaseEntries(browserId);
  if (!entries.length) {
    return null;
  }

  const exact = entries.find((entry) => entry.version === normalized);
  if (exact) {
    return exact;
  }

  const prefix = entries.find((entry) => entry.version.startsWith(`${normalized}.`) || normalized.startsWith(`${entry.version}.`));
  if (prefix) {
    return prefix;
  }

  const normalizedValue = Number.parseFloat(normalized);
  if (Number.isNaN(normalizedValue)) {
    return null;
  }

  const nearest = entries
    .filter((entry) => {
      const value = Number.parseFloat(entry.version);
      return !Number.isNaN(value) && value >= normalizedValue;
    })
    .sort((a, b) => Number.parseFloat(a.version) - Number.parseFloat(b.version))[0];

  return nearest ?? null;
}

function normalizeStatements(statement) {
  if (!statement) {
    return [];
  }

  return Array.isArray(statement) ? statement : [statement];
}

function isUsableSupportStatement(statement) {
  if (!statement || statement.version_added === false || statement.version_added === null) {
    return false;
  }

  if (statement.flags || statement.prefix || statement.alternative_name) {
    return false;
  }

  if (statement.partial_implementation) {
    return false;
  }

  if (statement.version_removed) {
    return false;
  }

  return true;
}

function getSupportDateForBrowser(compat, browserId) {
  const raw = compat.support?.[browserId];
  const statements = normalizeStatements(raw).filter(isUsableSupportStatement);

  let best = null;

  for (const statement of statements) {
    let release = null;

    if (statement.version_added === true) {
      release = earliestReleaseDate(browserId);
    } else {
      release = findReleaseByVersion(browserId, statement.version_added);
    }

    if (!release) {
      continue;
    }

    if (!best || release.date < best.date) {
      best = release;
    }
  }

  return best;
}

function toFeatureTitle(pathParts, compat) {
  if (compat.description) {
    return compat.description;
  }

  const cleaned = pathParts[pathParts.length - 1]
    .replace(/_/g, " ")
    .replace(/\bidl\b/gi, "IDL");

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function collectCompatItems(node, pathParts = [], bucket = []) {
  if (!node || typeof node !== "object") {
    return bucket;
  }

  if (node.__compat) {
    bucket.push({ pathParts, compat: node.__compat });
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "__compat") {
      continue;
    }
    collectCompatItems(value, [...pathParts, key], bucket);
  }

  return bucket;
}

function prefixCountMap(items) {
  const counts = new Map();

  for (const item of items) {
    const segments = item.path.split(".");

    for (let size = 2; size <= segments.length; size += 1) {
      const prefix = segments.slice(0, size).join(".");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  return counts;
}

function isMergeablePrefix(prefix) {
  return !NON_MERGEABLE_PREFIXES.has(prefix);
}

function findBestSharedPrefix(pathValue, counts) {
  const segments = pathValue.split(".");

  for (let size = segments.length; size >= 2; size -= 1) {
    const prefix = segments.slice(0, size).join(".");
    if ((counts.get(prefix) ?? 0) > 1 && isMergeablePrefix(prefix)) {
      return prefix;
    }
  }

  return pathValue;
}

function aggregateBrowserSupport(items, browserIds) {
  const aggregated = {};

  for (const browserId of browserIds) {
    const browserLabel = TARGET_BROWSER_MAP[browserId].label;
    const versions = [...new Set(items.map((item) => item.browsers[browserId]?.version).filter(Boolean))];
    const dates = [...new Set(items.map((item) => item.browsers[browserId]?.date).filter(Boolean))];

    aggregated[browserId] = {
      browser: browserLabel,
      version: versions.length === 1 ? versions[0] : "multiple",
      versions,
      date: dates.length === 1 ? dates[0] : null,
      dates,
    };
  }

  return aggregated;
}

function titleFromPath(pathValue) {
  const segments = pathValue.split(".");
  const cleaned = segments[segments.length - 1]
    .replace(/_/g, " ")
    .replace(/\bidl\b/gi, "IDL");

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function findNearestFeature(pathValue, featureByPath, fieldName = null) {
  const segments = pathValue.split(".");

  for (let size = segments.length; size >= 1; size -= 1) {
    const probe = segments.slice(0, size).join(".");
    const feature = featureByPath.get(probe);
    if (!feature) {
      continue;
    }

    if (!fieldName || feature[fieldName]) {
      return feature;
    }
  }

  return null;
}

function groupMilestones(milestoneItems, featureByPath) {
  const byDateAndMilestone = new Map();

  for (const item of milestoneItems) {
    const key = `${item.milestone.id}::${item.dateSupported}`;
    if (!byDateAndMilestone.has(key)) {
      byDateAndMilestone.set(key, []);
    }
    byDateAndMilestone.get(key).push(item);
  }

  const grouped = [];

  for (const items of byDateAndMilestone.values()) {
    const counts = prefixCountMap(items);
    const groups = new Map();

    for (const item of items) {
      const prefix = findBestSharedPrefix(item.path, counts);
      const key = `${item.milestone.id}::${item.dateSupported}::${prefix}`;

      if (!groups.has(key)) {
        groups.set(key, {
          milestone: item.milestone,
          dateSupported: item.dateSupported,
          groupPrefix: prefix,
          items: [],
        });
      }

      groups.get(key).items.push(item);
    }

    for (const group of groups.values()) {
      group.items.sort((a, b) => a.path.localeCompare(b.path));
      const representative = group.items.find((item) => item.path === group.groupPrefix) ?? group.items[0];
      const paths = group.items.map((item) => item.path);
      const groupFeature = findNearestFeature(group.groupPrefix, featureByPath);
      const groupMdn = representative.mdnUrl
        ?? findNearestFeature(group.groupPrefix, featureByPath, "mdnUrl")?.mdnUrl
        ?? null;
      const groupSpec = representative.specUrl
        ?? findNearestFeature(group.groupPrefix, featureByPath, "specUrl")?.specUrl
        ?? null;

      grouped.push({
        id: `${group.milestone.id}::${group.dateSupported}::${group.groupPrefix}`,
        milestone: group.milestone,
        dateSupported: group.dateSupported,
        groupPrefix: group.groupPrefix,
        title: groupFeature?.title ?? titleFromPath(group.groupPrefix),
        category: representative.category,
        summary: groupFeature?.summary ?? representative.summary,
        mdnUrl: groupMdn,
        specUrl: groupSpec,
        featureCount: group.items.length,
        paths,
        browsers: aggregateBrowserSupport(group.items, group.milestone.browserIds),
      });
    }
  }

  return grouped.sort((a, b) => {
    const dateDiff = new Date(b.dateSupported) - new Date(a.dateSupported);
    if (dateDiff !== 0) {
      return dateDiff;
    }

    const milestoneDiff = a.milestone.id.localeCompare(b.milestone.id);
    if (milestoneDiff !== 0) {
      return milestoneDiff;
    }

    return a.groupPrefix.localeCompare(b.groupPrefix);
  });
}

function createFeedItem(item) {
  const { pathParts, compat } = item;

  if (!compat?.status?.standard_track) {
    return null;
  }

  if (compat?.status?.deprecated || compat?.status?.experimental) {
    return null;
  }

  const browserSupport = {};
  for (const browser of TARGET_BROWSERS) {
    const supportDate = getSupportDateForBrowser(compat, browser.id);
    if (!supportDate) {
      continue;
    }

    browserSupport[browser.id] = {
      browser: browser.label,
      version: supportDate.version,
      date: supportDate.releaseDate,
    };
  }

  const id = pathParts.join(".");

  return {
    id,
    title: toFeatureTitle(pathParts, compat),
    path: id,
    category: pathParts[0],
    summary: compat.description || null,
    mdnUrl: compat.mdn_url || null,
    specUrl: Array.isArray(compat.spec_url) ? compat.spec_url[0] : compat.spec_url || null,
    browsers: browserSupport,
  };
}

function createMilestoneEntries(feature) {
  const entries = [];

  for (const milestone of MILESTONES) {
    const hasAllBrowsers = milestone.browserIds.every((browserId) => feature.browsers[browserId]);
    if (!hasAllBrowsers) {
      continue;
    }

    const milestoneDate = milestone.browserIds
      .map((browserId) => new Date(feature.browsers[browserId].date))
      .sort((a, b) => b - a)[0];

    entries.push({
      ...feature,
      milestone: {
        id: milestone.id,
        label: milestone.label,
        browserIds: milestone.browserIds,
      },
      dateSupported: milestoneDate.toISOString().slice(0, 10),
    });
  }

  return entries;
}

async function main() {
  const collected = [];
  for (const group of SOURCE_GROUPS) {
    collectCompatItems(bcd[group], [group], collected);
  }

  const features = collected
    .map(createFeedItem)
    .filter(Boolean);

  const featureByPath = new Map(features.map((feature) => [feature.path, feature]));

  const milestoneEntries = features.flatMap((feature) => createMilestoneEntries(feature));
  const feed = groupMilestones(milestoneEntries, featureByPath);

  const milestonesSummary = Object.fromEntries(
    MILESTONES.map((milestone) => [
      milestone.id,
      {
        label: milestone.label,
        browserIds: milestone.browserIds,
        totalEntries: feed.filter((entry) => entry.milestone.id === milestone.id).length,
      },
    ]),
  );

  const metadata = {
    generatedAt: new Date().toISOString(),
    sourcePackage: "@mdn/browser-compat-data",
    sourceVersion: bcd.__meta?.version || null,
    sourceGroups: SOURCE_GROUPS,
    targetBrowsers: TARGET_BROWSERS,
    milestones: milestonesSummary,
    totalUniqueFeatures: features.length,
    totalFeedEntries: feed.length,
    latestInteroperableDate: feed[0]?.dateSupported ?? null,
    earliestInteroperableDate: feed[feed.length - 1]?.dateSupported ?? null,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "features.json"), JSON.stringify(feed, null, 2) + "\n", "utf8");
  await writeFile(path.join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");

  console.log(`Generated ${feed.length} milestone feed entries from ${features.length} unique features.`);
  console.log(`Output: ${path.relative(rootDir, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
