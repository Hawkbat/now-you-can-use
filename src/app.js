const list = document.querySelector("#feed-list");
const template = document.querySelector("#item-template");
const searchInput = document.querySelector("#search-input");
const loadMoreButton = document.querySelector("#load-more");
const categorySelect = document.querySelector("#category-select");
const milestoneSelect = document.querySelector("#milestone-select");
const generatedAt = document.querySelector("#generated-at");

const ASSET_CONFIG = window.__NYCU_ASSETS__ ?? {};
const FEATURES_URL = ASSET_CONFIG.featuresUrl ?? "./data/features.json";
const METADATA_URL = ASSET_CONFIG.metadataUrl ?? "./data/metadata.json";

const PAGE_SIZE = 50;
const HOLDOUT_LEEWAY_DAYS = 3;

const CATEGORY_LABELS = {
  api: "API",
  css: "CSS",
  html: "HTML",
  javascript: "JavaScript",
  http: "HTTP",
  manifests: "Manifests",
  svg: "SVG",
  mathml: "MathML",
  mediatypes: "Media Types",
  webassembly: "WebAssembly",
  webdriver: "WebDriver",
  webextensions: "WebExtensions",
};

const PATH_SEGMENT_LABELS = {
  api: "API",
  css: "CSS",
  html: "HTML",
  javascript: "JavaScript",
  http: "HTTP",
  manifests: "Manifests",
  svg: "SVG",
  mathml: "MathML",
  mediatypes: "Media Types",
  webassembly: "WebAssembly",
  webdriver: "WebDriver",
  webextensions: "WebExtensions",
};

const BROWSER_ICON_META = {
  Chrome: {
    iconUrl: "./assets/icons/chrome.svg",
    fallbackClassName: "browser-icon-fallback-chrome",
    deviceType: "desktop",
  },
  Firefox: {
    iconUrl: "./assets/icons/firefox.svg",
    fallbackClassName: "browser-icon-fallback-firefox",
    deviceType: "desktop",
  },
  Edge: {
    iconUrl: "./assets/icons/edge.svg",
    fallbackClassName: "browser-icon-fallback-edge",
    deviceType: "desktop",
  },
  Safari: {
    iconUrl: "./assets/icons/safari.svg",
    fallbackClassName: "browser-icon-fallback-safari",
    deviceType: "desktop",
  },
  "Chrome Android": {
    iconUrl: "./assets/icons/chrome.svg",
    fallbackClassName: "browser-icon-fallback-chrome",
    deviceType: "mobile",
  },
  "Firefox Android": {
    iconUrl: "./assets/icons/firefox.svg",
    fallbackClassName: "browser-icon-fallback-firefox",
    deviceType: "mobile",
  },
  "Safari iOS": {
    iconUrl: "./assets/icons/safari.svg",
    fallbackClassName: "browser-icon-fallback-safari",
    deviceType: "mobile",
  },
};

const DEVICE_ICON_META = {
  desktop: {
    iconUrl: "./assets/icons/monitor.svg",
    className: "device-icon-desktop",
    label: "Desktop browser",
  },
  mobile: {
    iconUrl: "./assets/icons/smartphone.svg",
    className: "device-icon-mobile",
    label: "Mobile browser",
  },
};

let allEntries = [];
let filteredEntries = [];
let visibleEntries = PAGE_SIZE;

