const fs = require("fs/promises");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

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

  const demoPort = options.port || await openPort();
  const baseURL = `http://127.0.0.1:${demoPort}`;
  const storeDirectory = options.storeDirectory || await fs.mkdtemp(path.join(os.tmpdir(), "playpen-demo-"));
  const publishToken = options.publishToken || "playpen-demo-token";
  const demoEnvironment = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(demoPort),
    PLAYPEN_PUBLIC_BASE_URL: "",
    PLAYPEN_PUBLISH_TOKEN: publishToken,
    PLAYPEN_STORAGE_DRIVER: "filesystem",
    PLAYPEN_STORE_DIR: storeDirectory
  };
  const serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: demoEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const serverOutput = collectOutput(serverProcess);
  const shouldRemoveStore = !options.storeDirectory;

  try {
    await waitForHealth(baseURL, serverProcess, serverOutput);
    const demoReport = await runDemoFlow(baseURL, publishToken, demoEnvironment, options.idPrefix);
    console.log(JSON.stringify({
      ok: true,
      mode: "local-demo",
      serviceURL: `${baseURL}/`,
      storage: "filesystem",
      storeDirectory,
      publishAuthRequired: true,
      keepRunning: options.shouldKeepRunning,
      records: demoReport.records,
      checks: demoReport.checks,
      nextSteps: options.shouldKeepRunning ? [
        `Open ${demoReport.records.markdown.url}`,
        `Open ${demoReport.records.html.url}`,
        `Inspect ${demoReport.records.markdown.manifestURL}`,
        "Press Ctrl+C to stop the local demo host."
      ] : [
        "Rerun with --keep-running to leave the local host alive for browser or native-app walkthroughs."
      ]
    }, null, 2));

    if (options.shouldKeepRunning) {
      await waitForInterrupt();
    }
  } finally {
    await stopProcess(serverProcess);
    if (shouldRemoveStore) {
      await fs.rm(storeDirectory, { recursive: true, force: true });
    }
  }
}

function parseArguments(args) {
  const options = {
    idPrefix: `demo-${Date.now()}`,
    port: null,
    publishToken: "",
    shouldKeepRunning: false,
    shouldShowHelp: false,
    storeDirectory: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.shouldShowHelp = true;
      continue;
    }
    if (arg === "--id-prefix") {
      options.idPrefix = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--keep-running") {
      options.shouldKeepRunning = true;
      continue;
    }
    if (arg === "--port") {
      options.port = Number(requireValue(args, index, arg));
      if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
        throw new Error("--port must be an integer between 1 and 65535");
      }
      index += 1;
      continue;
    }
    if (arg === "--store") {
      options.storeDirectory = path.resolve(requireValue(args, index, arg));
      index += 1;
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

async function runDemoFlow(baseURL, publishToken, demoEnvironment, idPrefix) {
  const markdownID = `${idPrefix}-markdown`;
  const htmlID = `${idPrefix}-html`;
  const replacementDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "playpen-demo-replacement-"));
  const replacementPath = path.join(replacementDirectory, "replacement.md");
  const replacementContent = [
    "# Agent Artifact",
    "",
    "This stable PlayPen link was replaced during the runnable local demo."
  ].join("\n");
  try {
    await fs.writeFile(replacementPath, replacementContent, "utf8");

    const markdownPublish = await runJSONScript([
      "publish-file.js",
      "example.md",
      "--service",
      baseURL,
      "--token",
      publishToken,
      "--id",
      markdownID,
      "--title",
      "Agent Artifact",
      "--annotation",
      "Runnable demo: Markdown artifact for agent and human inspection.",
      "--json"
    ], demoEnvironment);
    assertAPIResult(markdownPublish, "Markdown publish");

    const markdownMeta = await runJSONScript([
      "inspect-link.js",
      markdownPublish.url,
      "--meta"
    ], demoEnvironment);
    assertEqual(markdownMeta.id, markdownID, "Markdown metadata ID");
    assertEqual(markdownMeta.annotation, markdownPublish.annotation, "Markdown metadata annotation");

    const markdownReplace = await runJSONScript([
      "publish-file.js",
      replacementPath,
      "--service",
      baseURL,
      "--token",
      publishToken,
      "--id",
      markdownID,
      "--title",
      "Agent Artifact",
      "--annotation",
      "Runnable demo: replaced stable Markdown artifact.",
      "--replace",
      "--json"
    ], demoEnvironment);
    assertAPIResult(markdownReplace, "Markdown replace");
    assertEqual(markdownReplace.url, markdownPublish.url, "Markdown stable URL after replace");

    const replacedSource = await runTextScript([
      "inspect-link.js",
      markdownReplace.url,
      "--source"
    ], demoEnvironment);
    assertEqual(replacedSource, replacementContent, "Markdown replaced source");

    const htmlPublish = await runJSONScript([
      "publish-file.js",
      "example.html",
      "--service",
      baseURL,
      "--token",
      publishToken,
      "--id",
      htmlID,
      "--title",
      "Hosted HTML Demo",
      "--annotation",
      "Runnable demo: HTML artifact with source inspection.",
      "--json"
    ], demoEnvironment);
    assertAPIResult(htmlPublish, "HTML publish");

    const htmlMeta = await runJSONScript([
      "inspect-link.js",
      htmlPublish.metaURL,
      "--meta"
    ], demoEnvironment);
    assertEqual(htmlMeta.id, htmlID, "HTML metadata ID");

    const markdownManifest = await getJSON(markdownReplace.manifestURL);
    if (markdownManifest.type !== "playpen.artifact" || markdownManifest.links?.source !== markdownReplace.sourceURL) {
      throw new Error("Markdown manifest did not expose the source link");
    }

    return {
      records: {
        markdown: markdownReplace,
        html: htmlPublish
      },
      checks: [
        "started token-protected local host",
        "published Markdown through CLI",
        "inspected Markdown metadata through CLI",
        "replaced Markdown through CLI while preserving /p/:id",
        "inspected replaced Markdown source through CLI",
        "published HTML through CLI",
        "inspected HTML metadata through CLI",
        "fetched artifact manifest with source link"
      ]
    };
  } finally {
    await fs.rm(replacementDirectory, { recursive: true, force: true });
  }
}

