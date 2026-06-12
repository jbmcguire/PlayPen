const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createStorage } = require("./storage");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4177);
const rootDirectory = __dirname;
const storage = createStorage(process.env, { rootDirectory });
const configuredPublicBaseURL = configuredBaseURL(process.env.PLAYPEN_PUBLIC_BASE_URL);
const listenBaseURL = `http://${host}:${port}`;
const maxPayloadBytes = 2_000_000;
const publishToken = (process.env.PLAYPEN_PUBLISH_TOKEN || "").trim();
const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff"
};
const renderedArtifactSecurityHeaders = {
  ...securityHeaders,
  "content-security-policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src * data: blob: 'unsafe-inline' 'unsafe-eval'; style-src * data: blob: 'unsafe-inline'; img-src * data: blob:; font-src * data: blob:; connect-src *; media-src * data: blob:; frame-src * data: blob:; worker-src blob:; base-uri 'none'; form-action 'none'"
};
const publicReadCORSHeaders = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-disposition, content-type, etag, link, x-playpen-content-digest, x-playpen-kind, x-playpen-manifest-url, x-playpen-meta-url, x-playpen-record-url, x-playpen-render-url, x-playpen-source-url"
};
const publicReadCORSMethods = ["GET", "HEAD", "OPTIONS"];
const errorCodes = [
  "forbidden",
  "internal_error",
  "invalid_payload",
  "method_not_allowed",
  "not_found",
  "payload_too_large",
  "playground_conflict",
  "playground_not_found",
  "publish_token_required"
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendError(response, 413, "payload_too_large", "Payload too large", { maxPayloadBytes });
      return;
    }
    if (error instanceof InvalidPayloadError) {
      sendError(response, 400, "invalid_payload", "Invalid PlayPen payload");
      return;
    }
    sendError(response, 500, "internal_error", error.message || "Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`PlayPen Hosted Mirror listening on ${configuredPublicBaseURL || listenBaseURL}`);
});

