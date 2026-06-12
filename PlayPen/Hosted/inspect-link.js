const crypto = require("crypto");

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
  if (!options.url) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const artifact = await inspectLink(options.url);
  verifyExpectedDigest(artifact, options.expectedDigest);
  if (options.shouldPrintSource) {
    process.stdout.write(artifact.content);
    return;
  }
  if (options.shouldPrintMetadata) {
    const { content: _content, ...metadata } = artifact;
    console.log(JSON.stringify(metadata, null, 2));
    return;
  }
  console.log(JSON.stringify(artifact, null, 2));
}

function parseArguments(args) {
  const options = {
    expectedDigest: null,
    shouldPrintMetadata: false,
    shouldPrintSource: false,
    shouldShowHelp: false,
    url: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.shouldShowHelp = true;
      continue;
    }
    if (arg === "--expect-digest") {
      options.expectedDigest = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--meta") {
      options.shouldPrintMetadata = true;
      continue;
    }
    if (arg === "--source") {
      options.shouldPrintSource = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.url) {
      throw new Error(`Unexpected extra URL: ${arg}`);
    }
    options.url = arg;
  }

  if (options.shouldPrintMetadata && options.shouldPrintSource) {
    throw new Error("Use either --meta or --source, not both");
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

async function inspectLink(urlString) {
  const inputURL = new URL(urlString);
  const fragmentPayload = payloadFromFragment(inputURL);
  if (fragmentPayload) {
    return artifactFromPayload(fragmentPayload, {
      mode: "static",
      url: inputURL.href
    });
  }

  const route = routeFromURL(inputURL);
  if (!route) {
    return inspectByDiscovery(inputURL);
  }
  if (route.kind === "record" || route.kind === "render" || route.kind === "viewer") {
    const payload = await getJSON(route.recordURL);
    return artifactFromPayload(payload, {
      mode: "api",
      url: route.viewURL,
      recordURL: route.recordURL,
      metaURL: route.metaURL,
      manifestURL: route.manifestURL,
      renderURL: route.renderURL,
      sourceURL: route.sourceURL
    });
  }
  if (route.kind === "metadata") {
    const metadata = await getJSON(inputURL.href);
    const source = await getText(metadata.sourceURL || route.sourceURL);
    return artifactFromMetadata(metadata, source, route);
  }
  if (route.kind === "manifest") {
    const manifest = await getJSON(inputURL.href);
    const metadata = {
      ...(manifest.artifact || {}),
      ...(manifest.links?.render ? { renderURL: manifest.links.render } : {})
    };
    const source = await getText(manifest.links?.source || metadata.sourceURL || route.sourceURL);
    return artifactFromMetadata(metadata, source, route);
  }

  const metadata = await getJSON(route.metaURL);
  const source = await getText(inputURL.href);
  return artifactFromMetadata(metadata, source, route);
}

function verifyExpectedDigest(artifact, expectedDigest) {
  if (!expectedDigest) {
    return;
  }
  const normalizedExpectedDigest = expectedDigest.trim().replace(/^sha256-/i, "");
  if (normalizedExpectedDigest === artifact.contentDigest) {
    return;
  }
  throw new Error(`Digest mismatch: expected ${normalizedExpectedDigest}, got ${artifact.contentDigest}`);
}

async function inspectByDiscovery(inputURL) {
  const response = await fetch(inputURL.href, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`Unable to inspect ${inputURL.href}: HTTP ${response.status}`);
  }
  const recordURL = response.headers.get("x-playpen-record-url");
  if (!recordURL) {
    throw new Error("This URL is not a PlayPen hosted artifact link.");
  }
  return inspectLink(new URL(recordURL, inputURL).href);
}

function payloadFromFragment(inputURL) {
  const hash = inputURL.hash.startsWith("#") ? inputURL.hash.slice(1) : inputURL.hash;
  const hashParams = new URLSearchParams(hash);
  const queryParams = inputURL.searchParams;
  const encodedPayload = hashParams.get("playground") || hashParams.get("p") || queryParams.get("playground") || queryParams.get("p");
  if (!encodedPayload) {
    return null;
  }
  return decodePayload(encodedPayload);
}

function decodePayload(encodedPayload) {
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
}

function routeFromURL(inputURL) {
  const pathSegments = inputURL.pathname.split("/").filter(Boolean);
  const apiIndex = pathSegments.lastIndexOf("api");
  if (apiIndex >= 0 && pathSegments[apiIndex + 1] === "playgrounds" && pathSegments[apiIndex + 2]) {
    const id = decodeURIComponent(pathSegments[apiIndex + 2]);
    const serviceBaseURL = baseURLFromSegments(inputURL, pathSegments.slice(0, apiIndex));
    return routeForID(serviceBaseURL, id, routeKind(pathSegments[apiIndex + 3]));
  }

  const viewerIndex = pathSegments.lastIndexOf("p");
  if (viewerIndex >= 0 && pathSegments[viewerIndex + 1]) {
    const id = decodeURIComponent(pathSegments[viewerIndex + 1]);
    const serviceBaseURL = baseURLFromSegments(inputURL, pathSegments.slice(0, viewerIndex));
    return routeForID(serviceBaseURL, id, "viewer");
  }
  return null;
}

