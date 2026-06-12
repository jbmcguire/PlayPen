const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const defaultRecordPrefix = "playgrounds/";

function createStorage(environment = process.env, dependencies = {}) {
  const storageDriver = (environment.PLAYPEN_STORAGE_DRIVER || "filesystem").trim().toLowerCase();
  if (storageDriver === "filesystem" || storageDriver === "fs" || storageDriver === "file") {
    return createFilesystemStorage(environment, dependencies);
  }
  if (storageDriver === "s3" || storageDriver === "r2" || storageDriver === "object") {
    return createS3Storage(environment, dependencies);
  }
  throw new Error(`Unsupported PLAYPEN_STORAGE_DRIVER: ${storageDriver}`);
}

function createFilesystemStorage(environment, dependencies) {
  const filesystem = dependencies.fs || fs;
  const rootDirectory = dependencies.rootDirectory || __dirname;
  const storeDirectory = environment.PLAYPEN_STORE_DIR || path.join(rootDirectory, ".playpen-store");
  filesystem.mkdirSync(storeDirectory, { recursive: true });

  return {
    type: "filesystem",
    health: {
      storeDirectory
    },
    async createPayload(playgroundID, payload) {
      const filePath = filesystemRecordPath(storeDirectory, playgroundID);
      try {
        filesystem.writeFileSync(filePath, JSON.stringify(payload, null, 2), { flag: "wx" });
        return true;
      } catch (error) {
        if (error && error.code === "EEXIST") {
          return false;
        }
        throw error;
      }
    },
    async writePayload(playgroundID, payload) {
      filesystem.writeFileSync(filesystemRecordPath(storeDirectory, playgroundID), JSON.stringify(payload, null, 2));
    },
    async readPayload(playgroundID) {
      const filePath = filesystemRecordPath(storeDirectory, playgroundID);
      if (!filePath || !filesystem.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(filesystem.readFileSync(filePath, "utf8"));
    },
    async deletePayload(playgroundID) {
      const filePath = filesystemRecordPath(storeDirectory, playgroundID);
      if (!filePath || !filesystem.existsSync(filePath)) {
        return false;
      }
      filesystem.unlinkSync(filePath);
      return true;
    },
    async listPayloads(options = {}) {
      return listFromPayloadEntries("filesystem", filesystemPayloadEntries(filesystem, storeDirectory), options);
    },
    async stats() {
      return statsFromPayloadEntries("filesystem", filesystemPayloadEntries(filesystem, storeDirectory));
    }
  };
}

function filesystemPayloadEntries(filesystem, storeDirectory) {
  return filesystem.readdirSync(storeDirectory, { withFileTypes: true })
    .filter(directoryEntry => directoryEntry.isFile() && directoryEntry.name.endsWith(".json"))
    .map(directoryEntry => {
      const filePath = path.join(storeDirectory, directoryEntry.name);
      return {
        payload: JSON.parse(filesystem.readFileSync(filePath, "utf8")),
        storageBytes: filesystem.statSync(filePath).size
      };
    });
}

function filesystemRecordPath(storeDirectory, playgroundID) {
  const checkedID = safeID(playgroundID);
  if (!checkedID) {
    return null;
  }
  return path.join(storeDirectory, `${checkedID}.json`);
}

function createS3Storage(environment, dependencies) {
  const fetchImplementation = dependencies.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("S3 storage requires fetch support");
  }

  const hasCustomEndpoint = Boolean((environment.PLAYPEN_S3_ENDPOINT || "").trim());
  const bucket = requiredValue(environment.PLAYPEN_S3_BUCKET, "PLAYPEN_S3_BUCKET");
  const region = (environment.PLAYPEN_S3_REGION || (hasCustomEndpoint ? "auto" : "us-east-1")).trim();
  const endpoint = s3Endpoint(environment.PLAYPEN_S3_ENDPOINT, region);
  const accessKeyID = requiredValue(environment.PLAYPEN_S3_ACCESS_KEY_ID, "PLAYPEN_S3_ACCESS_KEY_ID");
  const secretAccessKey = requiredValue(environment.PLAYPEN_S3_SECRET_ACCESS_KEY, "PLAYPEN_S3_SECRET_ACCESS_KEY");
  const sessionToken = (environment.PLAYPEN_S3_SESSION_TOKEN || "").trim();
  const recordPrefix = normalizedRecordPrefix(environment.PLAYPEN_S3_PREFIX || defaultRecordPrefix);
  const shouldUsePathStyle = pathStyleSetting(environment.PLAYPEN_S3_FORCE_PATH_STYLE, hasCustomEndpoint);
  const clock = dependencies.now || (() => new Date());

  return {
    type: "s3",
    health: {
      bucket,
      region,
      endpoint: endpoint.origin,
      recordPrefix
    },
    async createPayload(playgroundID, payload) {
      const payloadBody = JSON.stringify(payload, null, 2);
      const response = await signedS3Fetch("PUT", objectURL(recordKey(recordPrefix, playgroundID)), {
        accessKeyID,
        body: payloadBody,
        clock,
        contentType: "application/json; charset=utf-8",
        fetchImplementation,
        headers: {
          "if-none-match": "*"
        },
        region,
        secretAccessKey,
        sessionToken
      });
      if (response.status === 409 || response.status === 412) {
        return false;
      }
      await assertS3Response(response, "S3 create");
      return true;
    },
    async writePayload(playgroundID, payload) {
      const payloadBody = JSON.stringify(payload, null, 2);
      const response = await signedS3Fetch("PUT", objectURL(recordKey(recordPrefix, playgroundID)), {
        accessKeyID,
        body: payloadBody,
        clock,
        contentType: "application/json; charset=utf-8",
        fetchImplementation,
        region,
        secretAccessKey,
        sessionToken
      });
      await assertS3Response(response, "S3 write");
    },
    async readPayload(playgroundID) {
      const response = await signedS3Fetch("GET", objectURL(recordKey(recordPrefix, playgroundID)), {
        accessKeyID,
        clock,
        fetchImplementation,
        region,
        secretAccessKey,
        sessionToken
      });
      if (response.status === 404) {
        return null;
      }
      await assertS3Response(response, "S3 read");
      return response.json();
    },
    async deletePayload(playgroundID) {
      const existingPayload = await readPayloadByKey(recordKey(recordPrefix, playgroundID));
      if (!existingPayload) {
        return false;
      }
      const response = await signedS3Fetch("DELETE", objectURL(recordKey(recordPrefix, playgroundID)), {
        accessKeyID,
        clock,
        fetchImplementation,
        region,
        secretAccessKey,
        sessionToken
      });
      await assertS3Response(response, "S3 delete");
      return true;
    },
    async listPayloads(options = {}) {
      return listFromPayloadEntries("s3", await readPayloadEntries(), options);
    },
    async stats() {
      return statsFromPayloadEntries("s3", await readPayloadEntries());
    }
  };

  function objectURL(objectKey) {
    return s3ObjectURL(endpoint, bucket, objectKey, shouldUsePathStyle);
  }

  async function readPayloadByKey(objectKey) {
    const response = await signedS3Fetch("GET", objectURL(objectKey), {
      accessKeyID,
      clock,
      fetchImplementation,
      region,
      secretAccessKey,
      sessionToken
    });
    if (response.status === 404) {
      return null;
    }
    await assertS3Response(response, "S3 stats read");
    return response.json();
  }

  async function readPayloadEntries() {
    const objectEntries = await listRecordObjects();
    const payloadEntries = [];
    for (const objectEntry of objectEntries) {
      const payload = await readPayloadByKey(objectEntry.key);
      if (payload) {
        payloadEntries.push({
          payload,
          storageBytes: objectEntry.size
        });
      }
    }
    return payloadEntries;
  }

  async function listRecordObjects() {
    const objectEntries = [];
    let continuationToken = "";
    do {
      const requestURL = objectURL("");
      requestURL.searchParams.set("list-type", "2");
      requestURL.searchParams.set("prefix", recordPrefix);
      if (continuationToken) {
        requestURL.searchParams.set("continuation-token", continuationToken);
      }
      const response = await signedS3Fetch("GET", requestURL, {
        accessKeyID,
        clock,
        fetchImplementation,
        region,
        secretAccessKey,
        sessionToken
      });
      await assertS3Response(response, "S3 list");
      const responseXML = await response.text();
      objectEntries.push(...parseListObjectsXML(responseXML).filter(objectEntry => objectEntry.key.endsWith(".json")));
      continuationToken = isTruncatedList(responseXML) ? firstXMLValue(responseXML, "NextContinuationToken") : "";
    } while (continuationToken);
    return objectEntries;
  }
}