async function route(request, response) {
  const publicBaseURL = publicBaseURLForRequest(request);
  const requestURL = routedRequestURL(request, publicBaseURL);
  if (isPublicReadRequest(request.method, requestURL.pathname)) {
    setHeaders(response, publicReadCORSHeaders);
  }

  if (request.method === "OPTIONS" && isPublicReadPath(requestURL.pathname)) {
    response.writeHead(204, {
      ...securityHeaders,
      ...publicReadCORSHeaders,
      "access-control-allow-headers": "accept, content-type",
      "access-control-allow-methods": publicReadCORSMethods.join(", "),
      "access-control-max-age": "600",
      "cache-control": "no-store"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/health") {
    sendJSON(response, 200, {
      ok: true,
      storage: storage.type,
      publicBaseURL,
      publicBaseURLSource: configuredPublicBaseURL ? "env" : "request",
      capabilitiesURL: `${publicBaseURL}/.well-known/playpen-host.json`,
      maxPayloadBytes,
      publishAuthRequired: Boolean(publishToken)
    });
    return;
  }

  if (request.method === "GET" && (requestURL.pathname === "/api/capabilities" || requestURL.pathname === "/.well-known/playpen-host.json")) {
    sendJSON(response, 200, capabilities(publicBaseURL));
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && (requestURL.pathname === "/openapi.json" || requestURL.pathname === "/.well-known/openapi.json")) {
    sendFile(response, path.join(rootDirectory, "openapi.json"), request.method === "HEAD");
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/stats") {
    sendJSON(response, 200, await storage.stats());
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/playgrounds") {
    const pagination = paginationOptions(requestURL);
    const payloadList = await storage.listPayloads(pagination);
    sendJSON(response, 200, playgroundList(payloadList, publicBaseURL));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/playgrounds") {
    if (!hasValidPublishToken(request)) {
      sendError(response, 401, "publish_token_required", "Publish token required", {}, false, {
        "www-authenticate": "Bearer realm=\"PlayPen Hosted Mirror\""
      });
      return;
    }
    const payload = await readPlaygroundPayload(request, requestURL);
    if (!isValidPayload(payload)) {
      sendError(response, 400, "invalid_payload", "Invalid PlayPen payload");
      return;
    }
    const playgroundID = safeID(payload.id) || crypto.randomUUID();
    const publishedPayload = publishedPlaygroundPayload(payload, playgroundID);
    if (!await storage.createPayload(playgroundID, publishedPayload)) {
      sendError(response, 409, "playground_conflict", "Playground already exists", {
        id: playgroundID,
        replaceURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(playgroundID)}`
      });
      return;
    }
    sendJSON(response, 201, publishResult(publishedPayload, publicBaseURL));
    return;
  }

  const playgroundRoute = /^\/api\/playgrounds\/([^/]+)(?:\/(manifest|meta|render|source))?\/?$/.exec(requestURL.pathname);
  if (request.method === "PUT" && playgroundRoute && !playgroundRoute[2]) {
    if (!hasValidPublishToken(request)) {
      sendError(response, 401, "publish_token_required", "Publish token required", {}, false, {
        "www-authenticate": "Bearer realm=\"PlayPen Hosted Mirror\""
      });
      return;
    }
    const playgroundID = decodeURIComponent(playgroundRoute[1]);
    if (!safeID(playgroundID)) {
      sendError(response, 404, "playground_not_found", "Playground not found");
      return;
    }
    const payload = await readPlaygroundPayload(request, requestURL, playgroundID);
    if (!isValidPayload(payload)) {
      sendError(response, 400, "invalid_payload", "Invalid PlayPen payload");
      return;
    }
    const publishedPayload = publishedPlaygroundPayload(payload, playgroundID);
    await storage.writePayload(playgroundID, publishedPayload);
    sendJSON(response, 200, publishResult(publishedPayload, publicBaseURL));
    return;
  }

  if (request.method === "DELETE" && playgroundRoute && !playgroundRoute[2]) {
    if (!hasValidPublishToken(request)) {
      sendError(response, 401, "publish_token_required", "Publish token required", {}, false, {
        "www-authenticate": "Bearer realm=\"PlayPen Hosted Mirror\""
      });
      return;
    }
    const playgroundID = decodeURIComponent(playgroundRoute[1]);
    if (!safeID(playgroundID)) {
      sendError(response, 404, "playground_not_found", "Playground not found");
      return;
    }
    if (!await storage.deletePayload(playgroundID)) {
      sendError(response, 404, "playground_not_found", "Playground not found");
      return;
    }
    sendJSON(response, 200, { ok: true, id: playgroundID });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && playgroundRoute) {
    const playgroundID = decodeURIComponent(playgroundRoute[1]);
    if (!safeID(playgroundID)) {
      sendError(response, 404, "playground_not_found", "Playground not found", {}, request.method === "HEAD");
      return;
    }
    const payload = await storage.readPayload(playgroundID);
    if (!payload) {
      sendError(response, 404, "playground_not_found", "Playground not found", {}, request.method === "HEAD");
      return;
    }
    const digest = contentDigest(payload);
    const etag = strongETag(digest);
    if (isFresh(request, etag)) {
      sendNotModified(response, etag);
      return;
    }
    if (playgroundRoute[2] === "meta") {
      sendJSON(response, 200, metadata(payload, publicBaseURL), request.method === "HEAD", {
        "etag": etag,
        "x-playpen-content-digest": digest
      });
      return;
    }
    if (playgroundRoute[2] === "manifest") {
      sendJSON(response, 200, artifactManifest(payload, publicBaseURL), request.method === "HEAD", {
        "etag": etag,
        "x-playpen-content-digest": digest
      });
      return;
    }
    if (playgroundRoute[2] === "source") {
      sendSource(response, payload, request.method === "HEAD", {
        "etag": etag,
        "x-playpen-content-digest": digest
      });
      return;
    }
    if (playgroundRoute[2] === "render") {
      if (payload.kind !== "html") {
        sendError(response, 400, "invalid_payload", "Only HTML playgrounds can be rendered", {}, request.method === "HEAD");
        return;
      }
      sendRenderedHTML(response, payload, request.method === "HEAD", {
        "etag": etag,
        "x-playpen-content-digest": digest
      });
      return;
    }
    sendJSON(response, 200, payload, request.method === "HEAD", {
      "etag": etag,
      "x-playpen-content-digest": digest
    });
    return;
  }

  const routedAsset = /^\/p\/(app\.js|styles\.css|index\.html)$/.exec(requestURL.pathname);
  if ((request.method === "GET" || request.method === "HEAD") && routedAsset) {
    sendFile(response, path.join(rootDirectory, routedAsset[1]), request.method === "HEAD");
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && /^\/p\/[^/]+\/?$/.test(requestURL.pathname)) {
    const playgroundID = decodeURIComponent(requestURL.pathname.split("/").filter(Boolean)[1] || "");
    if (!safeID(playgroundID)) {
      sendFile(response, path.join(rootDirectory, "index.html"), request.method === "HEAD", {}, 404);
      return;
    }
    const payload = await storage.readPayload(playgroundID);
    if (!payload) {
      sendFile(response, path.join(rootDirectory, "index.html"), request.method === "HEAD", {}, 404);
      return;
    }
    const digest = contentDigest(payload);
    const etag = strongETag(digest);
    if (isFresh(request, etag)) {
      sendNotModified(response, etag);
      return;
    }
    sendFile(response, path.join(rootDirectory, "index.html"), request.method === "HEAD", {
      ...viewerInspectionHeaders(payload, publicBaseURL),
      "etag": etag,
      "x-playpen-content-digest": digest
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendError(response, 405, "method_not_allowed", "Method not allowed");
    return;
  }

  const staticPath = requestURL.pathname === "/" ? "/index.html" : requestURL.pathname;
  const filePath = path.normalize(path.join(rootDirectory, staticPath));
  if (!filePath.startsWith(rootDirectory) || filePath.includes(`${path.sep}.playpen-store${path.sep}`)) {
    sendError(response, 403, "forbidden", "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendError(response, 404, "not_found", "Not found");
    return;
  }
  sendFile(response, filePath, request.method === "HEAD");
}

async function readPlaygroundPayload(request, requestURL, forcedID = null) {
  if (isRawTextRequest(request)) {
    return rawTextPayload(request, requestURL, await readBody(request), forcedID);
  }
  try {
    return JSON.parse(await readBody(request) || "{}");
  } catch {
    throw new InvalidPayloadError();
  }
}

function isRawTextRequest(request) {
  return ["text/html", "text/markdown", "text/x-markdown", "text/plain"].includes(requestMediaType(request));
}

function requestMediaType(request) {
  return firstHeaderValue(request.headers["content-type"]).split(";")[0].trim().toLowerCase();
}

function rawTextPayload(request, requestURL, content, forcedID) {
  return {
    version: 1,
    id: forcedID || metadataValue(request, requestURL, "id") || undefined,
    title: metadataValue(request, requestURL, "title") || "Untitled playground",
    kind: rawPayloadKind(request, requestURL),
    annotation: metadataValue(request, requestURL, "annotation") || undefined,
    content,
    publishedAt: metadataValue(request, requestURL, "published-at") || new Date().toISOString()
  };
}

function metadataValue(request, requestURL, name) {
  const queryValue = requestURL.searchParams.get(name);
  if (queryValue) {
    return queryValue.trim();
  }
  return firstHeaderValue(request.headers[`x-playpen-${name}`]).trim();
}

function rawPayloadKind(request, requestURL) {
  const explicitKind = metadataValue(request, requestURL, "kind").toLowerCase();
  if (explicitKind === "html" || explicitKind === "markdown") {
    return explicitKind;
  }
  return requestMediaType(request) === "text/html" ? "html" : "markdown";
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let isTooLarge = false;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      if (isTooLarge) {
        return;
      }
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxPayloadBytes) {
        isTooLarge = true;
        body = "";
        reject(new PayloadTooLargeError());
      }
    });
    request.on("end", () => {
      if (isTooLarge) {
        return;
      }
      resolve(body);
    });
    request.on("error", reject);
  });
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

class InvalidPayloadError extends Error {
  constructor() {
    super("Invalid PlayPen payload");
  }
}

function isValidPayload(payload) {
  return payload &&
    payload.version === 1 &&
    typeof payload.title === "string" &&
    typeof payload.content === "string" &&
    (payload.annotation === undefined || typeof payload.annotation === "string") &&
    (payload.kind === "markdown" || payload.kind === "html");
}

function safeID(value) {
  if (typeof value !== "string") {
    return null;
  }
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}

function publishedPlaygroundPayload(payload, playgroundID) {
  const { annotation: _annotation, ...payloadWithoutAnnotation } = payload;
  const annotation = normalizedAnnotation(payload);
  return {
    ...payloadWithoutAnnotation,
    ...(annotation ? { annotation } : {}),
    id: playgroundID,
    publishedAt: payload.publishedAt || new Date().toISOString()
  };
}

function publishResult(payload, publicBaseURL) {
  const annotation = normalizedAnnotation(payload);
  const htmlRenderURL = renderURL(payload, publicBaseURL);
  return {
    id: payload.id,
    url: viewURL(payload.id, publicBaseURL),
    publishedAt: payload.publishedAt,
    ...(annotation ? { annotation } : {}),
    metaURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}/meta`,
    manifestURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}/manifest`,
    recordURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}`,
    sourceURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}/source`,
    ...(htmlRenderURL ? { renderURL: htmlRenderURL } : {}),
    contentDigest: contentDigest(payload)
  };
}

function metadata(payload, publicBaseURL) {
  const contentBytes = Buffer.byteLength(payload.content, "utf8");
  const htmlRenderURL = renderURL(payload, publicBaseURL);
  return {
    id: payload.id,
    title: payload.title,
    kind: payload.kind,
    annotation: normalizedAnnotation(payload),
    publishedAt: payload.publishedAt,
    contentBytes,
    contentDigest: contentDigest(payload),
    url: viewURL(payload.id, publicBaseURL),
    manifestURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}/manifest`,
    recordURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}`,
    sourceURL: `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}/source`,
    ...(htmlRenderURL ? { renderURL: htmlRenderURL } : {})
  };
}

function renderURL(payload, publicBaseURL) {
  if (payload.kind !== "html") {
    return null;
  }
  return `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}/render`;
}

function artifactManifest(payload, publicBaseURL) {
  const digest = contentDigest(payload);
  const metadataValue = metadata(payload, publicBaseURL);
  return {
    ok: true,
    type: "playpen.artifact",
    version: 1,
    artifact: metadataValue,
    links: {
      view: metadataValue.url,
      record: metadataValue.recordURL,
      metadata: metadataValue.recordURL + "/meta",
      manifest: metadataValue.manifestURL,
      source: metadataValue.sourceURL,
      ...(metadataValue.renderURL ? { render: metadataValue.renderURL } : {}),
      openAPI: `${publicBaseURL}/openapi.json`,
      capabilities: `${publicBaseURL}/.well-known/playpen-host.json`
    },
    appDeepLinks: {
      import: `playpen://import?url=${encodeURIComponent(metadataValue.url)}`,
      configure: `playpen://configure?service=${encodeURIComponent(publicBaseURL)}`
    },
    commands: {
      inspect: `npm run inspect -- ${metadataValue.url} --expect-digest sha256-${digest}`,
      inspectMetadata: `npm run inspect -- ${metadataValue.url} --meta --expect-digest sha256-${digest}`,
      inspectSource: `npm run inspect -- ${metadataValue.url} --source --expect-digest sha256-${digest}`
    }
  };
}

