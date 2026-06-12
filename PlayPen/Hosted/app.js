const elements = {
  composer: document.getElementById("composer"),
  composerForm: document.getElementById("composer-form"),
  titleInput: document.getElementById("title-input"),
  kindInput: document.getElementById("kind-input"),
  annotationInput: document.getElementById("annotation-input"),
  publishTokenInput: document.getElementById("publish-token-input"),
  sourceInput: document.getElementById("source-input"),
  fileInput: document.getElementById("file-input"),
  viewer: document.getElementById("viewer"),
  title: document.getElementById("playground-title"),
  metadata: document.getElementById("metadata"),
  annotation: document.getElementById("annotation"),
  previewPanel: document.getElementById("preview-panel"),
  sourcePanel: document.getElementById("source-panel"),
  previewTab: document.getElementById("preview-tab"),
  sourceTab: document.getElementById("source-tab"),
  openInPlayPen: document.getElementById("open-in-playpen"),
  configurePlayPen: document.getElementById("configure-playpen"),
  recordJSON: document.getElementById("record-json"),
  metadataLink: document.getElementById("metadata-link"),
  manifestLink: document.getElementById("manifest-link"),
  sourceLink: document.getElementById("source-link"),
  copyLink: document.getElementById("copy-link"),
  downloadSource: document.getElementById("download-source"),
  errorState: document.getElementById("error-state"),
  errorMessage: document.getElementById("error-message")
};

let activePayload = null;