function listFromPayloadEntries(storageType, payloadEntries, options = {}) {
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(0, Number(options.limit) || 50);
  const sortedPayloadEntries = sortPayloadEntries(payloadEntries);
  return {
    ok: true,
    storage: storageType,
    total: sortedPayloadEntries.length,
    count: Math.min(limit, Math.max(0, sortedPayloadEntries.length - offset)),
    limit,
    offset,
    items: sortedPayloadEntries
      .slice(offset, offset + limit)
      .map(payloadEntry => payloadEntry.payload),
    generatedAt: new Date().toISOString()
  };
}

function sortPayloadEntries(payloadEntries) {
  return [...payloadEntries].sort((leftEntry, rightEntry) => {
    const leftDate = Date.parse(leftEntry.payload.publishedAt || "") || 0;
    const rightDate = Date.parse(rightEntry.payload.publishedAt || "") || 0;
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    return String(leftEntry.payload.title || "").localeCompare(String(rightEntry.payload.title || ""));
  });
}

function statsFromPayloadEntries(storageType, payloadEntries) {
  const kindCounts = {
    html: 0,
    markdown: 0
  };
  let storageBytes = 0;
  let oldestPublishedAt = null;
  let newestPublishedAt = null;

  payloadEntries.forEach(payloadEntry => {
    storageBytes += payloadEntry.storageBytes;
    const payload = payloadEntry.payload;
    if (payload.kind === "html" || payload.kind === "markdown") {
      kindCounts[payload.kind] += 1;
    }
    if (typeof payload.publishedAt === "string") {
      oldestPublishedAt = earlierDateString(oldestPublishedAt, payload.publishedAt);
      newestPublishedAt = laterDateString(newestPublishedAt, payload.publishedAt);
    }
  });

  return {
    ok: true,
    storage: storageType,
    recordCount: payloadEntries.length,
    storageBytes,
    kindCounts,
    oldestPublishedAt,
    newestPublishedAt,
    generatedAt: new Date().toISOString()
  };
}