function playgroundList(payloadList, publicBaseURL) {
  return {
    ...payloadList,
    items: payloadList.items.map(payload => metadata(payload, publicBaseURL))
  };
}

function paginationOptions(requestURL) {
  return {
    limit: clampedInteger(requestURL.searchParams.get("limit"), 50, 1, 100),
    offset: clampedInteger(requestURL.searchParams.get("offset"), 0, 0, 100_000)
  };
}

function clampedInteger(rawValue, defaultValue, minimumValue, maximumValue) {
  const parsedValue = Number.parseInt(rawValue || "", 10);
  if (!Number.isFinite(parsedValue)) {
    return defaultValue;
  }
  return Math.min(maximumValue, Math.max(minimumValue, parsedValue));
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

function normalizedAnnotation(payload) {
  if (typeof payload.annotation !== "string") {
    return undefined;
  }
  const annotation = payload.annotation.trim();
  return annotation || undefined;
}

function strongETag(digest) {
  return `"sha256-${digest}"`;
}

function isFresh(request, etag) {
  const ifNoneMatch = request.headers["if-none-match"];
  if (typeof ifNoneMatch !== "string") {
    return false;
  }
  return ifNoneMatch
    .split(",")
    .map(value => value.trim())
    .some(value => value === "*" || value === etag);
}

function sendNotModified(response, etag) {
  response.writeHead(304, {
    ...securityHeaders,
    "cache-control": "no-store",
    "etag": etag
  });
  response.end();
}

function viewURL(playgroundID, publicBaseURL) {
  return `${publicBaseURL}/p/${encodeURIComponent(playgroundID)}`;
}

function viewerInspectionHeaders(payload, publicBaseURL) {
  const recordURL = `${publicBaseURL}/api/playgrounds/${encodeURIComponent(payload.id)}`;
  const metaURL = `${recordURL}/meta`;
  const manifestURL = `${recordURL}/manifest`;
  const sourceURL = `${recordURL}/source`;
  const htmlRenderURL = renderURL(payload, publicBaseURL);
  return {
    "link": [
      linkHeader(recordURL, "alternate", "application/json", "PlayPen record"),
      linkHeader(metaURL, "describedby", "application/json", "PlayPen metadata"),
      linkHeader(manifestURL, "alternate", "application/json", "PlayPen artifact manifest"),
      linkHeader(sourceURL, "alternate", "text/plain", "PlayPen source"),
      ...(htmlRenderURL ? [linkHeader(htmlRenderURL, "alternate", "text/html", "PlayPen HTML render")] : []),
      linkHeader(`${publicBaseURL}/openapi.json`, "service-desc", "application/vnd.oai.openapi+json", "PlayPen OpenAPI"),
      linkHeader(`${publicBaseURL}/.well-known/playpen-host.json`, "service-meta", "application/json", "PlayPen capabilities")
    ].join(", "),
    "x-playpen-record-url": recordURL,
    "x-playpen-meta-url": metaURL,
    "x-playpen-manifest-url": manifestURL,
    ...(htmlRenderURL ? { "x-playpen-render-url": htmlRenderURL } : {}),
    "x-playpen-source-url": sourceURL
  };
}

function linkHeader(url, rel, type, title) {
  return `<${url}>; rel="${rel}"; type="${type}"; title="${title}"`;
}

function capabilities(publicBaseURL) {
  return {
    version: 1,
    name: "PlayPen Hosted Mirror",
    publicBaseURL,
    storage: storage.type,
    maxPayloadBytes,
    publishAuth: {
      required: Boolean(publishToken),
      schemes: ["bearer", "x-playpen-publish-token"]
    },
    cors: {
      publicRead: true,
      allowOrigin: publicReadCORSHeaders["access-control-allow-origin"],
      methods: publicReadCORSMethods,
      exposeHeaders: publicReadCORSHeaders["access-control-expose-headers"].split(", ")
    },
    payload: {
      version: 1,
      kinds: ["markdown", "html"],
      requiredFields: ["version", "title", "kind", "content"],
      optionalFields: ["id", "annotation", "publishedAt"],
      rawContentTypes: ["text/html", "text/markdown", "text/plain"]
    },
    writePolicy: {
      publish: "create",
      replace: "replace",
      createAtomic: true,
      duplicateIDStatus: 409
    },
    errorCodes,
    routes: {
      health: "/api/health",
      capabilities: "/api/capabilities",
      wellKnown: "/.well-known/playpen-host.json",
      openAPI: "/openapi.json",
      wellKnownOpenAPI: "/.well-known/openapi.json",
      stats: "/api/stats",
      list: "/api/playgrounds",
      publish: "/api/playgrounds",
      replace: "/api/playgrounds/{id}",
      read: "/api/playgrounds/{id}",
      delete: "/api/playgrounds/{id}",
      manifest: "/api/playgrounds/{id}/manifest",
      metadata: "/api/playgrounds/{id}/meta",
      render: "/api/playgrounds/{id}/render",
      source: "/api/playgrounds/{id}/source",
      view: "/p/{id}"
    },
    linkFormats: {
      hostedRecord: `${publicBaseURL}/p/{id}`,
      staticFragment: `${publicBaseURL}/#playground={base64url-json}`,
      staticQuery: `${publicBaseURL}/?playground={base64url-json}`
    },
    appDeepLinks: {
      import: "playpen://import?url={hosted-link}",
      configure: "playpen://configure?service={origin}"
    }
  };
}

function configuredBaseURL(value) {
  const trimmedValue = (value || "").trim();
  if (!trimmedValue) {
    return null;
  }
  return normalizeBaseURL(trimmedValue);
}

function publicBaseURLForRequest(request) {
  if (configuredPublicBaseURL) {
    return configuredPublicBaseURL;
  }
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const hostHeader = forwardedHost || firstHeaderValue(request.headers.host);
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedPrefix = normalizedForwardedPrefix(firstHeaderValue(request.headers["x-forwarded-prefix"]));
  const proto = forwardedProto || "http";
  if (!hostHeader) {
    return listenBaseURL;
  }
  return normalizeBaseURL(`${proto}://${hostHeader}${forwardedPrefix}`);
}

function routedRequestURL(request, publicBaseURL) {
  const requestURL = new URL(request.url, publicBaseURL);
  const publicBasePath = new URL(publicBaseURL).pathname.replace(/\/$/, "");
  if (!publicBasePath) {
    return requestURL;
  }
  if (requestURL.pathname === publicBasePath) {
    requestURL.pathname = "/";
    return requestURL;
  }
  if (requestURL.pathname.startsWith(`${publicBasePath}/`)) {
    requestURL.pathname = requestURL.pathname.slice(publicBasePath.length) || "/";
  }
  return requestURL;
}

function normalizedForwardedPrefix(value) {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue === "/") {
    return "";
  }
  return `/${trimmedValue.replace(/^\/+|\/+$/g, "")}`;
}

