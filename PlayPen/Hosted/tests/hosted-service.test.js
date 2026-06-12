const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const hostedRoot = path.resolve(__dirname, "..");
const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playpen-hosted-test-"));
const port = 5100 + Math.floor(Math.random() * 1000);
const baseURL = `http://127.0.0.1:${port}`;
const serverProcess = spawn(process.execPath, ["server.js"], {
  cwd: hostedRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    PLAYPEN_STORE_DIR: storeDirectory,
    PLAYPEN_PUBLIC_BASE_URL: baseURL
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
serverProcess.stdout.on("data", chunk => {
  serverOutput += chunk.toString();
});
serverProcess.stderr.on("data", chunk => {
  serverOutput += chunk.toString();
});

process.on("exit", () => {
  serverProcess.kill();
  fs.rmSync(storeDirectory, { force: true, recursive: true });
});

(async () => {
  await waitForServer();

  const healthResponse = await fetch(`${baseURL}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.match(healthResponse.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), "*");
  assert.equal(healthResponse.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(healthResponse.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.storage, "filesystem");
  assert.equal(healthPayload.storeDirectory, undefined);
  assert.equal(healthPayload.bucket, undefined);
  assert.equal(healthPayload.endpoint, undefined);
  assert.equal(healthPayload.recordPrefix, undefined);
  assert.equal(healthPayload.capabilitiesURL, `${baseURL}/.well-known/playpen-host.json`);
  assert.equal(healthPayload.maxPayloadBytes, 2_000_000);
  assert.equal(healthPayload.publishAuthRequired, false);
  assert.equal(healthPayload.publicBaseURLSource, "env");

  const capabilitiesResponse = await fetch(`${baseURL}/.well-known/playpen-host.json`);
  assert.equal(capabilitiesResponse.status, 200);
  const capabilitiesPayload = await capabilitiesResponse.json();
  assert.equal(capabilitiesPayload.version, 1);
  assert.equal(capabilitiesPayload.publicBaseURL, baseURL);
  assert.equal(capabilitiesPayload.routes.openAPI, "/openapi.json");
  assert.equal(capabilitiesPayload.routes.wellKnownOpenAPI, "/.well-known/openapi.json");
  assert.equal(capabilitiesPayload.routes.stats, "/api/stats");
  assert.equal(capabilitiesPayload.routes.list, "/api/playgrounds");
  assert.equal(capabilitiesPayload.routes.publish, "/api/playgrounds");
  assert.equal(capabilitiesPayload.routes.replace, "/api/playgrounds/{id}");
  assert.equal(capabilitiesPayload.routes.delete, "/api/playgrounds/{id}");
  assert.equal(capabilitiesPayload.routes.manifest, "/api/playgrounds/{id}/manifest");
  assert.equal(capabilitiesPayload.routes.metadata, "/api/playgrounds/{id}/meta");
  assert.equal(capabilitiesPayload.routes.render, "/api/playgrounds/{id}/render");
  assert.equal(capabilitiesPayload.routes.source, "/api/playgrounds/{id}/source");
  assert.equal(capabilitiesPayload.publishAuth.required, false);
  assert.equal(capabilitiesPayload.cors.publicRead, true);
  assert.equal(capabilitiesPayload.cors.allowOrigin, "*");
  assert.deepEqual(capabilitiesPayload.cors.methods, ["GET", "HEAD", "OPTIONS"]);
  assert.deepEqual(capabilitiesPayload.cors.exposeHeaders, ["content-disposition", "content-type", "etag", "link", "x-playpen-content-digest", "x-playpen-kind", "x-playpen-manifest-url", "x-playpen-meta-url", "x-playpen-record-url", "x-playpen-render-url", "x-playpen-source-url"]);
  assert.deepEqual(capabilitiesPayload.payload.kinds, ["markdown", "html"]);
  assert.ok(capabilitiesPayload.payload.optionalFields.includes("annotation"));
  assert.deepEqual(capabilitiesPayload.payload.rawContentTypes, ["text/html", "text/markdown", "text/plain"]);
  assert.equal(capabilitiesPayload.writePolicy.publish, "create");
  assert.equal(capabilitiesPayload.writePolicy.replace, "replace");
  assert.equal(capabilitiesPayload.writePolicy.createAtomic, true);
  assert.equal(capabilitiesPayload.writePolicy.duplicateIDStatus, 409);
  assert.deepEqual(capabilitiesPayload.errorCodes, [
    "forbidden",
    "internal_error",
    "invalid_payload",
    "method_not_allowed",
    "not_found",
    "payload_too_large",
    "playground_conflict",
    "playground_not_found",
    "publish_token_required"
  ]);

  const apiCapabilitiesResponse = await fetch(`${baseURL}/api/capabilities`);
  assert.equal(apiCapabilitiesResponse.status, 200);
  const apiCapabilitiesPayload = await apiCapabilitiesResponse.json();
  assert.equal(apiCapabilitiesPayload.routes.wellKnown, "/.well-known/playpen-host.json");

  const openAPIResponse = await fetch(`${baseURL}/openapi.json`);
  assert.equal(openAPIResponse.status, 200);
  const openAPIPayload = await openAPIResponse.json();
  assert.equal(openAPIPayload.openapi, "3.1.0");
  assert.equal(openAPIPayload.info.title, "PlayPen Hosted Mirror API");
  assert.ok(openAPIPayload.paths["/api/playgrounds"]);
  assert.ok(openAPIPayload.paths["/api/playgrounds"].post.responses["409"]);
  assert.ok(openAPIPayload.paths["/api/playgrounds/{id}/render"]);
  assert.ok(openAPIPayload.paths["/api/stats"]);
  assert.ok(openAPIPayload.paths["/p/{id}"]);
  assert.ok(openAPIPayload.components.schemas.Capabilities.required.includes("errorCodes"));
  assert.deepEqual(openAPIPayload.components.schemas.Error.properties.code.enum, capabilitiesPayload.errorCodes);

  const wellKnownOpenAPIResponse = await fetch(`${baseURL}/.well-known/openapi.json`);
  assert.equal(wellKnownOpenAPIResponse.status, 200);
  const wellKnownOpenAPIPayload = await wellKnownOpenAPIResponse.json();
  assert.equal(wellKnownOpenAPIPayload.openapi, "3.1.0");

  const emptyStatsResponse = await fetch(`${baseURL}/api/stats`);
  assert.equal(emptyStatsResponse.status, 200);
  const emptyStatsPayload = await emptyStatsResponse.json();
  assert.equal(emptyStatsPayload.ok, true);
  assert.equal(emptyStatsPayload.recordCount, 0);
  assert.equal(emptyStatsPayload.storageBytes, 0);
  assert.deepEqual(emptyStatsPayload.kindCounts, { html: 0, markdown: 0 });

  const emptyListResponse = await fetch(`${baseURL}/api/playgrounds`);
  assert.equal(emptyListResponse.status, 200);
  const emptyListPayload = await emptyListResponse.json();
  assert.equal(emptyListPayload.ok, true);
  assert.equal(emptyListPayload.storage, "filesystem");
  assert.equal(emptyListPayload.total, 0);
  assert.equal(emptyListPayload.count, 0);
  assert.equal(emptyListPayload.limit, 50);
  assert.equal(emptyListPayload.offset, 0);
  assert.deepEqual(emptyListPayload.items, []);

  const payload = {
    version: 1,
    id: "contract-test-record",
    title: "Contract Test",
    kind: "markdown",
    annotation: "  Contract annotation  ",
    content: "# Contract Test\n\nHosted records round-trip.",
    publishedAt: new Date().toISOString()
  };

  const publishResponse = await fetch(`${baseURL}/api/playgrounds`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  assert.equal(publishResponse.status, 201);
  const publishResult = await publishResponse.json();
  assert.equal(publishResult.id, payload.id);
  assert.equal(publishResult.url, `${baseURL}/p/${payload.id}`);
  assert.equal(publishResult.metaURL, `${baseURL}/api/playgrounds/${payload.id}/meta`);
  assert.equal(publishResult.manifestURL, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(publishResult.recordURL, `${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(publishResult.sourceURL, `${baseURL}/api/playgrounds/${payload.id}/source`);
  assert.equal(publishResult.renderURL, undefined);
  assert.equal(publishResult.annotation, "Contract annotation");
  assert.equal(publishResult.contentDigest.length, 64);
  assert.equal(publishResponse.headers.get("access-control-allow-origin"), null);

  const duplicatePublishResponse = await fetch(`${baseURL}/api/playgrounds`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ...payload,
      title: "Accidental overwrite"
    })
  });
  assert.equal(duplicatePublishResponse.status, 409);
  const duplicatePublishPayload = await duplicatePublishResponse.json();
  assert.equal(duplicatePublishPayload.error, "Playground already exists");
  assert.equal(duplicatePublishPayload.code, "playground_conflict");
  assert.equal(duplicatePublishPayload.id, payload.id);
  assert.equal(duplicatePublishPayload.replaceURL, `${baseURL}/api/playgrounds/${payload.id}`);

  const rawHTMLContent = "<!doctype html><h1>Raw HTML Publish</h1>";
  const rawPublishResponse = await fetch(`${baseURL}/api/playgrounds?id=raw-html-record&title=Raw%20HTML%20Record&annotation=Raw%20annotation`, {
    method: "POST",
    headers: { "content-type": "text/html" },
    body: rawHTMLContent
  });
  assert.equal(rawPublishResponse.status, 201);
  const rawPublishResult = await rawPublishResponse.json();
  assert.equal(rawPublishResult.id, "raw-html-record");
  assert.equal(rawPublishResult.url, `${baseURL}/p/raw-html-record`);
  assert.equal(rawPublishResult.annotation, "Raw annotation");
  assert.equal(rawPublishResult.renderURL, `${baseURL}/api/playgrounds/raw-html-record/render`);
  const rawShortLinkHeadResponse = await fetch(rawPublishResult.url, { method: "HEAD" });
  assert.equal(rawShortLinkHeadResponse.status, 200);
  assert.equal(rawShortLinkHeadResponse.headers.get("x-playpen-render-url"), `${baseURL}/api/playgrounds/raw-html-record/render`);
  assert.match(rawShortLinkHeadResponse.headers.get("access-control-expose-headers"), /x-playpen-render-url/);
  assert.ok((rawShortLinkHeadResponse.headers.get("link") || "").includes(`${baseURL}/api/playgrounds/raw-html-record/render`));
  const rawFetchResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record`);
  assert.equal(rawFetchResponse.status, 200);
  const rawPayload = await rawFetchResponse.json();
  assert.equal(rawPayload.title, "Raw HTML Record");
  assert.equal(rawPayload.kind, "html");
  assert.equal(rawPayload.annotation, "Raw annotation");
  assert.equal(rawPayload.content, rawHTMLContent);
  assert.equal(rawPayload.renderURL, undefined);
  const rawMetaResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record/meta`);
  assert.equal(rawMetaResponse.status, 200);
  const rawMetaPayload = await rawMetaResponse.json();
  assert.equal(rawMetaPayload.renderURL, `${baseURL}/api/playgrounds/raw-html-record/render`);
  const rawManifestResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record/manifest`);
  assert.equal(rawManifestResponse.status, 200);
  const rawManifestPayload = await rawManifestResponse.json();
  assert.equal(rawManifestPayload.artifact.renderURL, `${baseURL}/api/playgrounds/raw-html-record/render`);
  assert.equal(rawManifestPayload.links.render, `${baseURL}/api/playgrounds/raw-html-record/render`);
  const rawRenderResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record/render`);
  assert.equal(rawRenderResponse.status, 200);
  assert.match(rawRenderResponse.headers.get("content-type"), /text\/html/);
  assert.match(rawRenderResponse.headers.get("content-security-policy"), /sandbox allow-scripts/);
  assert.doesNotMatch(rawRenderResponse.headers.get("content-security-policy"), /allow-same-origin/);
  assert.equal(rawRenderResponse.headers.get("x-playpen-kind"), "html");
  assert.equal(await rawRenderResponse.text(), rawHTMLContent);
  const duplicateRawPublishResponse = await fetch(`${baseURL}/api/playgrounds?id=raw-html-record&title=Raw%20HTML%20Record`, {
    method: "POST",
    headers: { "content-type": "text/html" },
    body: "<!doctype html><h1>Accidental raw overwrite</h1>"
  });
  assert.equal(duplicateRawPublishResponse.status, 409);
  const duplicateRawPublishPayload = await duplicateRawPublishResponse.json();
  assert.equal(duplicateRawPublishPayload.code, "playground_conflict");

  const rawReplaceResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record?title=Raw%20Markdown%20Record&kind=markdown&annotation=Raw%20replacement%20annotation`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: "# Raw Markdown Replace"
  });
  assert.equal(rawReplaceResponse.status, 200);
  const rawReplaceResult = await rawReplaceResponse.json();
  assert.equal(rawReplaceResult.id, "raw-html-record");
  assert.equal(rawReplaceResult.annotation, "Raw replacement annotation");
  assert.equal(rawReplaceResult.renderURL, undefined);
  assert.notEqual(rawReplaceResult.contentDigest, rawPublishResult.contentDigest);
  const rawReplacedFetchResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record`);
  assert.equal(rawReplacedFetchResponse.status, 200);
  const rawReplacedPayload = await rawReplacedFetchResponse.json();
  assert.equal(rawReplacedPayload.title, "Raw Markdown Record");
  assert.equal(rawReplacedPayload.kind, "markdown");
  assert.equal(rawReplacedPayload.annotation, "Raw replacement annotation");
  assert.equal(rawReplacedPayload.content, "# Raw Markdown Replace");
  const rawDeleteResponse = await fetch(`${baseURL}/api/playgrounds/raw-html-record`, { method: "DELETE" });
  assert.equal(rawDeleteResponse.status, 200);

  const largePublishResponse = await fetch(`${baseURL}/api/playgrounds`, {
    method: "POST",
    headers: { "content-type": "text/markdown" },
    body: "x".repeat(2_000_001)
  });
  assert.equal(largePublishResponse.status, 413);
  const largePublishPayload = await largePublishResponse.json();
  assert.equal(largePublishPayload.error, "Payload too large");
  assert.equal(largePublishPayload.code, "payload_too_large");
  assert.equal(largePublishPayload.maxPayloadBytes, 2_000_000);

  const publishedStatsResponse = await fetch(`${baseURL}/api/stats`);
  assert.equal(publishedStatsResponse.status, 200);
  const publishedStatsPayload = await publishedStatsResponse.json();
  assert.equal(publishedStatsPayload.recordCount, 1);
  assert.equal(publishedStatsPayload.kindCounts.markdown, 1);
  assert.equal(publishedStatsPayload.kindCounts.html, 0);
  assert.ok(publishedStatsPayload.storageBytes > 0);
  assert.equal(publishedStatsPayload.oldestPublishedAt, payload.publishedAt);
  assert.equal(publishedStatsPayload.newestPublishedAt, payload.publishedAt);

  const publishedListResponse = await fetch(`${baseURL}/api/playgrounds?limit=5&offset=0`);
  assert.equal(publishedListResponse.status, 200);
  const publishedListPayload = await publishedListResponse.json();
  assert.equal(publishedListPayload.total, 1);
  assert.equal(publishedListPayload.count, 1);
  assert.equal(publishedListPayload.items[0].id, payload.id);
  assert.equal(publishedListPayload.items[0].title, payload.title);
  assert.equal(publishedListPayload.items[0].kind, payload.kind);
  assert.equal(publishedListPayload.items[0].annotation, "Contract annotation");
  assert.equal(publishedListPayload.items[0].url, `${baseURL}/p/${payload.id}`);
  assert.equal(publishedListPayload.items[0].recordURL, `${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(publishedListPayload.items[0].manifestURL, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(publishedListPayload.items[0].contentDigest, publishResult.contentDigest);
  assert.equal(publishedListPayload.items[0].content, undefined);

  const shortLinkHeadResponse = await fetch(publishResult.url, { method: "HEAD" });
  assert.equal(shortLinkHeadResponse.status, 200);
  assert.match(shortLinkHeadResponse.headers.get("content-type"), /text\/html/);
  assert.match(shortLinkHeadResponse.headers.get("content-security-policy"), /object-src 'none'/);
  assert.equal(shortLinkHeadResponse.headers.get("x-playpen-record-url"), `${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(shortLinkHeadResponse.headers.get("x-playpen-meta-url"), `${baseURL}/api/playgrounds/${payload.id}/meta`);
  assert.equal(shortLinkHeadResponse.headers.get("x-playpen-manifest-url"), `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(shortLinkHeadResponse.headers.get("x-playpen-render-url"), null);
  assert.equal(shortLinkHeadResponse.headers.get("x-playpen-source-url"), `${baseURL}/api/playgrounds/${payload.id}/source`);
  assert.equal(shortLinkHeadResponse.headers.get("x-playpen-content-digest"), publishResult.contentDigest);
  assert.equal(shortLinkHeadResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);
  const shortLinkHeader = shortLinkHeadResponse.headers.get("link") || "";
  assert.ok(shortLinkHeader.includes(`${baseURL}/api/playgrounds/${payload.id}`));
  assert.ok(shortLinkHeader.includes(`${baseURL}/api/playgrounds/${payload.id}/meta`));
  assert.ok(shortLinkHeader.includes(`${baseURL}/api/playgrounds/${payload.id}/manifest`));
  assert.ok(shortLinkHeader.includes(`${baseURL}/api/playgrounds/${payload.id}/source`));
  assert.equal(shortLinkHeader.includes(`${baseURL}/api/playgrounds/${payload.id}/render`), false);
  assert.ok(shortLinkHeader.includes(`${baseURL}/openapi.json`));
  assert.match(shortLinkHeadResponse.headers.get("access-control-expose-headers"), /x-playpen-render-url/);
  assert.match(shortLinkHeadResponse.headers.get("access-control-expose-headers"), /x-playpen-source-url/);

  const conditionalShortLinkResponse = await fetch(publishResult.url, {
    headers: { "if-none-match": `"sha256-${publishResult.contentDigest}"` }
  });
  assert.equal(conditionalShortLinkResponse.status, 304);
  assert.equal(conditionalShortLinkResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);

  const fetchResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(fetchResponse.status, 200);
  assert.equal(fetchResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);
  assert.equal(fetchResponse.headers.get("x-playpen-content-digest"), publishResult.contentDigest);
  const fetchedPayload = await fetchResponse.json();
  assert.equal(fetchedPayload.title, payload.title);
  assert.equal(fetchedPayload.annotation, "Contract annotation");
  assert.equal(fetchedPayload.content, payload.content);

  const metaResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/meta`);
  assert.equal(metaResponse.status, 200);
  assert.equal(metaResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);
  const metaPayload = await metaResponse.json();
  assert.equal(metaPayload.title, payload.title);
  assert.equal(metaPayload.kind, payload.kind);
  assert.equal(metaPayload.annotation, "Contract annotation");
  assert.equal(metaPayload.contentBytes, Buffer.byteLength(payload.content, "utf8"));
  assert.equal(metaPayload.manifestURL, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(metaPayload.sourceURL, `${baseURL}/api/playgrounds/${payload.id}/source`);
  assert.equal(metaPayload.renderURL, undefined);
  assert.equal(metaPayload.contentDigest, publishResult.contentDigest);
  const markdownRenderResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/render`);
  assert.equal(markdownRenderResponse.status, 400);
  const markdownRenderPayload = await markdownRenderResponse.json();
  assert.equal(markdownRenderPayload.code, "invalid_payload");

  const manifestResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);
  const manifestPayload = await manifestResponse.json();
  assert.equal(manifestPayload.ok, true);
  assert.equal(manifestPayload.type, "playpen.artifact");
  assert.equal(manifestPayload.artifact.id, payload.id);
  assert.equal(manifestPayload.artifact.contentDigest, publishResult.contentDigest);
  assert.equal(manifestPayload.links.view, `${baseURL}/p/${payload.id}`);
  assert.equal(manifestPayload.links.record, `${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(manifestPayload.links.metadata, `${baseURL}/api/playgrounds/${payload.id}/meta`);
  assert.equal(manifestPayload.links.manifest, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(manifestPayload.links.source, `${baseURL}/api/playgrounds/${payload.id}/source`);
  assert.equal(manifestPayload.links.render, undefined);
  assert.equal(manifestPayload.artifact.renderURL, undefined);
  assert.equal(manifestPayload.links.openAPI, `${baseURL}/openapi.json`);
  assert.match(manifestPayload.commands.inspect, new RegExp(`sha256-${publishResult.contentDigest}`));
  assert.match(manifestPayload.appDeepLinks.import, /^playpen:\/\/import\?url=/);

  const sourceHeadResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/source`, { method: "HEAD" });
  assert.equal(sourceHeadResponse.status, 200);
  assert.match(sourceHeadResponse.headers.get("content-type"), /text\/plain/);
  assert.equal(sourceHeadResponse.headers.get("access-control-allow-origin"), "*");
  assert.match(sourceHeadResponse.headers.get("access-control-expose-headers"), /x-playpen-content-digest/);
  assert.equal(sourceHeadResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(sourceHeadResponse.headers.get("x-playpen-kind"), "markdown");
  assert.equal(sourceHeadResponse.headers.get("x-playpen-content-digest"), publishResult.contentDigest);
  assert.equal(sourceHeadResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);

  const sourceOptionsResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/source`, {
    method: "OPTIONS",
    headers: { "access-control-request-method": "GET" }
  });
  assert.equal(sourceOptionsResponse.status, 204);
  assert.equal(sourceOptionsResponse.headers.get("access-control-allow-origin"), "*");
  assert.equal(sourceOptionsResponse.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
  assert.doesNotMatch(sourceOptionsResponse.headers.get("access-control-allow-methods"), /POST/);

  const sourceResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/source`);
  assert.equal(sourceResponse.status, 200);
  assert.equal(await sourceResponse.text(), payload.content);

  const conditionalSourceResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/source`, {
    headers: { "if-none-match": `"sha256-${publishResult.contentDigest}"` }
  });
  assert.equal(conditionalSourceResponse.status, 304);
  assert.equal(conditionalSourceResponse.headers.get("etag"), `"sha256-${publishResult.contentDigest}"`);

  const replacementPayload = {
    ...payload,
    id: "ignored-client-id",
    title: "Contract Test Updated",
    annotation: "  Contract annotation updated  ",
    content: "# Contract Test Updated\n\nHosted records can be replaced.",
    publishedAt: new Date(Date.now() + 1000).toISOString()
  };
  const replaceResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}`, {
    method: "PUT",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(replacementPayload)
  });
  assert.equal(replaceResponse.status, 200);
  const replaceResult = await replaceResponse.json();
  assert.equal(replaceResult.id, payload.id);
  assert.equal(replaceResult.url, `${baseURL}/p/${payload.id}`);
  assert.equal(replaceResult.annotation, "Contract annotation updated");
  assert.notEqual(replaceResult.contentDigest, publishResult.contentDigest);

  const replacedFetchResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(replacedFetchResponse.status, 200);
  const replacedPayload = await replacedFetchResponse.json();
  assert.equal(replacedPayload.id, payload.id);
  assert.equal(replacedPayload.title, replacementPayload.title);
  assert.equal(replacedPayload.annotation, "Contract annotation updated");
  assert.equal(replacedPayload.content, replacementPayload.content);

  const replacedMetaResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}/meta`);
  assert.equal(replacedMetaResponse.status, 200);
  const replacedMetaPayload = await replacedMetaResponse.json();
  assert.equal(replacedMetaPayload.annotation, "Contract annotation updated");
  assert.equal(replacedMetaPayload.contentDigest, replaceResult.contentDigest);

  const inspectResult = await inspectWithCLI(publishResult.url);
  assert.equal(inspectResult.status, 0, inspectResult.stderr);
  const inspectedArtifact = JSON.parse(inspectResult.stdout);
  assert.equal(inspectedArtifact.ok, true);
  assert.equal(inspectedArtifact.mode, "api");
  assert.equal(inspectedArtifact.id, payload.id);
  assert.equal(inspectedArtifact.title, replacementPayload.title);
  assert.equal(inspectedArtifact.annotation, "Contract annotation updated");
  assert.equal(inspectedArtifact.url, `${baseURL}/p/${payload.id}`);
  assert.equal(inspectedArtifact.recordURL, `${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(inspectedArtifact.metaURL, `${baseURL}/api/playgrounds/${payload.id}/meta`);
  assert.equal(inspectedArtifact.manifestURL, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(inspectedArtifact.sourceURL, `${baseURL}/api/playgrounds/${payload.id}/source`);
  assert.equal(inspectedArtifact.renderURL, undefined);
  assert.equal(inspectedArtifact.contentDigest, replaceResult.contentDigest);
  assert.equal(inspectedArtifact.content, replacementPayload.content);

  const inspectMetaResult = await inspectWithCLI(`${baseURL}/api/playgrounds/${payload.id}/meta`, ["--meta"]);
  assert.equal(inspectMetaResult.status, 0, inspectMetaResult.stderr);
  const inspectedMetadata = JSON.parse(inspectMetaResult.stdout);
  assert.equal(inspectedMetadata.content, undefined);
  assert.equal(inspectedMetadata.title, replacementPayload.title);
  assert.equal(inspectedMetadata.manifestURL, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(inspectedMetadata.renderURL, undefined);
  assert.equal(inspectedMetadata.contentDigest, replaceResult.contentDigest);

  const inspectManifestResult = await inspectWithCLI(`${baseURL}/api/playgrounds/${payload.id}/manifest`, ["--meta"]);
  assert.equal(inspectManifestResult.status, 0, inspectManifestResult.stderr);
  const inspectedManifestMetadata = JSON.parse(inspectManifestResult.stdout);
  assert.equal(inspectedManifestMetadata.title, replacementPayload.title);
  assert.equal(inspectedManifestMetadata.manifestURL, `${baseURL}/api/playgrounds/${payload.id}/manifest`);
  assert.equal(inspectedManifestMetadata.contentDigest, replaceResult.contentDigest);

  const inspectSourceResult = await inspectWithCLI(`${baseURL}/api/playgrounds/${payload.id}/source`, ["--source"]);
  assert.equal(inspectSourceResult.status, 0, inspectSourceResult.stderr);
  assert.equal(inspectSourceResult.stdout, replacementPayload.content);

  const inspectDigestResult = await inspectWithCLI(publishResult.url, ["--expect-digest", `sha256-${replaceResult.contentDigest}`, "--meta"]);
  assert.equal(inspectDigestResult.status, 0, inspectDigestResult.stderr);
  const inspectedDigestMetadata = JSON.parse(inspectDigestResult.stdout);
  assert.equal(inspectedDigestMetadata.contentDigest, replaceResult.contentDigest);

  const inspectMismatchResult = await inspectWithCLI(publishResult.url, ["--expect-digest", "0".repeat(64)]);
  assert.notEqual(inspectMismatchResult.status, 0);
  assert.match(inspectMismatchResult.stderr, /Digest mismatch/);

  const shortLinkResponse = await fetch(publishResult.url);
  assert.equal(shortLinkResponse.status, 200);
  const shortLinkHTML = await shortLinkResponse.text();
  assert.match(shortLinkHTML, /PlayPen Hosted Mirror/);
  assert.match(shortLinkHTML, /publish-token-input/);
  assert.match(shortLinkHTML, /open-in-playpen/);
  assert.match(shortLinkHTML, /configure-playpen/);
  assert.match(shortLinkHTML, /record-json/);
  assert.match(shortLinkHTML, /metadata-link/);
  assert.match(shortLinkHTML, /manifest-link/);
  assert.match(shortLinkHTML, /source-link/);

  const deleteResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);
  const deletedFetchResponse = await fetch(`${baseURL}/api/playgrounds/${payload.id}`);
  assert.equal(deletedFetchResponse.status, 404);
  const deletedStatsResponse = await fetch(`${baseURL}/api/stats`);
  assert.equal(deletedStatsResponse.status, 200);
  const deletedStatsPayload = await deletedStatsResponse.json();
  assert.equal(deletedStatsPayload.recordCount, 0);
  const deletedListResponse = await fetch(`${baseURL}/api/playgrounds`);
  assert.equal(deletedListResponse.status, 200);
  const deletedListPayload = await deletedListResponse.json();
  assert.equal(deletedListPayload.total, 0);
  assert.equal(deletedListPayload.count, 0);

  const cliSourcePath = path.join(storeDirectory, "cli-contract-test.md");
  fs.writeFileSync(cliSourcePath, "# CLI Contract\n\nPublished by an agent.");
  const cliResult = await publishWithCLI(cliSourcePath, baseURL);
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.equal(cliResult.stdout.trim(), `${baseURL}/p/cli-contract-record`);

  const cliFetchResponse = await fetch(`${baseURL}/api/playgrounds/cli-contract-record`);
  assert.equal(cliFetchResponse.status, 200);
  const cliPayload = await cliFetchResponse.json();
  assert.equal(cliPayload.title, "CLI Contract");
  assert.equal(cliPayload.kind, "markdown");
  assert.equal(cliPayload.content, "# CLI Contract\n\nPublished by an agent.");

  const cliDuplicateResult = await publishWithCLI(cliSourcePath, baseURL, "", "cli-contract-record", false);
  assert.notEqual(cliDuplicateResult.status, 0);
  assert.equal(cliDuplicateResult.stdout, "");
  assert.match(cliDuplicateResult.stderr, /Publish failed: HTTP 409: Playground already exists/);
  assert.match(cliDuplicateResult.stderr, /Use --replace with --id cli-contract-record/);

  fs.writeFileSync(cliSourcePath, "# CLI Contract\n\nReplaced by an agent.");
  const cliReplaceResult = await publishWithCLI(cliSourcePath, baseURL, "", "cli-contract-record", true, "Replacement annotation", true);
  assert.equal(cliReplaceResult.status, 0, cliReplaceResult.stderr);
  const cliReplacePayload = JSON.parse(cliReplaceResult.stdout);
  assert.equal(cliReplacePayload.didUseAPI, true);
  assert.equal(cliReplacePayload.url, `${baseURL}/p/cli-contract-record`);
  assert.equal(cliReplacePayload.annotation, "Replacement annotation");
  const cliReplacedFetchResponse = await fetch(`${baseURL}/api/playgrounds/cli-contract-record`);
  assert.equal(cliReplacedFetchResponse.status, 200);
  const cliReplacedPayload = await cliReplacedFetchResponse.json();
  assert.equal(cliReplacedPayload.content, "# CLI Contract\n\nReplaced by an agent.");
  assert.equal(cliReplacedPayload.annotation, "Replacement annotation");

  const cliJSONResult = await publishWithCLI(cliSourcePath, baseURL, "", "cli-json-record", true, "  CLI annotation  ");
  assert.equal(cliJSONResult.status, 0, cliJSONResult.stderr);
  const cliJSONPayload = JSON.parse(cliJSONResult.stdout);
  assert.equal(cliJSONPayload.ok, true);
  assert.equal(cliJSONPayload.didUseAPI, true);
  assert.equal(cliJSONPayload.mode, "api");
  assert.equal(cliJSONPayload.id, "cli-json-record");
  assert.equal(cliJSONPayload.title, "CLI Contract");
  assert.equal(cliJSONPayload.kind, "markdown");
  assert.equal(cliJSONPayload.annotation, "CLI annotation");
  assert.equal(cliJSONPayload.serviceURL, `${baseURL}/`);
  assert.equal(cliJSONPayload.url, `${baseURL}/p/cli-json-record`);
  assert.equal(cliJSONPayload.recordURL, `${baseURL}/api/playgrounds/cli-json-record`);
  assert.equal(cliJSONPayload.metaURL, `${baseURL}/api/playgrounds/cli-json-record/meta`);
  assert.equal(cliJSONPayload.manifestURL, `${baseURL}/api/playgrounds/cli-json-record/manifest`);
  assert.equal(cliJSONPayload.sourceURL, `${baseURL}/api/playgrounds/cli-json-record/source`);
  assert.equal(cliJSONPayload.renderURL, undefined);
  assert.equal(cliJSONPayload.contentDigest.length, 64);

  const cliHTMLPath = path.join(storeDirectory, "cli-contract-test.html");
  fs.writeFileSync(cliHTMLPath, "<!doctype html><h1>CLI HTML Contract</h1>");
  const cliHTMLJSONResult = await publishWithCLI(cliHTMLPath, baseURL, "", "cli-html-record", true);
  assert.equal(cliHTMLJSONResult.status, 0, cliHTMLJSONResult.stderr);
  const cliHTMLJSONPayload = JSON.parse(cliHTMLJSONResult.stdout);
  assert.equal(cliHTMLJSONPayload.kind, "html");
  assert.equal(cliHTMLJSONPayload.url, `${baseURL}/p/cli-html-record`);
  assert.equal(cliHTMLJSONPayload.renderURL, `${baseURL}/api/playgrounds/cli-html-record/render`);
  const inspectHTMLResult = await inspectWithCLI(cliHTMLJSONPayload.url, ["--meta"]);
  assert.equal(inspectHTMLResult.status, 0, inspectHTMLResult.stderr);
  const inspectedHTMLMetadata = JSON.parse(inspectHTMLResult.stdout);
  assert.equal(inspectedHTMLMetadata.kind, "html");
  assert.equal(inspectedHTMLMetadata.renderURL, `${baseURL}/api/playgrounds/cli-html-record/render`);
  const inspectHTMLManifestResult = await inspectWithCLI(`${baseURL}/api/playgrounds/cli-html-record/manifest`, ["--meta"]);
  assert.equal(inspectHTMLManifestResult.status, 0, inspectHTMLManifestResult.stderr);
  const inspectedHTMLManifestMetadata = JSON.parse(inspectHTMLManifestResult.stdout);
  assert.equal(inspectedHTMLManifestMetadata.renderURL, `${baseURL}/api/playgrounds/cli-html-record/render`);
  const inspectHTMLRenderResult = await inspectWithCLI(cliHTMLJSONPayload.renderURL, ["--meta"]);
  assert.equal(inspectHTMLRenderResult.status, 0, inspectHTMLRenderResult.stderr);
  const inspectedHTMLRenderMetadata = JSON.parse(inspectHTMLRenderResult.stdout);
  assert.equal(inspectedHTMLRenderMetadata.url, `${baseURL}/p/cli-html-record`);
  assert.equal(inspectedHTMLRenderMetadata.renderURL, `${baseURL}/api/playgrounds/cli-html-record/render`);

  const fallbackResult = await publishWithCLI(cliSourcePath, "http://127.0.0.1:9");
  assert.equal(fallbackResult.status, 0, fallbackResult.stderr);
  assert.match(fallbackResult.stdout.trim(), /^http:\/\/127\.0\.0\.1:9\/#playground=/);
  assert.match(fallbackResult.stderr, /Used fragment fallback:/);

  const fallbackJSONResult = await publishWithCLI(cliSourcePath, "http://127.0.0.1:9", "", "cli-json-fallback-record", true, "Fallback annotation");
  assert.equal(fallbackJSONResult.status, 0, fallbackJSONResult.stderr);
  assert.equal(fallbackJSONResult.stderr, "");
  const fallbackJSONPayload = JSON.parse(fallbackJSONResult.stdout);
  assert.equal(fallbackJSONPayload.ok, true);
  assert.equal(fallbackJSONPayload.didUseAPI, false);
  assert.equal(fallbackJSONPayload.mode, "static");
  assert.equal(fallbackJSONPayload.id, "cli-json-fallback-record");
  assert.equal(fallbackJSONPayload.title, "CLI Contract");
  assert.equal(fallbackJSONPayload.kind, "markdown");
  assert.equal(fallbackJSONPayload.annotation, "Fallback annotation");
  assert.equal(fallbackJSONPayload.serviceURL, "http://127.0.0.1:9/");
  assert.match(fallbackJSONPayload.reason, /fetch failed|HTTP|connect|ECONNREFUSED/i);
  assert.match(fallbackJSONPayload.url, /^http:\/\/127\.0\.0\.1:9\/#playground=/);
  assert.equal(fallbackJSONPayload.contentDigest.length, 64);

  const fallbackReplaceResult = await publishWithCLI(cliSourcePath, "http://127.0.0.1:9", "", "cli-json-fallback-record", true, "Fallback annotation", true);
  assert.notEqual(fallbackReplaceResult.status, 0);
  assert.match(fallbackReplaceResult.stderr, /Replace failed:/);

  const inspectStaticResult = await inspectWithCLI(fallbackJSONPayload.url);
  assert.equal(inspectStaticResult.status, 0, inspectStaticResult.stderr);
  const inspectedStaticArtifact = JSON.parse(inspectStaticResult.stdout);
  assert.equal(inspectedStaticArtifact.ok, true);
  assert.equal(inspectedStaticArtifact.mode, "static");
  assert.equal(inspectedStaticArtifact.title, "CLI Contract");
  assert.equal(inspectedStaticArtifact.annotation, "Fallback annotation");
  assert.equal(inspectedStaticArtifact.content, "# CLI Contract\n\nReplaced by an agent.");

  const verifyResult = await verifyHost(baseURL, "", "verify-contract-record");
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  const verifyPayload = JSON.parse(verifyResult.stdout);
  assert.equal(verifyPayload.ok, true);
  assert.equal(verifyPayload.hostedURL, `${baseURL}/p/verify-contract-record`);
  assert.equal(verifyPayload.manifestURL, `${baseURL}/api/playgrounds/verify-contract-record/manifest`);
  assert.equal(verifyPayload.listURL, `${baseURL}/api/playgrounds`);
  assert.equal(verifyPayload.statsURL, `${baseURL}/api/stats`);
  assert.equal(verifyPayload.openAPIURL, `${baseURL}/openapi.json`);
  assert.equal(verifyPayload.publishAuthRequired, false);
  assert.equal(verifyPayload.cors.publicRead, true);
  assert.equal(verifyPayload.rawPublish.ok, true);
  assert.equal(verifyPayload.rawPublish.id, "verify-contract-record-raw");
  assert.equal(verifyPayload.rawPublish.renderURL, `${baseURL}/api/playgrounds/verify-contract-record-raw/render`);
  assert.equal(verifyPayload.rawPublish.duplicatePublishRejected, true);
  assert.equal(verifyPayload.rawPublish.cleanup.deleted, true);
  assert.equal(verifyPayload.replaceDigest.length, 64);
  assert.equal(verifyPayload.cleanup.deleted, true);
  const verifyRecordResponse = await fetch(`${baseURL}/api/playgrounds/verify-contract-record`);
  assert.equal(verifyRecordResponse.status, 404);
  const verifyRawRecordResponse = await fetch(`${baseURL}/api/playgrounds/verify-contract-record-raw`);
  assert.equal(verifyRawRecordResponse.status, 404);

  const staticVerifyResult = await verifyHost(baseURL, "", "static-verify-record", "static");
  assert.equal(staticVerifyResult.status, 0, staticVerifyResult.stderr);
  const staticVerifyPayload = JSON.parse(staticVerifyResult.stdout);
  assert.equal(staticVerifyPayload.ok, true);
  assert.equal(staticVerifyPayload.mode, "static");
  assert.match(staticVerifyPayload.hostedURL, new RegExp(`^${baseURL.replace(/\./g, "\\.")}/#playground=`));

  await assertProtectedPublish(cliSourcePath);
  await assertForwardedPublicBaseURL();
  await assertPrefixedPublicBaseURL();

  const routedAssetResponse = await fetch(`${baseURL}/p/app.js`);
  assert.equal(routedAssetResponse.status, 200);
  const routedAssetScript = await routedAssetResponse.text();
  assert.match(routedAssetScript, /payloadFromHostedRecord/);
  assert.match(routedAssetScript, /serviceBaseURL/);
  assert.match(routedAssetScript, /recordEndpointURL/);
  assert.match(routedAssetScript, /headers\.authorization/);

  const invalidPayloadResponse = await fetch(`${baseURL}/api/playgrounds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Nope" })
  });
  assert.equal(invalidPayloadResponse.status, 400);
  const invalidPayload = await invalidPayloadResponse.json();
  assert.equal(invalidPayload.code, "invalid_payload");

  const malformedPayloadResponse = await fetch(`${baseURL}/api/playgrounds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{\"version\":1,"
  });
  assert.equal(malformedPayloadResponse.status, 400);
  const malformedPayload = await malformedPayloadResponse.json();
  assert.equal(malformedPayload.error, "Invalid PlayPen payload");
  assert.equal(malformedPayload.code, "invalid_payload");

  const malformedReplaceResponse = await fetch(`${baseURL}/api/playgrounds/malformed-record`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "{\"version\":1,"
  });
  assert.equal(malformedReplaceResponse.status, 400);
  const malformedReplacePayload = await malformedReplaceResponse.json();
  assert.equal(malformedReplacePayload.code, "invalid_payload");

  const missingRecordResponse = await fetch(`${baseURL}/api/playgrounds/missing-record`);
  assert.equal(missingRecordResponse.status, 404);
  const missingRecordPayload = await missingRecordResponse.json();
  assert.equal(missingRecordPayload.code, "playground_not_found");
  const missingShortLinkHeadResponse = await fetch(`${baseURL}/p/missing-record`, { method: "HEAD" });
  assert.equal(missingShortLinkHeadResponse.status, 404);
  assert.equal(missingShortLinkHeadResponse.headers.get("x-playpen-record-url"), null);
  const missingShortLinkResponse = await fetch(`${baseURL}/p/missing-record`);
  assert.equal(missingShortLinkResponse.status, 404);
  assert.match(missingShortLinkResponse.headers.get("content-type"), /text\/html/);
  assert.match(await missingShortLinkResponse.text(), /PlayPen Hosted Mirror/);

  console.log("hosted-service contract ok");
})().catch(error => {
  console.error(serverOutput);
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  serverProcess.kill();
});

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) {
        return;
      }
    } catch {
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start. Output:\n${serverOutput}`);
}

async function assertProtectedPublish(filePath) {
  const authStoreDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playpen-hosted-auth-test-"));
  const authPort = port + 1000;
  const authBaseURL = `http://127.0.0.1:${authPort}`;
  const authServer = spawn(process.execPath, ["server.js"], {
    cwd: hostedRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(authPort),
      PLAYPEN_STORE_DIR: authStoreDirectory,
      PLAYPEN_PUBLIC_BASE_URL: authBaseURL,
      PLAYPEN_PUBLISH_TOKEN: "contract-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let authOutput = "";
  authServer.stdout.on("data", chunk => {
    authOutput += chunk.toString();
  });
  authServer.stderr.on("data", chunk => {
    authOutput += chunk.toString();
  });

  try {
    await waitForURL(authBaseURL, () => authOutput);
    const protectedHealthResponse = await fetch(`${authBaseURL}/api/health`);
    assert.equal(protectedHealthResponse.status, 200);
    const protectedHealthPayload = await protectedHealthResponse.json();
    assert.equal(protectedHealthPayload.publishAuthRequired, true);

    const protectedCapabilitiesResponse = await fetch(`${authBaseURL}/.well-known/playpen-host.json`);
    assert.equal(protectedCapabilitiesResponse.status, 200);
    const protectedCapabilitiesPayload = await protectedCapabilitiesResponse.json();
    assert.equal(protectedCapabilitiesPayload.publishAuth.required, true);

    const unauthorizedResponse = await fetch(`${authBaseURL}/api/playgrounds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Unauthorized",
        kind: "markdown",
        content: "No token"
      })
    });
    assert.equal(unauthorizedResponse.status, 401);
    const unauthorizedPayload = await unauthorizedResponse.json();
    assert.equal(unauthorizedPayload.code, "publish_token_required");

    const unauthorizedDeleteResponse = await fetch(`${authBaseURL}/api/playgrounds/missing-record`, {
      method: "DELETE"
    });
    assert.equal(unauthorizedDeleteResponse.status, 401);
    const unauthorizedDeletePayload = await unauthorizedDeleteResponse.json();
    assert.equal(unauthorizedDeletePayload.code, "publish_token_required");

    const unauthorizedReplaceResponse = await fetch(`${authBaseURL}/api/playgrounds/auth-cli-record`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Unauthorized Replace",
        kind: "markdown",
        content: "No token"
      })
    });
    assert.equal(unauthorizedReplaceResponse.status, 401);
    const unauthorizedReplacePayload = await unauthorizedReplaceResponse.json();
    assert.equal(unauthorizedReplacePayload.code, "publish_token_required");

    const authorizedResult = await publishWithCLI(filePath, authBaseURL, "contract-secret", "auth-cli-record");
    assert.equal(authorizedResult.status, 0, authorizedResult.stderr);
    assert.equal(authorizedResult.stdout.trim(), `${authBaseURL}/p/auth-cli-record`);

    const authorizedFetchResponse = await fetch(`${authBaseURL}/api/playgrounds/auth-cli-record`);
    assert.equal(authorizedFetchResponse.status, 200);

    const protectedVerifyResult = await verifyHost(authBaseURL, "contract-secret", "auth-verify-record");
    assert.equal(protectedVerifyResult.status, 0, protectedVerifyResult.stderr);
    const protectedVerifyPayload = JSON.parse(protectedVerifyResult.stdout);
    assert.equal(protectedVerifyPayload.ok, true);
    assert.equal(protectedVerifyPayload.hostedURL, `${authBaseURL}/p/auth-verify-record`);
    assert.equal(protectedVerifyPayload.publishAuthRequired, true);
    assert.equal(protectedVerifyPayload.cleanup.deleted, true);
    const deletedProtectedVerifyResponse = await fetch(`${authBaseURL}/api/playgrounds/auth-verify-record`);
    assert.equal(deletedProtectedVerifyResponse.status, 404);
  } finally {
    authServer.kill();
    fs.rmSync(authStoreDirectory, { force: true, recursive: true });
  }
}

async function assertPrefixedPublicBaseURL() {
  const prefixedStoreDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playpen-hosted-prefixed-test-"));
  const prefixedPort = port + 3000;
  const prefixedBaseURL = `http://127.0.0.1:${prefixedPort}`;
  const prefixedPublicBaseURL = "https://playpen.example/tools/mirror";
  const prefixedServer = spawn(process.execPath, ["server.js"], {
    cwd: hostedRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(prefixedPort),
      PLAYPEN_STORE_DIR: prefixedStoreDirectory,
      PLAYPEN_PUBLIC_BASE_URL: prefixedPublicBaseURL
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let prefixedOutput = "";
  prefixedServer.stdout.on("data", chunk => {
    prefixedOutput += chunk.toString();
  });
  prefixedServer.stderr.on("data", chunk => {
    prefixedOutput += chunk.toString();
  });

  try {
    await waitForURL(prefixedBaseURL, () => prefixedOutput);
    const healthResponse = await fetch(`${prefixedBaseURL}/tools/mirror/api/health`);
    assert.equal(healthResponse.status, 200);
    const healthPayload = await healthResponse.json();
    assert.equal(healthPayload.publicBaseURL, prefixedPublicBaseURL);

    const publishResponse = await fetch(`${prefixedBaseURL}/tools/mirror/api/playgrounds`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        version: 1,
        id: "prefixed-record",
        title: "Prefixed Record",
        kind: "markdown",
        content: "Prefix-aware routes",
        publishedAt: new Date().toISOString()
      })
    });
    assert.equal(publishResponse.status, 201);
    const publishPayload = await publishResponse.json();
    assert.equal(publishPayload.url, `${prefixedPublicBaseURL}/p/prefixed-record`);
    assert.equal(publishPayload.recordURL, `${prefixedPublicBaseURL}/api/playgrounds/prefixed-record`);

    const viewerResponse = await fetch(`${prefixedBaseURL}/tools/mirror/p/prefixed-record`);
    assert.equal(viewerResponse.status, 200);
    assert.equal(viewerResponse.headers.get("x-playpen-record-url"), `${prefixedPublicBaseURL}/api/playgrounds/prefixed-record`);

    const sourceResponse = await fetch(`${prefixedBaseURL}/tools/mirror/api/playgrounds/prefixed-record/source`);
    assert.equal(sourceResponse.status, 200);
    assert.equal(await sourceResponse.text(), "Prefix-aware routes");
  } finally {
    prefixedServer.kill();
    fs.rmSync(prefixedStoreDirectory, { force: true, recursive: true });
  }
}

async function assertForwardedPublicBaseURL() {
  const forwardedStoreDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playpen-hosted-forwarded-test-"));
  const forwardedPort = port + 2000;
  const forwardedBaseURL = `http://127.0.0.1:${forwardedPort}`;
  const forwardedEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(forwardedPort),
    PLAYPEN_STORE_DIR: forwardedStoreDirectory
  };
  delete forwardedEnv.PLAYPEN_PUBLIC_BASE_URL;

  const forwardedServer = spawn(process.execPath, ["server.js"], {
    cwd: hostedRoot,
    env: forwardedEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let forwardedOutput = "";
  forwardedServer.stdout.on("data", chunk => {
    forwardedOutput += chunk.toString();
  });
  forwardedServer.stderr.on("data", chunk => {
    forwardedOutput += chunk.toString();
  });

  const forwardedHeaders = {
    "x-forwarded-host": "playpen.example",
    "x-forwarded-proto": "https",
    "x-forwarded-prefix": "/tools/mirror"
  };

  try {
    await waitForURL(forwardedBaseURL, () => forwardedOutput);
    const healthResponse = await fetch(`${forwardedBaseURL}/api/health`, {
      headers: forwardedHeaders
    });
    assert.equal(healthResponse.status, 200);
    const healthPayload = await healthResponse.json();
    assert.equal(healthPayload.publicBaseURL, "https://playpen.example/tools/mirror");
    assert.equal(healthPayload.publicBaseURLSource, "request");

    const capabilitiesResponse = await fetch(`${forwardedBaseURL}/api/capabilities`, {
      headers: forwardedHeaders
    });
    assert.equal(capabilitiesResponse.status, 200);
    const capabilitiesPayload = await capabilitiesResponse.json();
    assert.equal(capabilitiesPayload.publicBaseURL, "https://playpen.example/tools/mirror");
    assert.equal(capabilitiesPayload.linkFormats.hostedRecord, "https://playpen.example/tools/mirror/p/{id}");

    const publishResponse = await fetch(`${forwardedBaseURL}/api/playgrounds`, {
      method: "POST",
      headers: {
        ...forwardedHeaders,
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        version: 1,
        id: "forwarded-record",
        title: "Forwarded Record",
        kind: "markdown",
        content: "Proxy-aware links",
        publishedAt: new Date().toISOString()
      })
    });
    assert.equal(publishResponse.status, 201);
    const publishPayload = await publishResponse.json();
    assert.equal(publishPayload.url, "https://playpen.example/tools/mirror/p/forwarded-record");
    assert.equal(publishPayload.recordURL, "https://playpen.example/tools/mirror/api/playgrounds/forwarded-record");
  } finally {
    forwardedServer.kill();
    fs.rmSync(forwardedStoreDirectory, { force: true, recursive: true });
  }
}

function waitForURL(url, output) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (Date.now() - startedAt >= 5000) {
        reject(new Error(`Server did not start. Output:\n${output()}`));
        return;
      }
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function verifyHost(serviceURL, publishToken = "", recordID = "verify-contract-record", mode = "api") {
  return new Promise(resolve => {
    const verifyArguments = [
      "verify-host.js",
      "--service",
      serviceURL,
      "--id",
      recordID,
      "--mode",
      mode
    ];
    if (publishToken) {
      verifyArguments.push("--token", publishToken);
    }
    const verifyProcess = spawn(process.execPath, verifyArguments, {
      cwd: hostedRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    verifyProcess.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    verifyProcess.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    verifyProcess.on("close", status => {
      resolve({ status, stdout, stderr });
    });
  });
}

function publishWithCLI(filePath, serviceURL, publishToken = "", recordID = "cli-contract-record", shouldPrintJSON = false, annotation = "", shouldReplace = false) {
  return new Promise(resolve => {
    const cliArguments = [
      "publish-file.js",
      filePath,
      "--service",
      serviceURL,
      "--id",
      recordID,
      "--title",
      "CLI Contract"
    ];
    if (annotation) {
      cliArguments.push("--annotation", annotation);
    }
    if (shouldPrintJSON) {
      cliArguments.push("--json");
    }
    if (shouldReplace) {
      cliArguments.push("--replace");
    }
    if (publishToken) {
      cliArguments.push("--token", publishToken);
    }
    const cliProcess = spawn(process.execPath, cliArguments, {
      cwd: hostedRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    cliProcess.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    cliProcess.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    cliProcess.on("close", status => {
      resolve({ status, stdout, stderr });
    });
  });
}

function inspectWithCLI(url, extraArguments = []) {
  return new Promise(resolve => {
    const cliProcess = spawn(process.execPath, ["inspect-link.js", url, ...extraArguments], {
      cwd: hostedRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    cliProcess.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    cliProcess.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    cliProcess.on("close", status => {
      resolve({ status, stdout, stderr });
    });
  });
}