function sourceGroupsFromEntries(entries) {
  return [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function formatCategoryLabel(group) {
  if (CATEGORY_LABELS[group]) {
    return CATEGORY_LABELS[group];
  }

  return group
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function humanizePathSegment(segment) {
  if (!segment) {
    return "";
  }

  if (PATH_SEGMENT_LABELS[segment]) {
    return PATH_SEGMENT_LABELS[segment];
  }

  return segment
    .replace(/_/g, " ")
    .split("-")
    .map((part) => {
      if (!part) {
        return "";
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function formatPathLabel(pathValue) {
  return pathValue
    .split(".")
    .map((segment) => humanizePathSegment(segment))
    .join(" > ");
}

function populateCategoryOptions(sourceGroups) {
  const options = (sourceGroups ?? []).filter(Boolean);
  if (!options.length) {
    return;
  }

  const fragment = document.createDocumentFragment();
  options.forEach((group) => {
    const option = document.createElement("option");
    option.value = group;
    option.textContent = formatCategoryLabel(group);
    fragment.append(option);
  });

  categorySelect.append(fragment);
}

function sanitizeCompatInlineHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = value;

  const allowedTags = new Set(["CODE"]);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();

  while (current) {
    const node = current;
    current = walker.nextNode();

    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent ?? ""));
      continue;
    }

    for (const attribute of [...node.attributes]) {
      node.removeAttribute(attribute.name);
    }
  }

  return template.innerHTML;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatVersionSummary(browser) {
  if (browser.version !== "multiple") {
    return browser.version;
  }

  const versions = [...new Set((browser.versions ?? []).filter(Boolean))];
  if (!versions.length) {
    return "multiple";
  }

  const numeric = versions.map((value) => Number.parseFloat(value));
  const allNumeric = numeric.every((value) => !Number.isNaN(value));

  if (allNumeric) {
    const pairs = versions.map((value, index) => ({ raw: value, parsed: numeric[index] }));
    pairs.sort((a, b) => a.parsed - b.parsed);
    const min = pairs[0].raw;
    const max = pairs[pairs.length - 1].raw;
    if (min === max) {
      return min;
    }
    return `${min}-${max}`;
  }

  return `${versions.length} versions`;
}

function latestDate(values) {
  const dates = (values ?? [])
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.valueOf()));

  if (!dates.length) {
    return null;
  }

  return dates.sort((a, b) => b - a)[0];
}

function isHoldoutBrowser(browser, milestoneDateValue) {
  const milestoneDate = new Date(milestoneDateValue);
  if (Number.isNaN(milestoneDate.valueOf())) {
    return false;
  }

  const browserLatest = latestDate(browser.dates ?? [browser.date]);
  if (!browserLatest) {
    return false;
  }

  const diffDays = (milestoneDate - browserLatest) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= HOLDOUT_LEEWAY_DAYS;
}

function renderEntries(entries) {
  list.textContent = "";
  const slice = entries.slice(0, visibleEntries);

  loadMoreButton.hidden = slice.length === 0 || slice.length >= entries.length;

  if (!slice.length) {
    const empty = document.createElement("li");
    empty.className = "feature-card feature-empty";
    empty.textContent = "No matches yet. Try a broader search term.";
    list.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  slice.forEach((entry, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".feature-card");

    card.style.setProperty("--delay", `${index * 18}ms`);
    node.querySelector(".feature-date").textContent = formatDate(entry.dateSupported);
    node.querySelector(".feature-category").textContent = formatCategoryLabel(entry.category);
    const title = node.querySelector(".feature-title");
    title.innerHTML = sanitizeCompatInlineHtml(entry.title);
    const featurePath = node.querySelector(".feature-path");
    featurePath.textContent = formatPathLabel(entry.groupPrefix);
    featurePath.title = entry.groupPrefix;
    node.querySelector(".feature-count").textContent =
      entry.featureCount > 1 ? `${entry.featureCount} related entries` : "Single entry";

    const browserGrid = node.querySelector(".browser-grid");
    Object.values(entry.browsers).forEach((browser) => {
      const pill = document.createElement("span");
      pill.className = "browser-pill";
      if (isHoldoutBrowser(browser, entry.dateSupported)) {
        pill.classList.add("browser-pill-holdout");
        pill.title = "Final holdout (or near-final) browser for this milestone";
      }
      const iconMeta = BROWSER_ICON_META[browser.browser] ?? {
        iconUrl: "",
        fallbackClassName: "browser-icon-fallback-generic",
        deviceType: "desktop",
      };
      const icon = document.createElement("img");
      icon.className = `browser-icon ${iconMeta.fallbackClassName}`;
      icon.src = iconMeta.iconUrl;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      icon.loading = "lazy";
      icon.decoding = "async";

      const deviceMeta = DEVICE_ICON_META[iconMeta.deviceType] ?? DEVICE_ICON_META.desktop;
      const deviceIcon = document.createElement("img");
      deviceIcon.className = `device-icon ${deviceMeta.className}`;
      deviceIcon.src = deviceMeta.iconUrl;
      deviceIcon.alt = "";
      deviceIcon.setAttribute("aria-hidden", "true");
      deviceIcon.loading = "lazy";
      deviceIcon.decoding = "async";

      const version = document.createElement("span");
      version.className = "browser-version";
      version.textContent = formatVersionSummary(browser);

      pill.title = `${browser.browser} (${deviceMeta.label}) ${version.textContent}`;
      pill.append(icon, deviceIcon, version);
      browserGrid.append(pill);
    });

    const subpaths = node.querySelector(".feature-subpaths");
    const maxSubpaths = 3;
    const head = entry.paths.slice(0, maxSubpaths);
    head.forEach((pathValue) => {
      const item = document.createElement("li");
      item.textContent = formatPathLabel(pathValue);
      item.title = pathValue;
      subpaths.append(item);
    });

    if (entry.paths.length > maxSubpaths) {
      const remainder = document.createElement("li");
      remainder.className = "subpath-more";
      remainder.textContent = `+ ${entry.paths.length - maxSubpaths} more`;
      subpaths.append(remainder);
    }

    const links = node.querySelector(".feature-links");
    if (entry.mdnUrl) {
      const mdnLink = document.createElement("a");
      mdnLink.href = entry.mdnUrl;
      mdnLink.textContent = "MDN";
      mdnLink.target = "_blank";
      mdnLink.rel = "noreferrer";
      links.append(mdnLink);
    }
    if (entry.specUrl) {
      const specLink = document.createElement("a");
      specLink.href = entry.specUrl;
      specLink.textContent = "Spec";
      specLink.target = "_blank";
      specLink.rel = "noreferrer";
      links.append(specLink);
    }

    fragment.append(node);
  });

  list.append(fragment);
}

function applyFilters(resetPagination = false) {
  if (resetPagination) {
    visibleEntries = PAGE_SIZE;
  }

  const query = searchInput.value.trim().toLowerCase();
  const category = categorySelect.value;
  const milestoneId = milestoneSelect.value;

  filteredEntries = allEntries.filter((entry) => {
    if (entry.milestone.id !== milestoneId) {
      return false;
    }

    if (category !== "all" && entry.category !== category) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [entry.title, entry.groupPrefix, entry.category, entry.summary, entry.milestone.label, ...(entry.paths ?? [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  renderEntries(filteredEntries);
}

async function init() {
  const [featuresResponse, metadataResponse] = await Promise.all([
    fetch(FEATURES_URL),
    fetch(METADATA_URL),
  ]);

  allEntries = await featuresResponse.json();
  const metadata = await metadataResponse.json();

  populateCategoryOptions(metadata.sourceGroups ?? sourceGroupsFromEntries(allEntries));

  generatedAt.textContent = formatDate(metadata.generatedAt);
  generatedAt.dateTime = metadata.generatedAt;

  applyFilters(true);

  searchInput.addEventListener("input", () => applyFilters(true));
  categorySelect.addEventListener("change", () => applyFilters(true));
  milestoneSelect.addEventListener("change", () => applyFilters(true));

  loadMoreButton.addEventListener("click", () => {
    visibleEntries += PAGE_SIZE;
    renderEntries(filteredEntries);
  });
}

init().catch((error) => {
  list.textContent = "Failed to load feed data.";
  console.error(error);
});
