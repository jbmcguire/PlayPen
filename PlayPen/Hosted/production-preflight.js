const { spawn } = require("child_process");

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

  const preflightReport = await runProductionPreflight(options);
  console.log(JSON.stringify(preflightReport, null, 2));
  if (!preflightReport.ok) {
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const options = {
    id: `production-preflight-${Date.now()}`,
    mode: "api",
    publishToken: defaultPublishToken,
    serviceURL: defaultServiceURL,
    shouldAllowLocal: false,
    shouldKeepRecord: false,
    shouldRequirePublic: false,
    shouldRequireToken: false,
    shouldShowHelp: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.shouldShowHelp = true;
      continue;
    }
    if (arg === "--allow-local") {
      options.shouldAllowLocal = true;
      continue;
    }
    if (arg === "--id") {
      options.id = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--keep-record") {
      options.shouldKeepRecord = true;
      continue;
    }
    if (arg === "--mode") {
      options.mode = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--require-public") {
      options.shouldRequirePublic = true;
      continue;
    }
    if (arg === "--require-token") {
      options.shouldRequireToken = true;
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

async function runProductionPreflight(options) {
  const checks = [
    tokenCheck(options),
    storageConfigurationCheck(),
    configuredPublicURLCheck()
  ];
  const verifierReport = await runVerifier(options);
  checks.push(...publicURLChecks(options, verifierReport));
  checks.push(cleanupCheck(verifierReport));

  return {
    ok: checks.every(check => check.ok) && verifierReport.ok,
    mode: options.mode,
    serviceURL: verifierReport.serviceURL,
    hostedURL: verifierReport.hostedURL,
    publicBaseURL: verifierReport.publicBaseURL || null,
    storage: verifierReport.storage || "static",
    publishAuthRequired: Boolean(verifierReport.publishAuthRequired),
    checks,
    verifier: verifierReport
  };
}

function tokenCheck(options) {
  if (!options.shouldRequireToken) {
    return check("publish-token-policy", true, "Publish token requirement was not enforced by this preflight.");
  }
  return check(
    "publish-token-policy",
    Boolean(options.publishToken),
    "A publish token is required for this public deployment preflight."
  );
}

function storageConfigurationCheck() {
  const storageDriver = (process.env.PLAYPEN_STORAGE_DRIVER || "filesystem").trim().toLowerCase();
  if (storageDriver === "s3" || storageDriver === "r2" || storageDriver === "object") {
    const requiredNames = [
      "PLAYPEN_S3_BUCKET",
      "PLAYPEN_S3_ACCESS_KEY_ID",
      "PLAYPEN_S3_SECRET_ACCESS_KEY"
    ];
    const missingNames = requiredNames.filter(name => !process.env[name]);
    return check(
      "storage-configuration",
      missingNames.length === 0,
      missingNames.length === 0 ? "S3-compatible storage environment is configured." : `Missing ${missingNames.join(", ")}.`
    );
  }
  if (storageDriver === "filesystem" || storageDriver === "fs" || storageDriver === "file") {
    return check(
      "storage-configuration",
      Boolean(process.env.PLAYPEN_STORE_DIR),
      process.env.PLAYPEN_STORE_DIR ? "Filesystem storage directory is configured." : "Set PLAYPEN_STORE_DIR to a durable mounted directory for production."
    );
  }
  return check("storage-configuration", false, `Unsupported PLAYPEN_STORAGE_DRIVER: ${storageDriver}`);
}

function configuredPublicURLCheck() {
  if (!process.env.PLAYPEN_PUBLIC_BASE_URL) {
    return check("configured-public-url", true, "PLAYPEN_PUBLIC_BASE_URL is unset; forwarded headers or host headers will determine generated links.");
  }
  return publicURLCheck("configured-public-url", process.env.PLAYPEN_PUBLIC_BASE_URL, true);
}

async function runVerifier(options) {
  const verifierArguments = [
    "verify-host.js",
    "--service",
    options.serviceURL,
    "--id",
    options.id,
    "--mode",
    options.mode
  ];
  if (options.publishToken) {
    verifierArguments.push("--token", options.publishToken);
  }
  if (options.shouldKeepRecord) {
    verifierArguments.push("--keep-record");
  }

  const verifierProcessReport = await runNodeScript(verifierArguments);
  if (verifierProcessReport.status !== 0) {
    throw new Error(verifierProcessReport.stderr || verifierProcessReport.stdout || "Verifier failed");
  }
  return JSON.parse(verifierProcessReport.stdout);
}

function runNodeScript(args) {
  return new Promise(resolve => {
    const childProcess = spawn(process.execPath, args, {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    childProcess.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    childProcess.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    childProcess.on("close", status => {
      resolve({ status, stdout, stderr });
    });
  });
}

function publicURLChecks(options, verifierReport) {
  if (!options.shouldRequirePublic) {
    return [
      check("public-url-policy", true, "Public URL enforcement was not requested.")
    ];
  }
  if (options.shouldAllowLocal) {
    return [
      check("public-url-policy", true, "Local URLs are allowed for this preflight run.")
    ];
  }
  return [
    publicURLCheck("service-url-public", verifierReport.serviceURL, false),
    publicURLCheck("hosted-url-public", verifierReport.hostedURL, false),
    publicURLCheck("public-base-url-public", verifierReport.publicBaseURL || verifierReport.hostedURL, false)
  ];
}

function cleanupCheck(verifierReport) {
  if (verifierReport.mode === "static") {
    return check("cleanup", true, "Static verification does not create API records.");
  }
  if (!verifierReport.cleanup?.attempted) {
    return check("cleanup", true, "Probe record was kept intentionally.");
  }
  return check("cleanup", Boolean(verifierReport.cleanup.deleted), "Verifier probe record was deleted.");
}

function publicURLCheck(name, value, isOptional) {
  if (!value) {
    return check(name, isOptional, isOptional ? "No public URL configured." : "Missing URL.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return check(name, false, `${value} is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    return check(name, false, `${url.href} must use https for public deployment.`);
  }
  if (isPrivateHost(url.hostname)) {
    return check(name, false, `${url.hostname} is not a public host.`);
  }
  return check(name, true, `${url.href} is public-facing.`);
}

function isPrivateHost(hostname) {
  const normalizedHost = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalizedHost === "localhost" || normalizedHost === "0.0.0.0" || normalizedHost === "::1") {
    return true;
  }
  if (normalizedHost.endsWith(".local")) {
    return true;
  }
  const ipv4Parts = normalizedHost.split(".").map(part => Number(part));
  if (ipv4Parts.length !== 4 || ipv4Parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [firstOctet, secondOctet] = ipv4Parts;
  return firstOctet === 10 ||
    firstOctet === 127 ||
    firstOctet === 169 && secondOctet === 254 ||
    firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31 ||
    firstOctet === 192 && secondOctet === 168;
}

function check(name, isOK, message) {
  return {
    name,
    ok: isOK,
    message
  };
}

function printHelp() {
  console.log([
    "Usage: npm run preflight -- [--service URL] [--token TOKEN] [--id ID] [--mode api|static]",
    "",
    "Runs the PlayPen verifier, then applies production-readiness gates.",
    "--require-public fails if the service or returned hosted links are localhost/private/non-HTTPS.",
    "--require-token fails unless a publish token is supplied.",
    "--allow-local permits local URLs for development preflight runs."
  ].join("\n"));
}
