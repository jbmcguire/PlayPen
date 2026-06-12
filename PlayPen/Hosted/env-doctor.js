const path = require("path");

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.shouldShowHelp) {
    printHelp();
    return;
  }

  const report = environmentReport(process.env, options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const options = {
    mode: "api",
    shouldAllowLocal: false,
    shouldCheckProduction: false,
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
    if (arg === "--mode") {
      options.mode = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--production") {
      options.shouldCheckProduction = true;
      continue;
    }
    if (arg === "--static") {
      options.mode = "static";
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

function environmentReport(environment = process.env, options = {}) {
  const checkedOptions = {
    mode: options.mode || "api",
    shouldAllowLocal: Boolean(options.shouldAllowLocal),
    shouldCheckProduction: Boolean(options.shouldCheckProduction)
  };
  const checks = [
    modeCheck(checkedOptions)
  ];

  if (checkedOptions.mode === "static") {
    checks.push(publicBaseURLCheck(environment, checkedOptions));
  } else if (checkedOptions.mode === "api") {
    checks.push(
      storageCheck(environment, checkedOptions),
      publishTokenCheck(environment, checkedOptions),
      publicBaseURLCheck(environment, checkedOptions)
    );
  }

  const failedChecks = checks.filter(check => check.level === "fail" && !check.ok);
  const warningChecks = checks.filter(check => check.level === "warn" && !check.ok);
  return {
    ok: failedChecks.length === 0,
    mode: checkedOptions.mode,
    production: checkedOptions.shouldCheckProduction,
    summary: {
      failed: failedChecks.length,
      warnings: warningChecks.length
    },
    checks
  };
}

function modeCheck(options) {
  const isValidMode = options.mode === "api" || options.mode === "static";
  return check(
    "mode",
    isValidMode,
    "fail",
    isValidMode ? `Deployment mode is ${options.mode}.` : "--mode must be api or static."
  );
}

function storageCheck(environment, options) {
  const storageDriver = normalizedValue(environment.PLAYPEN_STORAGE_DRIVER || "filesystem").toLowerCase();
  if (storageDriver === "filesystem" || storageDriver === "fs" || storageDriver === "file") {
    return filesystemStorageCheck(environment, options);
  }
  if (storageDriver === "s3" || storageDriver === "r2" || storageDriver === "object") {
    return s3StorageCheck(environment);
  }
  return check("storage", false, "fail", `Unsupported PLAYPEN_STORAGE_DRIVER: ${storageDriver}`);
}

function filesystemStorageCheck(environment, options) {
  const storeDirectory = normalizedValue(environment.PLAYPEN_STORE_DIR);
  if (!options.shouldCheckProduction) {
    return check(
      "filesystem-storage",
      true,
      "info",
      storeDirectory ? `Filesystem storage will use ${storeDirectory}.` : "Filesystem storage will use the local .playpen-store default."
    );
  }
  if (!storeDirectory) {
    return check("filesystem-storage", false, "fail", "Set PLAYPEN_STORE_DIR to a durable mounted directory for production.");
  }
  if (!path.isAbsolute(storeDirectory)) {
    return check("filesystem-storage", false, "fail", "Use an absolute durable path for PLAYPEN_STORE_DIR in production.");
  }
  if (storeDirectory.includes(".playpen-store")) {
    return check("filesystem-storage", false, "warn", "PLAYPEN_STORE_DIR looks like a local development store; use a durable mounted directory.");
  }
  return check("filesystem-storage", true, "info", `Filesystem storage directory is ${storeDirectory}.`);
}

function s3StorageCheck(environment) {
  const requiredNames = [
    "PLAYPEN_S3_BUCKET",
    "PLAYPEN_S3_ACCESS_KEY_ID",
    "PLAYPEN_S3_SECRET_ACCESS_KEY"
  ];
  const missingNames = requiredNames.filter(name => !normalizedValue(environment[name]));
  if (missingNames.length > 0) {
    return check("s3-storage", false, "fail", `Missing ${missingNames.join(", ")}.`);
  }
  const endpoint = normalizedValue(environment.PLAYPEN_S3_ENDPOINT);
  if (endpoint) {
    try {
      new URL(endpoint);
    } catch {
      return check("s3-storage", false, "fail", "PLAYPEN_S3_ENDPOINT is not a valid URL.");
    }
  }
  return check("s3-storage", true, "info", "S3-compatible storage environment is configured.");
}

function publishTokenCheck(environment, options) {
  const publishToken = normalizedValue(environment.PLAYPEN_PUBLISH_TOKEN);
  if (publishToken) {
    return check("publish-token", true, "info", "PLAYPEN_PUBLISH_TOKEN is set.");
  }
  return check(
    "publish-token",
    false,
    options.shouldCheckProduction ? "fail" : "warn",
    options.shouldCheckProduction ? "Set PLAYPEN_PUBLISH_TOKEN before exposing public writes." : "PLAYPEN_PUBLISH_TOKEN is unset; local writes will be open."
  );
}

function publicBaseURLCheck(environment, options) {
  const publicBaseURL = normalizedValue(environment.PLAYPEN_PUBLIC_BASE_URL);
  if (!publicBaseURL) {
    return check(
      "public-base-url",
      !options.shouldCheckProduction,
      options.shouldCheckProduction ? "warn" : "info",
      options.shouldCheckProduction ? "PLAYPEN_PUBLIC_BASE_URL is unset; generated links will depend on forwarded Host headers." : "PLAYPEN_PUBLIC_BASE_URL is unset; request headers will determine generated links."
    );
  }

  let url;
  try {
    url = new URL(publicBaseURL);
  } catch {
    return check("public-base-url", false, "fail", "PLAYPEN_PUBLIC_BASE_URL is not a valid URL.");
  }

  if (options.shouldCheckProduction && !options.shouldAllowLocal) {
    if (url.protocol !== "https:") {
      return check("public-base-url", false, "fail", "PLAYPEN_PUBLIC_BASE_URL must use https for production.");
    }
    if (isPrivateHost(url.hostname)) {
      return check("public-base-url", false, "fail", "PLAYPEN_PUBLIC_BASE_URL must be a public host for production.");
    }
  }

  return check("public-base-url", true, "info", `PLAYPEN_PUBLIC_BASE_URL is ${url.href.replace(/\/$/, "")}.`);
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

function normalizedValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function check(name, isOK, level, message) {
  return {
    name,
    ok: isOK,
    level,
    message
  };
}

function printHelp() {
  console.log([
    "Usage: npm run doctor -- [--production] [--mode api|static] [--allow-local]",
    "",
    "Checks the current PlayPen hosted-service environment without touching the network.",
    "Use --production before deploying a public API host."
  ].join("\n"));
}

module.exports = {
  environmentReport,
  isPrivateHost,
  parseArguments
};