function playgroundIDFromPath() {
  const match = /(?:^|\/)p\/([^/]+)\/?$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function serviceBaseURL() {
  const currentURL = new URL(window.location.href);
  const routedRecordMatch = /^(.*)\/p\/[^/]+\/?$/.exec(currentURL.pathname);
  if (routedRecordMatch) {
    currentURL.pathname = routedRecordMatch[1] || "/";
  } else if (/\/[^/]+\.[^/]+$/.test(currentURL.pathname)) {
    currentURL.pathname = currentURL.pathname.replace(/\/[^/]+$/, "") || "/";
  } else {
    currentURL.pathname = currentURL.pathname.replace(/\/$/, "") || "/";
  }
  currentURL.search = "";
  currentURL.hash = "";
  return currentURL.href.replace(/\/$/, "");
}

function recordEndpointURL(playgroundID) {
  return `${serviceBaseURL()}/api/playgrounds/${encodeURIComponent(playgroundID)}`;
}

function renderEndpointURL(playgroundID) {
  return `${recordEndpointURL(playgroundID)}/render`;
}

function publishEndpointURL() {
  return `${serviceBaseURL()}/api/playgrounds`;
}

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodePayload(encodedPayload) {
  let base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
  base64 += "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function payloadFromLocation() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const queryParams = new URLSearchParams(window.location.search);
  const encodedPayload = params.get("playground") || params.get("p") || queryParams.get("playground") || queryParams.get("p");
  if (!encodedPayload) {
    return null;
  }
  return decodePayload(encodedPayload);
}

async function payloadFromHostedRecord() {
  const playgroundID = playgroundIDFromPath();
  if (!playgroundID) {
    return null;
  }
  const response = await fetch(recordEndpointURL(playgroundID), {
    headers: { "accept": "application/json" }
  });
  if (!response.ok) {
    throw new Error("This hosted playground could not be found.");
  }
  return response.json();
}

function escapeHTML(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value) {
  return escapeHTML(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let isCodeBlock = false;
  let codeLines = [];
  let isListOpen = false;

  function closeList() {
    if (!isListOpen) {
      return;
    }
    html.push("</ul>");
    isListOpen = false;
  }

  lines.forEach(line => {
    if (line.startsWith("```")) {
      if (isCodeBlock) {
        html.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        isCodeBlock = false;
        return;
      }
      closeList();
      isCodeBlock = true;
      return;
    }

    if (isCodeBlock) {
      codeLines.push(line);
      return;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      return;
    }

    const listMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (listMatch) {
      if (!isListOpen) {
        html.push("<ul>");
        isListOpen = true;
      }
      html.push(`<li>${inlineMarkdown(listMatch[1])}</li>`);
      return;
    }

    if (!line.trim()) {
      closeList();
      return;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  });

  closeList();
  if (isCodeBlock) {
    html.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

function setTab(tabName) {
  const isPreview = tabName === "preview";
  elements.previewTab.classList.toggle("active", isPreview);
  elements.sourceTab.classList.toggle("active", !isPreview);
  elements.previewTab.setAttribute("aria-selected", String(isPreview));
  elements.sourceTab.setAttribute("aria-selected", String(!isPreview));
  elements.previewPanel.hidden = !isPreview;
  elements.sourcePanel.hidden = isPreview;
}

function renderPayload(payload) {
  if (!isValidPayload(payload)) {
    showError("This mirror link does not contain a valid PlayPen payload.");
    return;
  }
  activePayload = payload;
  elements.composer.hidden = true;
  elements.viewer.hidden = false;
  elements.errorState.hidden = true;
  elements.title.textContent = payload.title || "Untitled playground";
  const publishedAt = payload.publishedAt ? new Date(payload.publishedAt) : new Date();
  elements.metadata.textContent = `${payload.kind === "html" ? "HTML" : "Markdown"} · Published ${publishedAt.toLocaleString()}`;
  const annotation = normalizedAnnotation(payload);
  elements.annotation.hidden = !annotation;
  elements.annotation.textContent = annotation || "";
  elements.sourcePanel.textContent = payload.content || "";
  elements.openInPlayPen.href = openInPlayPenURL();
  elements.configurePlayPen.href = configurePlayPenURL();
  updateInspectionLinks();
  elements.previewPanel.replaceChildren();

  if (payload.kind === "html") {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    const playgroundID = playgroundIDFromPath();
    if (playgroundID) {
      iframe.src = renderEndpointURL(playgroundID);
    } else {
      iframe.srcdoc = payload.content || "";
    }
    elements.previewPanel.append(iframe);
  } else {
    elements.previewPanel.innerHTML = renderMarkdown(payload.content || "");
  }
  setTab("preview");
}

function showComposer() {
  activePayload = null;
  elements.composer.hidden = false;
  elements.viewer.hidden = true;
  elements.errorState.hidden = true;
}

function showError(message) {
  activePayload = null;
  elements.composer.hidden = true;
  elements.viewer.hidden = true;
  elements.errorState.hidden = false;
  elements.errorMessage.textContent = message;
}

function isValidPayload(payload) {
  return payload &&
    payload.version === 1 &&
    typeof payload.title === "string" &&
    typeof payload.content === "string" &&
    (payload.annotation === undefined || typeof payload.annotation === "string") &&
    (payload.kind === "markdown" || payload.kind === "html");
}

function createPayload() {
  const payload = {
    version: 1,
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: elements.titleInput.value.trim() || "Untitled playground",
    kind: elements.kindInput.value === "html" ? "html" : "markdown",
    content: elements.sourceInput.value,
    publishedAt: new Date().toISOString()
  };
  const annotation = elements.annotationInput.value.trim();
  if (annotation) {
    payload.annotation = annotation;
  }
  return payload;
}

function normalizedAnnotation(payload) {
  if (typeof payload.annotation !== "string") {
    return "";
  }
  return payload.annotation.trim();
}

async function publishPayload(payload) {
  const headers = {
    "accept": "application/json",
    "content-type": "application/json"
  };
  const publishToken = elements.publishTokenInput.value.trim();
  if (publishToken) {
    headers.authorization = `Bearer ${publishToken}`;
  }
  const response = await fetch(publishEndpointURL(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new HTTPError(response.status, await response.text());
  }
  return response.json();
}

class HTTPError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${errorMessageSuffix(body)}`);
    this.status = status;
  }

  get shouldUseStaticFallback() {
    return this.status === 404 || this.status === 405 || this.status === 501;
  }
}

function errorMessageSuffix(body) {
  try {
    const payload = JSON.parse(body || "{}");
    if (!payload.error) {
      return "";
    }
    return payload.code ? `: ${payload.error} (${payload.code})` : `: ${payload.error}`;
  } catch {
    return "";
  }
}

function updateLocation(payload) {
  const encodedPayload = encodePayload(payload);
  window.location.hash = `playground=${encodedPayload}`;
}

function openInPlayPenURL() {
  const url = new URL("playpen://import");
  url.searchParams.set("url", currentImportURL());
  return url.href;
}

function configurePlayPenURL() {
  const url = new URL("playpen://configure");
  url.searchParams.set("service", serviceBaseURL());
  return url.href;
}

function currentImportURL() {
  const playgroundID = playgroundIDFromPath();
  if (!playgroundID) {
    return window.location.href;
  }
  return `${serviceBaseURL()}/p/${encodeURIComponent(playgroundID)}`;
}

function updateInspectionLinks() {
  const playgroundID = playgroundIDFromPath();
  const inspectionLinks = [elements.recordJSON, elements.metadataLink, elements.manifestLink, elements.sourceLink];
  if (!playgroundID) {
    inspectionLinks.forEach(link => {
      link.hidden = true;
      link.href = "#";
    });
    return;
  }

  const recordURL = recordEndpointURL(playgroundID);
  elements.recordJSON.href = recordURL;
  elements.metadataLink.href = `${recordURL}/meta`;
  elements.manifestLink.href = `${recordURL}/manifest`;
  elements.sourceLink.href = `${recordURL}/source`;
  inspectionLinks.forEach(link => {
    link.hidden = false;
  });
}

function downloadSource() {
  if (!activePayload) {
    return;
  }
  const extension = activePayload.kind === "html" ? "html" : "md";
  const safeTitle = (activePayload.title || "playground").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const blob = new Blob([activePayload.content || ""], { type: activePayload.kind === "html" ? "text/html" : "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeTitle || "playground"}.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyCurrentLink() {
  await navigator.clipboard.writeText(window.location.href);
  elements.copyLink.textContent = "Copied";
  window.setTimeout(() => {
    elements.copyLink.textContent = "Copy link";
  }, 1200);
}

async function readFile(file) {
  const source = await file.text();
  elements.sourceInput.value = source;
  elements.titleInput.value = file.name.replace(/\.[^.]+$/, "");
  elements.kindInput.value = /\.html?$/i.test(file.name) ? "html" : "markdown";
}

elements.composerForm.addEventListener("submit", async event => {
  event.preventDefault();
  const payload = createPayload();
  try {
    const publishResult = await publishPayload(payload);
    window.location.assign(publishResult.url);
  } catch (error) {
    if (error instanceof HTTPError && !error.shouldUseStaticFallback) {
      showError(error.message || "The hosted service rejected this playground.");
      return;
    }
    updateLocation(payload);
  }
});

elements.fileInput.addEventListener("change", async event => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  await readFile(file);
});

elements.previewTab.addEventListener("click", () => setTab("preview"));
elements.sourceTab.addEventListener("click", () => setTab("source"));
elements.copyLink.addEventListener("click", copyCurrentLink);
elements.downloadSource.addEventListener("click", downloadSource);

async function loadInitialPayload() {
  let payload = null;
  try {
    payload = payloadFromLocation() || await payloadFromHostedRecord();
  } catch (error) {
    showError(error.message || "This mirror link is malformed.");
    return;
  }
  if (payload) {
    renderPayload(payload);
    return;
  }
  showComposer();
}

window.addEventListener("hashchange", () => {
  loadInitialPayload();
});

loadInitialPayload();
