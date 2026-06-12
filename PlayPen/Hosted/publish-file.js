const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const defaultServiceURL = process.env.PLAYPEN_SERVICE_URL || process.env.PLAYPEN_HOSTED_SERVICE_URL || "http://127.0.0.1:4177";
const defaultPublishToken = process.env.PLAYPEN_PUBLISH_TOKEN || "";

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.shouldShowHelp) {
    printHelp();
    return;
  }
  if (!options.filePath) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const payload = payloadFromFile(options);
  const publishResult = await publishPayload(payload, options);
  if (options.shouldPrintJSON) {
    console.log(JSON.stringify(publishResult, null, 2));
    return;
  }
  console.log(publishResult.url);
  if (!publishResult.didUseAPI) {
    console.error(`Used fragment fallback: ${publishResult.reason}`);
  }
}

function parseArguments(args) {
  const options = {
    annotation: null,
    filePath: null,
    id: null,
    kind: null,
    publishToken: defaultPublishToken,
    serviceURL: defaultServiceURL,
    shouldPrintJSON: false,
    shouldReplace: false,
    shouldShowHelp: false,
    title: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.shouldShowHelp = true;
      continue;
    }
    if (arg === "--annotation") {
      options.annotation = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--id") {
      options.id = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--kind") {
      options.kind = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.shouldPrintJSON = true;
      continue;
    }
    if (arg === "--replace") {
      options.shouldReplace = true;
      continue;
    }
    if (arg === "--token") {
      options.publishToken = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--service") {
      options.serviceURL = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.filePath) {
      throw new Error(`Unexpected extra file path: ${arg}`);
    }
    options.filePath = arg;
  }

  if (options.shouldReplace && !options.id) {
    throw new Error("--replace requires --id");
  }

  return options;
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function payloadFromFile(options) {
  const absolutePath = path.resolve(options.filePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const extension = path.extname(absolutePath).toLowerCase();
  const inferredKind = extension === ".html" || extension === ".htm" ? "html" : "markdown";
  const kind = options.kind || inferredKind;
  if (kind !== "html" && kind !== "markdown") {
    throw new Error("--kind must be html or markdown");
  }

  const title = options.title || path.basename(absolutePath, extension) || "Untitled playground";
  const payload = {
    version: 1,
    id: options.id || randomID(),
    title,
    kind,
    content,
    publishedAt: new Date().toISOString()
  };
  const annotation = (options.annotation || "").trim();
  if (annotation) {
    payload.annotation = annotation;
  }

  return payload;
}

async function publishPayload(payload, options) {
  const serviceURL = normalizedServiceURL(options.serviceURL);
  const endpointURL = options.shouldReplace ? recordEndpointURL(serviceURL, payload.id) : apiEndpointURL(serviceURL);
  const headers = {
    "accept": "application/json",
    "content-type": "application/json"
  };
  if (options.publishToken) {
    headers.authorization = `Bearer ${options.publishToken}`;
  }
  try {
    const response = await fetch(endpointURL, {
      method: options.shouldReplace ? "PUT" : "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new HTTPError(response.status, await response.text());
    }
    const publishResult = await response.json();
    if (!publishResult.url) {
      throw new Error("missing hosted URL");
    }
    const hostedURL = new URL(publishResult.url, serviceURL).href;
    return {
      ok: true,
      didUseAPI: true,
      mode: "api",
      id: publishResult.id || payload.id,
      title: payload.title,
      kind: payload.kind,
      annotation: publishResult.annotation || payload.annotation || null,
      serviceURL: serviceURL.href,
      url: hostedURL,
      recordURL: absoluteOptionalURL(publishResult.recordURL, serviceURL),
      metaURL: absoluteOptionalURL(publishResult.metaURL, serviceURL),
      manifestURL: absoluteOptionalURL(publishResult.manifestURL, serviceURL),
      sourceURL: absoluteOptionalURL(publishResult.sourceURL, serviceURL),
      ...(publishResult.renderURL ? { renderURL: absoluteOptionalURL(publishResult.renderURL, serviceURL) } : {}),
      publishedAt: publishResult.publishedAt || payload.publishedAt,
      contentDigest: publishResult.contentDigest || contentDigest(payload)
    };
  } catch (error) {
    if (options.shouldReplace) {
      throw new Error(`Replace failed: ${error.message || String(error)}`);
    }
    if (error instanceof HTTPError && !error.shouldUseStaticFallback) {
      throw new Error(`Publish failed: ${error.message}. Use --replace with --id ${payload.id} to update an existing hosted record.`);
    }
    return {
      ok: true,
      didUseAPI: false,
      mode: "static",
      id: payload.id,
      title: payload.title,
      kind: payload.kind,
      annotation: payload.annotation || null,
      serviceURL: serviceURL.href,
      reason: error.message || String(error),
      url: fragmentURL(serviceURL, payload),
      publishedAt: payload.publishedAt,
      contentDigest: contentDigest(payload)
    };
  }
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
    return payload.error ? `: ${payload.error}` : "";
  } catch {
    return "";
  }
}

function absoluteOptionalURL(value, baseURL) {
  if (!value) {
    return null;
  }
  return new URL(value, baseURL).href;
}

function normalizedServiceURL(serviceURLString) {
  const serviceURL = new URL(serviceURLString);
  serviceURL.search = "";
  serviceURL.hash = "";
  return serviceURL;
}

function apiEndpointURL(serviceURL) {
  const endpointBaseURL = new URL(serviceURL.href);
  const lastPathSegment = endpointBaseURL.pathname.split("/").filter(Boolean).pop() || "";
  if (lastPathSegment.includes(".")) {
    endpointBaseURL.pathname = endpointBaseURL.pathname.slice(0, -lastPathSegment.length);
  }
  if (!endpointBaseURL.pathname.endsWith("/")) {
    endpointBaseURL.pathname += "/";
  }
  return new URL("api/playgrounds", endpointBaseURL);
}

function recordEndpointURL(serviceURL, recordID) {
  return new URL(`${apiEndpointURL(serviceURL).href.replace(/\/$/, "")}/${encodeURIComponent(recordID)}`);
}

function fragmentURL(serviceURL, payload) {
  const fallbackURL = new URL(serviceURL.href);
  fallbackURL.hash = `playground=${encodePayload(payload)}`;
  return fallbackURL.href;
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function contentDigest(payload) {
  const digestParts = [payload.title, payload.kind, payload.content];
  if (payload.annotation) {
    digestParts.push(payload.annotation);
  }
  return crypto
    .createHash("sha256")
    .update(digestParts.join("\n"))
    .digest("hex");
}

function randomID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function printHelp() {
  console.log([
    "Usage: npm run publish -- <file> [--service URL] [--token TOKEN] [--title TITLE] [--annotation TEXT] [--kind html|markdown] [--id ID] [--replace] [--json]",
    "",
    "Publishes an HTML or Markdown file to a PlayPen hosted mirror.",
    "Use --replace with --id to update an existing API record at the same /p/:id link.",
    "If the API route is unavailable on a static host, prints a static fragment link instead.",
    "If an API host rejects the write, exits non-zero instead of hiding it behind fallback.",
    "Use --json for machine-readable agent output."
  ].join("\n"));
}