function assertAPIResult(result, label) {
  if (!result.ok || !result.didUseAPI || result.mode !== "api" || !result.url) {
    throw new Error(`${label} did not return an API-backed hosted link`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch`);
  }
}

function openPort() {
  return new Promise((resolve, reject) => {
    const probeServer = net.createServer();
    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", () => {
      const addressInfo = probeServer.address();
      probeServer.close(() => resolve(addressInfo.port));
    });
  });
}

function collectOutput(childProcess) {
  const output = { stdout: "", stderr: "" };
  childProcess.stdout.on("data", chunk => {
    output.stdout += chunk.toString();
  });
  childProcess.stderr.on("data", chunk => {
    output.stderr += chunk.toString();
  });
  return output;
}

async function waitForHealth(baseURL, serverProcess, serverOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error([
        "Hosted service exited before the local demo finished.",
        serverOutput.stderr.trim(),
        serverOutput.stdout.trim()
      ].filter(Boolean).join("\n"));
    }
    try {
      const healthResponse = await fetch(`${baseURL}/api/health`);
      if (healthResponse.ok) {
        return;
      }
    } catch {
    }
    await delay(100);
  }
  throw new Error([
    `Hosted service did not become healthy at ${baseURL}.`,
    serverOutput.stderr.trim(),
    serverOutput.stdout.trim()
  ].filter(Boolean).join("\n"));
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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

async function runJSONScript(args, environment) {
  const processReport = await runNodeScript(args, environment);
  if (processReport.status !== 0) {
    throw new Error([
      `${args[0]} failed.`,
      processReport.stderr.trim(),
      processReport.stdout.trim()
    ].filter(Boolean).join("\n"));
  }
  return JSON.parse(processReport.stdout);
}

async function runTextScript(args, environment) {
  const processReport = await runNodeScript(args, environment);
  if (processReport.status !== 0) {
    throw new Error([
      `${args[0]} failed.`,
      processReport.stderr.trim(),
      processReport.stdout.trim()
    ].filter(Boolean).join("\n"));
  }
  return processReport.stdout;
}

function runNodeScript(args, environment) {
  return new Promise(resolve => {
    const childProcess = spawn(process.execPath, args, {
      cwd: __dirname,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const scriptOutput = collectOutput(childProcess);
    childProcess.on("close", status => {
      resolve({
        status,
        stdout: scriptOutput.stdout,
        stderr: scriptOutput.stderr
      });
    });
  });
}

function waitForInterrupt() {
  return new Promise(resolve => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

function stopProcess(childProcess) {
  if (childProcess.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killTimer = setTimeout(() => {
      childProcess.kill("SIGKILL");
    }, 2_000);
    childProcess.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    childProcess.kill("SIGTERM");
  });
}

function printHelp() {
  console.log([
    "Usage: npm run demo -- [--keep-running] [--port PORT] [--store DIR] [--token TOKEN] [--id-prefix ID]",
    "",
    "Starts a temporary local PlayPen host, publishes Markdown and HTML example artifacts,",
    "replaces one stable record, inspects source/metadata/manifest links, and prints URLs.",
    "",
    "Use --keep-running to leave the local host alive until Ctrl+C for browser or native-app demos."
  ].join("\n"));
}