function firstHeaderValue(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") {
    return "";
  }
  return rawValue.split(",")[0].trim();
}

function normalizeBaseURL(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function hasValidPublishToken(request) {
  if (!publishToken) {
    return true;
  }
  const authorizationToken = bearerToken(request.headers.authorization);
  const headerToken = request.headers["x-playpen-publish-token"];
  return isSameToken(authorizationToken, publishToken) || isSameToken(headerToken, publishToken);
}

function isPublicReadRequest(method, pathname) {
  return (method === "GET" || method === "HEAD") && isPublicReadPath(pathname);
}

function isPublicReadPath(pathname) {
  if (pathname === "/" ||
      pathname === "/api/health" ||
      pathname === "/api/stats" ||
      pathname === "/api/capabilities" ||
      pathname === "/.well-known/playpen-host.json" ||
      pathname === "/openapi.json" ||
      pathname === "/.well-known/openapi.json" ||
      pathname === "/api/playgrounds") {
    return true;
  }
  if (/^\/api\/playgrounds\/[^/]+(?:\/(?:manifest|meta|render|source))?\/?$/.test(pathname)) {
    return true;
  }
  if (/^\/p\/[^/]+\/?$/.test(pathname)) {
    return true;
  }
  if (/^\/p\/(?:app\.js|styles\.css|index\.html)$/.test(pathname)) {
    return true;
  }
  return pathname === "/app.js" || pathname === "/styles.css" || pathname === "/index.html";
}

function setHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
}

