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
  const smokePort = await openPort();
  const baseURL = `http://127.0.0.1:${smokePort}`;
  const storeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "playpen-smoke-"));
  const publishToken = "playpen-smoke-token";
  const smokeEnvironment = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(smokePort),
    PLAYPEN_PUBLIC_BASE_URL: "",
    PLAYPEN_PUBLISH_TOKEN: publishToken,
    PLAYPEN_STORAGE_DRIVER: "filesystem",
    PLAYPEN_STORE_DIR: storeDirectory
  };
  const serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: smokeEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const serverOutput = collectOutput(serverProcess);

  try {
    await waitForHealth(baseURL, serverProcess, serverOutput);
    const preflightProcessReport = await runNodeScript([
      "production-preflight.js",
      "--service",
      baseURL,
      "--token",
      publishToken,
      "--allow-local",
      "--require-public",
      "--require-token",
      "--id",
      `smoke-${Date.now()}`
    ], smokeEnvironment);

    if (preflightProcessReport.stdout.trim()) {
      console.log(preflightProcessReport.stdout.trim());
    }
    if (preflightProcessReport.status !== 0) {
      throw new Error([
        "Local smoke preflight failed.",
        preflightProcessReport.stderr.trim(),
        preflightProcessReport.stdout.trim()
      ].filter(Boolean).join("\n"));
    }
  } finally {
    await stopProcess(serverProcess);
    await fs.rm(storeDirectory, { recursive: true, force: true });
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
        "Hosted service exited before local smoke preflight.",
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