function safeID(value) {
  if (typeof value !== "string") {
    return null;
  }
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}

function requiredValue(value, name) {
  const trimmedValue = (value || "").trim();
  if (!trimmedValue) {
    throw new Error(`${name} is required for S3 storage`);
  }
  return trimmedValue;
}

function s3Endpoint(value, region) {
  const endpointValue = (value || "").trim() || `https://s3.${region}.amazonaws.com`;
  const endpoint = new URL(endpointValue);
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function normalizedRecordPrefix(value) {
  const trimmedValue = value.trim().replace(/^\/+/, "");
  if (!trimmedValue) {
    return "";
  }
  return trimmedValue.endsWith("/") ? trimmedValue : `${trimmedValue}/`;
}

function pathStyleSetting(value, shouldDefaultToPathStyle) {
  if (typeof value !== "string" || !value.trim()) {
    return shouldDefaultToPathStyle;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function recordKey(recordPrefix, playgroundID) {
  const checkedID = safeID(playgroundID);
  if (!checkedID) {
    throw new Error("Invalid playground id");
  }
  return `${recordPrefix}${checkedID}.json`;
}

function s3ObjectURL(endpoint, bucket, objectKey, shouldUsePathStyle) {
  const requestURL = new URL(endpoint.href);
  const encodedKey = encodedPath(objectKey);
  const endpointPath = requestURL.pathname.replace(/\/+$/, "");
  if (shouldUsePathStyle) {
    requestURL.pathname = `${endpointPath}/${awsEncode(bucket)}${encodedKey ? `/${encodedKey}` : "/"}`;
    return requestURL;
  }
  requestURL.hostname = `${bucket}.${requestURL.hostname}`;
  requestURL.pathname = `${endpointPath}${encodedKey ? `/${encodedKey}` : "/"}`;
  return requestURL;
}

function encodedPath(value) {
  return value
    .split("/")
    .filter(pathSegment => pathSegment.length > 0)
    .map(pathSegment => awsEncode(pathSegment))
    .join("/");
}

async function signedS3Fetch(method, requestURL, options) {
  const body = options.body || "";
  const payloadHash = sha256Hex(body);
  const requestDate = options.clock();
  const amzDate = amzDateString(requestDate);
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host: requestURL.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(options.headers || {})
  };
  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }
  if (options.sessionToken) {
    headers["x-amz-security-token"] = options.sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    method,
    canonicalPathname(requestURL.pathname),
    canonicalQueryString(requestURL),
    canonicalHeaders(headers),
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${options.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmacHex(signingKey(options.secretAccessKey, dateStamp, options.region), stringToSign);

  headers.authorization = [
    "AWS4-HMAC-SHA256",
    `Credential=${options.accessKeyID}/${credentialScope},`,
    `SignedHeaders=${signedHeaders},`,
    `Signature=${signature}`
  ].join(" ");

  return options.fetchImplementation(requestURL, {
    method,
    headers,
    body: body || undefined
  });
}

async function assertS3Response(response, label) {
  if (response.ok) {
    return;
  }
  const responseText = await response.text();
  throw new Error(`${label} failed: HTTP ${response.status}${responseText ? ` ${responseText}` : ""}`);
}

function canonicalPathname(pathname) {
  return pathname
    .split("/")
    .map(pathSegment => awsEncode(decodeURIComponent(pathSegment)))
    .join("/");
}

function canonicalQueryString(requestURL) {
  return [...requestURL.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
}

function canonicalHeaders(headers) {
  return Object.keys(headers)
    .sort()
    .map(headerName => `${headerName}:${String(headers[headerName]).trim().replace(/\s+/g, " ")}`)
    .join("\n") + "\n";
}

function amzDateString(value) {
  return value.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secretAccessKey, dateStamp, region) {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmacBuffer(dateKey, region);
  const serviceKey = hmacBuffer(regionKey, "s3");
  return hmacBuffer(serviceKey, "aws4_request");
}

function hmacBuffer(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function parseListObjectsXML(value) {
  const contentMatches = [...value.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)];
  return contentMatches.map(contentMatch => ({
    key: firstXMLValue(contentMatch[1], "Key"),
    size: Number(firstXMLValue(contentMatch[1], "Size") || 0)
  }));
}

function isTruncatedList(value) {
  return firstXMLValue(value, "IsTruncated") === "true";
}

function firstXMLValue(value, tagName) {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(value);
  if (!match) {
    return "";
  }
  return decodeXML(match[1]);
}

function decodeXML(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function earlierDateString(currentValue, nextValue) {
  if (!currentValue) {
    return nextValue;
  }
  return Date.parse(nextValue) < Date.parse(currentValue) ? nextValue : currentValue;
}

function laterDateString(currentValue, nextValue) {
  if (!currentValue) {
    return nextValue;
  }
  return Date.parse(nextValue) > Date.parse(currentValue) ? nextValue : currentValue;
}

module.exports = {
  createStorage,
  statsFromPayloadEntries
};