function bearerToken(headerValue) {
  if (typeof headerValue !== "string") {
    return "";
  }
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : "";
}

function isSameToken(candidateToken, expectedToken) {
  if (typeof candidateToken !== "string" || !candidateToken) {
    return false;
  }
  const candidateBuffer = Buffer.from(candidateToken);
  const expectedBuffer = Buffer.from(expectedToken);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function sendJSON(response, statusCode, value, isHead = false, headers = {}) {
  response.writeHead(statusCode, {
    ...securityHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  if (isHead) {
    response.end();
    return;
  }
  response.end(JSON.stringify(value));
}

function sendError(response, statusCode, code, message, details = {}, isHead = false, headers = {}) {
  sendJSON(response, statusCode, {
    error: message,
    code,
    ...details
  }, isHead, headers);
}

function sendSource(response, payload, isHead = false, headers = {}) {
  response.writeHead(200, {
    ...securityHeaders,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `inline; filename="${safeFilename(payload)}"`,
    "x-playpen-kind": payload.kind,
    "x-playpen-content-digest": contentDigest(payload),
    ...headers
  });
  if (isHead) {
    response.end();
    return;
  }
  response.end(payload.content);
}

function sendRenderedHTML(response, payload, isHead = false, headers = {}) {
  response.writeHead(200, {
    ...renderedArtifactSecurityHeaders,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-playpen-kind": payload.kind,
    "x-playpen-content-digest": contentDigest(payload),
    ...headers
  });
  if (isHead) {
    response.end();
    return;
  }
  response.end(payload.content);
}

function safeFilename(payload) {
  const extension = payload.kind === "html" ? "html" : "md";
  const slug = payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return `${slug || "playground"}.${extension}`;
}

function sendFile(response, filePath, isHead = false, headers = {}, statusCode = 200) {
  const extension = path.extname(filePath);
  response.writeHead(statusCode, {
    ...securityHeaders,
    "content-type": mimeTypes[extension] || "application/octet-stream",
    "cache-control": extension === ".html" ? "no-store" : "public, max-age=300",
    ...headers
  });
  if (isHead) {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}