function baseURLFromSegments(inputURL, prefixSegments) {
  const baseURL = new URL(inputURL.href);
  baseURL.pathname = prefixSegments.length ? `/${prefixSegments.map(encodeURIComponent).join("/")}` : "/";
  baseURL.search = "";
  baseURL.hash = "";
  return baseURL.href.replace(/\/$/, "");
}

function routeForID(serviceBaseURL, id, kind) {
  const encodedID = encodeURIComponent(id);
  const recordURL = `${serviceBaseURL}/api/playgrounds/${encodedID}`;
  return {
    kind,
    id,
    serviceBaseURL,
    viewURL: `${serviceBaseURL}/p/${encodedID}`,
    recordURL,
    metaURL: `${recordURL}/meta`,
    manifestURL: `${recordURL}/manifest`,
    renderURL: `${recordURL}/render`,
    sourceURL: `${recordURL}/source`
  };
}

function routeKind(pathSegment) {
  if (pathSegment === "meta") {
    return "metadata";
  }
  if (pathSegment === "manifest") {
    return "manifest";
  }
  if (pathSegment === "render") {
    return "render";
  }
  if (pathSegment === "source") {
    return "source";
  }
  return "record";
}

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { "accept": "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { "accept": "text/plain" }
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

function artifactFromPayload(payload, urls) {
  if (!isValidPayload(payload)) {
    throw new Error("This link did not return a valid PlayPen payload.");
  }
  const annotation = normalizedAnnotation(payload);
  return {
    ok: true,
    mode: urls.mode,
    id: payload.id || null,
    title: payload.title,
    kind: payload.kind,
    annotation: annotation || null,
    url: urls.url || null,
    recordURL: urls.recordURL || null,
    metaURL: urls.metaURL || null,
    manifestURL: urls.manifestURL || null,
    ...(payload.kind === "html" && urls.renderURL ? { renderURL: urls.renderURL } : {}),
    sourceURL: urls.sourceURL || null,
    publishedAt: payload.publishedAt || null,
    contentBytes: Buffer.byteLength(payload.content, "utf8"),
    contentDigest: contentDigest(payload),
    content: payload.content
  };
}

function artifactFromMetadata(metadata, content, route) {
  const payload = {
    version: 1,
    id: metadata.id || route.id,
    title: metadata.title,
    kind: metadata.kind,
    annotation: metadata.annotation || undefined,
    content,
    publishedAt: metadata.publishedAt
  };
  const artifact = artifactFromPayload(payload, {
    mode: "api",
    url: metadata.url || route.viewURL,
    recordURL: metadata.recordURL || route.recordURL,
    metaURL: route.metaURL,
    manifestURL: metadata.manifestURL || route.manifestURL,
    renderURL: metadata.renderURL || route.renderURL,
    sourceURL: metadata.sourceURL || route.sourceURL
  });
  artifact.contentDigest = metadata.contentDigest || artifact.contentDigest;
  artifact.contentBytes = metadata.contentBytes ?? artifact.contentBytes;
  return artifact;
}

function isValidPayload(payload) {
  return payload &&
    payload.version === 1 &&
    typeof payload.title === "string" &&
    (payload.kind === "markdown" || payload.kind === "html") &&
    typeof payload.content === "string";
}

function normalizedAnnotation(payload) {
  if (typeof payload.annotation !== "string") {
    return "";
  }
  return payload.annotation.trim();
}

function contentDigest(payload) {
  const digestParts = [payload.title, payload.kind, payload.content];
  const annotation = normalizedAnnotation(payload);
  if (annotation) {
    digestParts.push(annotation);
  }
  return crypto
    .createHash("sha256")
    .update(digestParts.join("\n"))
    .digest("hex");
}

function printHelp() {
  console.log([
    "Usage: npm run inspect -- <playpen-url> [--meta|--source] [--expect-digest SHA256]",
    "",
    "Inspects a PlayPen hosted mirror URL, API record URL, metadata URL, manifest",
    "URL, source URL, render URL, or static #playground= fallback link without executing the artifact.",
    "By default, prints JSON with metadata and source content.",
    "Use --meta for metadata JSON only or --source for raw source only.",
    "Use --expect-digest to exit non-zero if the artifact no longer matches."
  ].join("\n"));
}
