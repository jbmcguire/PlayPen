const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStorage } = require("../storage");

(async () => {
  await assertFilesystemStorage();
  await assertS3Storage();
  await assertS3AWSDefaults();
  console.log("storage contract ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function assertFilesystemStorage() {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playpen-filesystem-storage-test-"));
  try {
    const storage = createStorage({
      PLAYPEN_STORE_DIR: storeDirectory
    });
    assert.equal(storage.type, "filesystem");
    assert.equal(storage.health.storeDirectory, storeDirectory);

    const payload = payloadFor("filesystem-record", "Filesystem Record");
    assert.equal(await storage.createPayload(payload.id, payload), true);
    assert.equal(await storage.createPayload(payload.id, payloadFor("filesystem-record", "Filesystem Duplicate")), false);
    await storage.writePayload(payload.id, payloadFor("filesystem-record", "Filesystem Record Replaced"));
    await storage.writePayload("filesystem-second", {
      ...payloadFor("filesystem-second", "Filesystem Second"),
      publishedAt: "2026-06-12T12:05:00.000Z"
    });
    const readPayload = await storage.readPayload(payload.id);
    assert.equal(readPayload.title, "Filesystem Record Replaced");
    assert.equal(readPayload.content, "# Filesystem Record Replaced\n\nDurable storage round-trip.");

    const payloadList = await storage.listPayloads({ limit: 1, offset: 0 });
    assert.equal(payloadList.storage, "filesystem");
    assert.equal(payloadList.total, 2);
    assert.equal(payloadList.count, 1);
    assert.equal(payloadList.items[0].id, "filesystem-second");

    const stats = await storage.stats();
    assert.equal(stats.storage, "filesystem");
    assert.equal(stats.recordCount, 2);
    assert.equal(stats.kindCounts.markdown, 2);
    assert.ok(stats.storageBytes > 0);

    assert.equal(await storage.deletePayload(payload.id), true);
    assert.equal(await storage.deletePayload(payload.id), false);
    assert.equal(await storage.deletePayload("filesystem-second"), true);
    assert.equal(await storage.readPayload(payload.id), null);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
}

async function assertS3Storage() {
  const objectBodies = new Map();
  const requests = [];
  const storage = createStorage({
    PLAYPEN_STORAGE_DRIVER: "s3",
    PLAYPEN_S3_ACCESS_KEY_ID: "test-access-key",
    PLAYPEN_S3_SECRET_ACCESS_KEY: "test-secret-key",
    PLAYPEN_S3_BUCKET: "playpen-bucket",
    PLAYPEN_S3_ENDPOINT: "https://objects.example",
    PLAYPEN_S3_PREFIX: "records",
    PLAYPEN_S3_REGION: "auto"
  }, {
    fetch: async (url, options = {}) => fakeS3Fetch(url, options, objectBodies, requests),
    now: () => new Date("2026-06-12T12:00:00.000Z")
  });

  assert.equal(storage.type, "s3");
  assert.equal(storage.health.bucket, "playpen-bucket");
  assert.equal(storage.health.endpoint, "https://objects.example");
  assert.equal(storage.health.recordPrefix, "records/");

  const payload = payloadFor("s3-record-01", "S3 Record");
  assert.equal(await storage.createPayload(payload.id, payload), true);
  assert.equal(await storage.createPayload(payload.id, payloadFor("s3-record-01", "S3 Duplicate")), false);
  await storage.writePayload(payload.id, payloadFor("s3-record-01", "S3 Record Replaced"));
  const createRequest = requests.find(request => request.method === "PUT" && request.headers["if-none-match"] === "*");
  assert.ok(createRequest.headers.authorization.startsWith("AWS4-HMAC-SHA256"));
  assert.match(createRequest.headers.authorization, /SignedHeaders=.*if-none-match/);
  const putRequest = requests.find(request => request.method === "PUT" && !request.headers["if-none-match"]);
  assert.ok(putRequest.headers.authorization.startsWith("AWS4-HMAC-SHA256"));
  assert.match(putRequest.headers.authorization, /Credential=test-access-key\/20260612\/auto\/s3\/aws4_request/);
  assert.equal(putRequest.headers["x-amz-content-sha256"].length, 64);

  const readPayload = await storage.readPayload(payload.id);
  assert.equal(readPayload.title, "S3 Record Replaced");
  assert.equal(readPayload.content, "# S3 Record Replaced\n\nDurable storage round-trip.");

  const payloadList = await storage.listPayloads({ limit: 10, offset: 0 });
  assert.equal(payloadList.storage, "s3");
  assert.equal(payloadList.total, 1);
  assert.equal(payloadList.items[0].id, payload.id);

  const stats = await storage.stats();
  assert.equal(stats.storage, "s3");
  assert.equal(stats.recordCount, 1);
  assert.equal(stats.kindCounts.markdown, 1);
  assert.ok(stats.storageBytes > 0);

  assert.equal(await storage.deletePayload(payload.id), true);
  assert.equal(await storage.readPayload(payload.id), null);
  assert.equal(await storage.deletePayload(payload.id), false);
}

async function assertS3AWSDefaults() {
  let putURL = null;
  const storage = createStorage({
    PLAYPEN_STORAGE_DRIVER: "s3",
    PLAYPEN_S3_ACCESS_KEY_ID: "test-access-key",
    PLAYPEN_S3_SECRET_ACCESS_KEY: "test-secret-key",
    PLAYPEN_S3_BUCKET: "playpen-bucket"
  }, {
    fetch: async (url, options = {}) => {
      putURL = new URL(url);
      assert.equal(options.method, "PUT");
      return new Response("", { status: 200 });
    },
    now: () => new Date("2026-06-12T12:00:00.000Z")
  });

  assert.equal(storage.health.region, "us-east-1");
  assert.equal(storage.health.endpoint, "https://s3.us-east-1.amazonaws.com");
  await storage.writePayload("aws-record-01", payloadFor("aws-record-01", "AWS Record"));
  assert.equal(putURL.host, "playpen-bucket.s3.us-east-1.amazonaws.com");
  assert.equal(putURL.pathname, "/playgrounds/aws-record-01.json");
}

function payloadFor(id, title) {
  return {
    version: 1,
    id,
    title,
    kind: "markdown",
    content: `# ${title}\n\nDurable storage round-trip.`,
    publishedAt: "2026-06-12T12:00:00.000Z"
  };
}

async function fakeS3Fetch(url, options, objectBodies, requests) {
  const requestURL = new URL(url);
  const method = options.method || "GET";
  const headers = options.headers || {};
  const objectKey = objectKeyFromPath(requestURL.pathname);
  requests.push({
    method,
    url: requestURL.href,
    headers,
    body: options.body || ""
  });

  if (method === "GET" && requestURL.searchParams.get("list-type") === "2") {
    return new Response(listObjectsXML(objectBodies), {
      status: 200,
      headers: { "content-type": "application/xml" }
    });
  }

  if (method === "PUT") {
    if (headers["if-none-match"] === "*" && objectBodies.has(objectKey)) {
      return new Response("", { status: 412 });
    }
    objectBodies.set(objectKey, String(options.body || ""));
    return new Response("", { status: 200 });
  }

  if (method === "GET") {
    if (!objectBodies.has(objectKey)) {
      return new Response("", { status: 404 });
    }
    return new Response(objectBodies.get(objectKey), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "DELETE") {
    objectBodies.delete(objectKey);
    return new Response(null, { status: 204 });
  }

  return new Response("unsupported", { status: 405 });
}

function objectKeyFromPath(pathname) {
  const pathParts = pathname.split("/").filter(Boolean);
  assert.equal(pathParts[0], "playpen-bucket");
  return decodeURIComponent(pathParts.slice(1).join("/"));
}

function listObjectsXML(objectBodies) {
  const contentXML = [...objectBodies.entries()]
    .map(([objectKey, objectBody]) => [
      "<Contents>",
      `<Key>${encodeXML(objectKey)}</Key>`,
      `<Size>${Buffer.byteLength(objectBody)}</Size>`,
      "</Contents>"
    ].join(""))
    .join("");
  return `<ListBucketResult><IsTruncated>false</IsTruncated>${contentXML}</ListBucketResult>`;
}

function encodeXML(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
