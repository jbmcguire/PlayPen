const crypto = require("crypto");

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

  const result = await verifyHost(options);
  console.log(JSON.stringify(result, null, 2));
}

function parseArguments(args) {
  const options = {
    id: `preflight-${Date.now()}`,
    mode: "api",
    publishToken: defaultPublishToken,
    serviceURL: defaultServiceURL,
    shouldKeepRecord: false,
    shouldShowHelp: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.shouldShowHelp = true;
      continue;
    }
    if (arg === "--id") {
      options.id = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      options.mode = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--keep-record") {
      options.shouldKeepRecord = true;
      continue;
    }
    if (arg === "--service") {
      options.serviceURL = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--static") {
      options.mode = "static";
      continue;
    }
    if (arg === "--token") {
      options.publishToken = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
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

async function verifyHost(options) {
  if (options.mode === "static") {
    return verifyStaticHost(options);
  }
  if (options.mode !== "api") {
    throw new Error("--mode must be api or static");
  }

  const serviceURL = normalizedServiceURL(options.serviceURL);
  const health = await getJSON(new URL("api/health", serviceURL));
  if (!health.ok) {
    throw new Error("Health check did not return ok: true");
  }
  assertPublicHealthDoesNotLeakStorageDetails(health);

  const capabilitiesURL = health.capabilitiesURL || new URL(".well-known/playpen-host.json", serviceURL).href;
  const capabilities = await getJSON(capabilitiesURL);
  assertCapability(capabilities.routes?.openAPI, "/openapi.json", "OpenAPI route");
  assertCapability(capabilities.routes?.wellKnownOpenAPI, "/.well-known/openapi.json", "well-known OpenAPI route");
  assertCapability(capabilities.routes?.list, "/api/playgrounds", "list route");
  assertCapability(capabilities.routes?.publish, "/api/playgrounds", "publish route");
  assertCapability(capabilities.routes?.replace, "/api/playgrounds/{id}", "replace route");
  assertCapability(capabilities.routes?.read, "/api/playgrounds/{id}", "read route");
  assertCapability(capabilities.routes?.delete, "/api/playgrounds/{id}", "delete route");
  assertCapability(capabilities.routes?.manifest, "/api/playgrounds/{id}/manifest", "manifest route");
  assertCapability(capabilities.routes?.metadata, "/api/playgrounds/{id}/meta", "metadata route");
  assertCapability(capabilities.routes?.source, "/api/playgrounds/{id}/source", "source route");
  assertCapability(capabilities.routes?.stats, "/api/stats", "stats route");
  assertPublicReadCORSCapability(capabilities);
  assertRawPublishCapability(capabilities);
  assertWritePolicyCapability(capabilities);

  if (capabilities.publishAuth?.required && !options.publishToken) {
    throw new Error("Host requires a publish token. Pass --token or set PLAYPEN_PUBLISH_TOKEN.");
  }

  const payload = {
    version: 1,
    id: options.id,
    title: "PlayPen Host Preflight",
    kind: "markdown",
    annotation: "Verifier annotation for agent handoff context.",
    content: "# PlayPen Host Preflight\n\nThis record verifies publish, read, source, and viewer routes.",
    publishedAt: new Date().toISOString()
  };
  const publishResult = await publishPayload(serviceURL, payload, options.publishToken);
  const replacedPayload = {
    ...payload,
    title: "PlayPen Host Preflight Updated",
    annotation: "Updated verifier annotation for agent handoff context.",
    content: "# PlayPen Host Preflight Updated\n\nThis record verifies publish, replace, read, source, and viewer routes.",
    publishedAt: new Date().toISOString()
  };
  const replaceResult = await replacePayload(serviceURL, publishResult.id, replacedPayload, options.publishToken);
  const expectedDigest = contentDigest({ ...replacedPayload, id: publishResult.id });
  if (replaceResult.contentDigest !== expectedDigest) {
    throw new Error("Replace digest did not match replacement payload");
  }
  const hostedURL = new URL(publishResult.url, serviceURL);
  const recordURL = new URL(`api/playgrounds/${encodeURIComponent(publishResult.id)}`, serviceURL);
  const metaURL = new URL(`api/playgrounds/${encodeURIComponent(publishResult.id)}/meta`, serviceURL);
  const manifestURL = new URL(`api/playgrounds/${encodeURIComponent(publishResult.id)}/manifest`, serviceURL);
  const sourceURL = new URL(`api/playgrounds/${encodeURIComponent(publishResult.id)}/source`, serviceURL);
  const listURL = new URL("api/playgrounds", serviceURL);
  const statsURL = new URL("api/stats", serviceURL);
  const openAPIURL = new URL("openapi.json", serviceURL);
  let rawPublishReport = null;
  let didDeleteProbeRecord = false;

  try {
    const viewerHead = await assertHead(hostedURL, /text\/html/, "hosted viewer");
    assertViewerInspectionHeaders(viewerHead, { recordURL, metaURL, manifestURL, sourceURL, openAPIURL, digest: expectedDigest }, "hosted viewer");

    const record = await getJSON(recordURL);
    if (record.title !== replacedPayload.title || record.content !== replacedPayload.content || record.annotation !== replacedPayload.annotation) {
      throw new Error("Published record did not round-trip");
    }

    const metadata = await getJSON(metaURL);
    if (metadata.contentDigest !== expectedDigest) {
      throw new Error("Metadata digest did not match published payload");
    }
    if (metadata.annotation !== replacedPayload.annotation) {
      throw new Error("Metadata annotation did not match published payload");
    }

    const manifest = await getJSON(manifestURL);
    if (manifest.type !== "playpen.artifact" || manifest.artifact?.contentDigest !== expectedDigest) {
      throw new Error("Manifest did not describe the published payload");
    }
    if (manifest.links?.source !== sourceURL.href || manifest.links?.openAPI !== openAPIURL.href) {
      throw new Error("Manifest did not expose source and OpenAPI links");
    }
    if (manifest.links?.render) {
      throw new Error("Markdown manifest should not expose a render link");
    }
    if (!String(manifest.commands?.inspect || "").includes(`sha256-${expectedDigest}`)) {
      throw new Error("Manifest did not include a digest-pinned inspect command");
    }

    const sourceHead = await assertHead(sourceURL, /text\/plain/, "source");
    assertPublicReadCORS(sourceHead, "source");
    const sourceETag = sourceHead.headers.get("etag") || "";
    if (sourceETag !== `"sha256-${expectedDigest}"`) {
      throw new Error("Source ETag did not match published payload digest");
    }
    if (sourceHead.headers.get("x-playpen-content-digest") !== expectedDigest) {
      throw new Error("Source digest header did not match published payload");
    }
    await assertPublicReadOptions(sourceURL, "source");
    await assertNotModified(sourceURL, sourceETag, "source");

    const sourceResponse = await fetch(sourceURL);
    if (!sourceResponse.ok) {
      throw new Error(`Source fetch failed: HTTP ${sourceResponse.status}`);
    }
    const source = await sourceResponse.text();
    if (source !== replacedPayload.content) {
      throw new Error("Source body did not match published payload");
    }

    const hostedRecords = await getJSON(listURL);
    if (!Array.isArray(hostedRecords.items) || !hostedRecords.items.some(item => item.id === publishResult.id)) {
      throw new Error("List route did not include the published probe record");
    }
    const listedRecord = hostedRecords.items.find(item => item.id === publishResult.id);
    if (listedRecord.content || listedRecord.contentDigest !== expectedDigest) {
      throw new Error("List route did not return safe probe metadata");
    }

    const viewerResponse = await fetch(hostedURL);
    if (!viewerResponse.ok) {
      throw new Error(`Viewer fetch failed: HTTP ${viewerResponse.status}`);
    }
    const viewerHTML = await viewerResponse.text();
    if (!viewerHTML.includes("PlayPen Hosted Mirror")) {
      throw new Error("Viewer shell did not look like PlayPen Hosted Mirror");
    }

    const stats = await getJSON(statsURL);
    if (!stats.ok || stats.recordCount < 1) {
      throw new Error("Stats did not report the published probe record");
    }
    const openAPI = await getJSON(openAPIURL);
    if (openAPI.openapi !== "3.1.0" || !openAPI.paths?.["/api/playgrounds"] || !openAPI.paths?.["/api/playgrounds/{id}/manifest"]) {
      throw new Error("OpenAPI document did not include required PlayPen routes");
    }
    rawPublishReport = await verifyRawPublishing(serviceURL, options);
  } finally {
    if (!options.shouldKeepRecord) {
      didDeleteProbeRecord = await deleteRecord(recordURL, options.publishToken);
    }
  }

  return {
    ok: true,
    mode: "api",
    serviceURL: serviceURL.href,
    publicBaseURL: health.publicBaseURL,
    storage: health.storage,
    publishAuthRequired: Boolean(health.publishAuthRequired || capabilities.publishAuth?.required),
    hostedURL: hostedURL.href,
    recordURL: recordURL.href,
    metaURL: metaURL.href,
    manifestURL: manifestURL.href,
    sourceURL: sourceURL.href,
    listURL: listURL.href,
    statsURL: statsURL.href,
    openAPIURL: openAPIURL.href,
    cors: {
      publicRead: true
    },
    rawPublish: rawPublishReport,
    contentDigest: expectedDigest,
    replaceDigest: replaceResult.contentDigest,
    cleanup: {
      attempted: !options.shouldKeepRecord,
      deleted: didDeleteProbeRecord
    }
  };
}

async function verifyStaticHost(options) {
  const serviceURL = normalizedServiceURL(options.serviceURL);
  const payload = {
    version: 1,
    id: options.id,
    title: "PlayPen Static Preflight",
    kind: "markdown",
    content: "# PlayPen Static Preflight\n\nThis fragment verifies static PlayPen mirror links.",
    publishedAt: new Date().toISOString()
  };
  const shellResponse = await fetch(serviceURL);
  if (!shellResponse.ok) {
    throw new Error(`Static viewer fetch failed: HTTP ${shellResponse.status}`);
  }
  const shellHTML = await shellResponse.text();
  if (!shellHTML.includes("PlayPen Hosted Mirror") || !shellHTML.includes("app.js")) {
    throw new Error("Static viewer shell did not look like PlayPen Hosted Mirror");
  }

  await assertHead(new URL("app.js", serviceURL), /javascript/, "static app script");
  await assertHead(new URL("styles.css", serviceURL), /text\/css/, "static stylesheet");

  const hostedURL = new URL(serviceURL.href);
  hostedURL.hash = `playground=${encodePayload(payload)}`;

  return {
    ok: true,
    mode: "static",
    serviceURL: serviceURL.href,
    hostedURL: hostedURL.href,
    contentDigest: contentDigest(payload)
  };
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

async function publishPayload(serviceURL, payload, publishToken) {
  const headers = {
    "accept": "application/json",
    "content-type": "application/json"
  };
  if (publishToken) {
    headers.authorization = `Bearer ${publishToken}`;
  }
  const response = await fetch(new URL("api/playgrounds", serviceURL), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Publish failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function verifyRawPublishing(serviceURL, options) {
  const rawRecordID = rawRecordIDFor(options.id);
  const rawRecordURL = new URL(`api/playgrounds/${encodeURIComponent(rawRecordID)}`, serviceURL);
  let rawPublishReport = null;
  let didCreateRawRecord = false;
  let didDeleteRawRecord = false;
  try {
    const htmlContent = "<!doctype html><h1>PlayPen raw publish preflight</h1>";
    const publishResult = await publishRawPayload(serviceURL, {
      id: rawRecordID,
      title: "PlayPen Raw Publish Preflight",
      annotation: "Raw publish verifier annotation.",
      contentType: "text/html",
      content: htmlContent
    }, options.publishToken);
    if (publishResult.id !== rawRecordID) {
      throw new Error("Raw publish did not preserve requested id");
    }
    const expectedRawRenderURL = new URL(`api/playgrounds/${encodeURIComponent(rawRecordID)}/render`, serviceURL);
    const rawRenderURL = new URL(publishResult.renderURL || "", serviceURL);
    if (rawRenderURL.href !== expectedRawRenderURL.href) {
      throw new Error("Raw HTML publish did not advertise a render URL");
    }
    const rawViewerHead = await assertHead(new URL(publishResult.url, serviceURL), /text\/html/, "raw HTML hosted viewer");
    if (rawViewerHead.headers.get("x-playpen-render-url") !== rawRenderURL.href) {
      throw new Error("Raw HTML hosted viewer did not expose render URL header");
    }
    if (!(rawViewerHead.headers.get("link") || "").includes(rawRenderURL.href)) {
      throw new Error("Raw HTML hosted viewer did not expose render Link header");
    }
    didCreateRawRecord = true;
    const rawRecord = await getJSON(rawRecordURL);
    if (rawRecord.kind !== "html" || rawRecord.content !== htmlContent || rawRecord.annotation !== "Raw publish verifier annotation.") {
      throw new Error("Raw HTML publish did not round-trip");
    }
    const rawMetadata = await getJSON(new URL(`api/playgrounds/${encodeURIComponent(rawRecordID)}/meta`, serviceURL));
    if (rawMetadata.renderURL !== rawRenderURL.href) {
      throw new Error("Raw HTML metadata did not expose render URL");
    }
    const rawManifest = await getJSON(new URL(`api/playgrounds/${encodeURIComponent(rawRecordID)}/manifest`, serviceURL));
    if (rawManifest.links?.render !== rawRenderURL.href || rawManifest.artifact?.renderURL !== rawRenderURL.href) {
      throw new Error("Raw HTML manifest did not expose render URL");
    }
    const rawRenderResponse = await fetch(rawRenderURL);
    if (!rawRenderResponse.ok || !String(rawRenderResponse.headers.get("content-type") || "").includes("text/html")) {
      throw new Error(`Raw HTML render fetch failed: HTTP ${rawRenderResponse.status}`);
    }
    if (await rawRenderResponse.text() !== htmlContent) {
      throw new Error("Raw HTML render body did not match published content");
    }
    await assertDuplicateRawPublishRejected(serviceURL, {
      id: rawRecordID,
      title: "PlayPen Raw Publish Preflight",
      contentType: "text/html",
      content: "<!doctype html><h1>Accidental overwrite</h1>"
    }, options.publishToken);

    const markdownContent = "# PlayPen raw replace preflight";
    const replaceResult = await replaceRawPayload(serviceURL, rawRecordID, {
      title: "PlayPen Raw Replace Preflight",
      kind: "markdown",
      annotation: "Raw replace verifier annotation.",
      contentType: "text/plain",
      content: markdownContent
    }, options.publishToken);
    if (replaceResult.renderURL) {
      throw new Error("Raw Markdown replace should not advertise a render URL");
    }
    const replacedRecord = await getJSON(rawRecordURL);
    if (replacedRecord.kind !== "markdown" || replacedRecord.content !== markdownContent || replacedRecord.annotation !== "Raw replace verifier annotation.") {
      throw new Error("Raw Markdown replace did not round-trip");
    }

    rawPublishReport = {
      ok: true,
      id: rawRecordID,
      hostedURL: new URL(publishResult.url, serviceURL).href,
      renderURL: rawRenderURL.href,
      duplicatePublishRejected: true,
      replaceDigest: replaceResult.contentDigest,
      cleanup: {
        attempted: !options.shouldKeepRecord,
        deleted: false
      }
    };
  } finally {
    if (didCreateRawRecord && !options.shouldKeepRecord) {
      didDeleteRawRecord = await deleteRecord(rawRecordURL, options.publishToken);
    }
  }
  rawPublishReport.cleanup.deleted = didDeleteRawRecord;
  return rawPublishReport;
}

async function publishRawPayload(serviceURL, payload, publishToken) {
  const publishURL = new URL("api/playgrounds", serviceURL);
  publishURL.searchParams.set("id", payload.id);
  publishURL.searchParams.set("title", payload.title);
  if (payload.annotation) {
    publishURL.searchParams.set("annotation", payload.annotation);
  }
  return sendRawPayload(publishURL, "POST", payload, publishToken);
}

async function replaceRawPayload(serviceURL, recordID, payload, publishToken) {
  const replaceURL = new URL(`api/playgrounds/${encodeURIComponent(recordID)}`, serviceURL);
  replaceURL.searchParams.set("title", payload.title);
  replaceURL.searchParams.set("kind", payload.kind);
  if (payload.annotation) {
    replaceURL.searchParams.set("annotation", payload.annotation);
  }
  return sendRawPayload(replaceURL, "PUT", payload, publishToken);
}

async function assertDuplicateRawPublishRejected(serviceURL, payload, publishToken) {
  const publishURL = new URL("api/playgrounds", serviceURL);
  publishURL.searchParams.set("id", payload.id);
  publishURL.searchParams.set("title", payload.title);
  const headers = {
    "accept": "application/json",
    "content-type": payload.contentType
  };
  if (publishToken) {
    headers.authorization = `Bearer ${publishToken}`;
  }
  const response = await fetch(publishURL, {
    method: "POST",
    headers,
    body: payload.content
  });
  if (response.status !== 409) {
    throw new Error(`Duplicate raw publish returned HTTP ${response.status}, expected 409`);
  }
}

async function sendRawPayload(url, method, payload, publishToken) {
  const headers = {
    "accept": "application/json",
    "content-type": payload.contentType
  };
  if (publishToken) {
    headers.authorization = `Bearer ${publishToken}`;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: payload.content
  });
  if (!response.ok) {
    throw new Error(`Raw ${method} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function replacePayload(serviceURL, recordID, payload, publishToken) {
  const headers = {
    "accept": "application/json",
    "content-type": "application/json"
  };
  if (publishToken) {
    headers.authorization = `Bearer ${publishToken}`;
  }
  const response = await fetch(new URL(`api/playgrounds/${encodeURIComponent(recordID)}`, serviceURL), {
    method: "PUT",
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Replace failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function deleteRecord(recordURL, publishToken) {
  const headers = { "accept": "application/json" };
  if (publishToken) {
    headers.authorization = `Bearer ${publishToken}`;
  }
  const response = await fetch(recordURL, {
    method: "DELETE",
    headers
  });
  if (!response.ok) {
    throw new Error(`Cleanup failed: HTTP ${response.status}`);
  }
  return true;
}

async function assertHead(url, contentTypePattern, label) {
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`${label} HEAD failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentTypePattern.test(contentType)) {
    throw new Error(`${label} content-type mismatch: ${contentType}`);
  }
  return response;
}

function assertCapability(actualValue, expectedValue, label) {
  if (actualValue !== expectedValue) {
    throw new Error(`Capability ${label} mismatch: ${actualValue}`);
  }
}

function assertPublicReadCORSCapability(capabilities) {
  if (capabilities.cors?.publicRead !== true) {
    throw new Error("Capability CORS publicRead was not advertised");
  }
  if (capabilities.cors?.allowOrigin !== "*") {
    throw new Error("Capability CORS allowOrigin did not permit public reads");
  }
  if (!Array.isArray(capabilities.cors?.methods) || !capabilities.cors.methods.includes("GET") || capabilities.cors.methods.includes("POST")) {
    throw new Error("Capability CORS methods were not read-only");
  }
}

function assertRawPublishCapability(capabilities) {
  const rawContentTypes = capabilities.payload?.rawContentTypes || [];
  for (const contentType of ["text/html", "text/markdown", "text/plain"]) {
    if (!rawContentTypes.includes(contentType)) {
      throw new Error(`Capability raw publish content type missing: ${contentType}`);
    }
  }
}

function assertWritePolicyCapability(capabilities) {
  if (capabilities.writePolicy?.publish !== "create" ||
      capabilities.writePolicy?.replace !== "replace" ||
      capabilities.writePolicy?.createAtomic !== true ||
      capabilities.writePolicy?.duplicateIDStatus !== 409) {
    throw new Error("Capability write policy did not advertise create-only publish and replace semantics");
  }
}

function assertPublicHealthDoesNotLeakStorageDetails(health) {
  const leakedField = [
    "storeDirectory",
    "bucket",
    "endpoint",
    "recordPrefix",
    "accessKeyID",
    "secretAccessKey",
    "sessionToken"
  ].find(fieldName => Object.prototype.hasOwnProperty.call(health, fieldName));
  if (leakedField) {
    throw new Error(`Health response exposed storage detail: ${leakedField}`);
  }
}

function rawRecordIDFor(recordID) {
  const sanitizedID = String(recordID).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  return `${sanitizedID || "preflight"}-raw`;
}

function assertPublicReadCORS(response, label) {
  if (response.headers.get("access-control-allow-origin") !== "*") {
    throw new Error(`${label} did not expose public read CORS`);
  }
  const exposedHeaders = response.headers.get("access-control-expose-headers") || "";
  if (!exposedHeaders.includes("x-playpen-content-digest")) {
    throw new Error(`${label} did not expose digest headers for browser agents`);
  }
}

function assertViewerInspectionHeaders(response, urls, label) {
  if (response.headers.get("x-playpen-record-url") !== urls.recordURL.href) {
    throw new Error(`${label} did not expose record URL`);
  }
  if (response.headers.get("x-playpen-meta-url") !== urls.metaURL.href) {
    throw new Error(`${label} did not expose metadata URL`);
  }
  if (response.headers.get("x-playpen-manifest-url") !== urls.manifestURL.href) {
    throw new Error(`${label} did not expose manifest URL`);
  }
  if (response.headers.get("x-playpen-source-url") !== urls.sourceURL.href) {
    throw new Error(`${label} did not expose source URL`);
  }
  if (response.headers.get("x-playpen-render-url")) {
    throw new Error(`${label} should not expose render URL for Markdown`);
  }
  if (response.headers.get("x-playpen-content-digest") !== urls.digest) {
    throw new Error(`${label} did not expose content digest`);
  }
  if (response.headers.get("etag") !== `"sha256-${urls.digest}"`) {
    throw new Error(`${label} did not expose digest ETag`);
  }
  const linkHeaderValue = response.headers.get("link") || "";
  if (!linkHeaderValue.includes(urls.recordURL.href) ||
      !linkHeaderValue.includes(urls.metaURL.href) ||
      !linkHeaderValue.includes(urls.manifestURL.href) ||
      !linkHeaderValue.includes(urls.sourceURL.href) ||
      !linkHeaderValue.includes(urls.openAPIURL.href)) {
    throw new Error(`${label} did not expose complete Link discovery headers`);
  }
}

async function assertPublicReadOptions(url, label) {
  const response = await fetch(url, {
    method: "OPTIONS",
    headers: { "access-control-request-method": "GET" }
  });
  if (response.status !== 204) {
    throw new Error(`${label} OPTIONS returned HTTP ${response.status}`);
  }
  if (response.headers.get("access-control-allow-origin") !== "*") {
    throw new Error(`${label} OPTIONS did not expose public read CORS`);
  }
  const allowedMethods = response.headers.get("access-control-allow-methods") || "";
  if (!allowedMethods.includes("GET") || !allowedMethods.includes("HEAD") || allowedMethods.includes("POST")) {
    throw new Error(`${label} OPTIONS did not stay read-only: ${allowedMethods}`);
  }
}

async function assertNotModified(url, etag, label) {
  const response = await fetch(url, {
    headers: { "if-none-match": etag }
  });
  if (response.status !== 304) {
    throw new Error(`${label} conditional GET returned HTTP ${response.status}`);
  }
}

function normalizedServiceURL(serviceURLString) {
  const serviceURL = new URL(serviceURLString);
  serviceURL.search = "";
  serviceURL.hash = "";
  const lastPathSegment = serviceURL.pathname.split("/").filter(Boolean).pop() || "";
  if (lastPathSegment.includes(".")) {
    serviceURL.pathname = serviceURL.pathname.slice(0, -lastPathSegment.length);
  }
  if (!serviceURL.pathname.endsWith("/")) {
    serviceURL.pathname += "/";
  }
  return serviceURL;
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

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function printHelp() {
  console.log([
    "Usage: npm run verify -- [--service URL] [--token TOKEN] [--id ID] [--mode api|static]",
    "",
    "API mode publishes a preflight record, then checks health, capabilities,",
    "hosted viewer, record JSON, manifest, metadata, list, and source routes,",
    "then deletes the probe record unless --keep-record is supplied.",
    "Static mode checks the viewer shell/assets and prints a #playground= link."
  ].join("\n"));
}
