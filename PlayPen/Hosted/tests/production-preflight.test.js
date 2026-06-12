const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const hostedRoot = path.resolve(__dirname, "..");
const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playpen-preflight-test-"));
const port = 6200 + Math.floor(Math.random() * 800);
const baseURL = `http://127.0.0.1:${port}`;
const serverProcess = spawn(process.execPath, ["server.js"], {
  cwd: hostedRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    PLAYPEN_STORE_DIR: storeDirectory
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
  await waitForURL(baseURL, () => serverOutput);

  const localPreflight = await runPreflight(["--service", baseURL, "--allow-local"], {
    PLAYPEN_STORE_DIR: storeDirectory
  });
  assert.equal(localPreflight.status, 0, localPreflight.stderr);
  const localReport = JSON.parse(localPreflight.stdout);
  assert.equal(localReport.ok, true);
  assert.equal(localReport.checks.find(check => check.name === "cleanup").ok, true);

  const publicPreflight = await runPreflight(["--service", baseURL, "--require-public"], {
    PLAYPEN_STORE_DIR: storeDirectory
  });
  assert.notEqual(publicPreflight.status, 0);
  const publicReport = JSON.parse(publicPreflight.stdout);
  assert.equal(publicReport.ok, false);
  assert.equal(publicReport.checks.find(check => check.name === "service-url-public").ok, false);
  assert.equal(publicReport.checks.find(check => check.name === "cleanup").ok, true);

  const finalListResponse = await fetch(`${baseURL}/api/playgrounds`);
  const finalList = await finalListResponse.json();
  assert.equal(finalList.total, 0);

  console.log("production-preflight contract ok");
})().catch(error => {
  console.error(serverOutput);
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  serverProcess.kill();
});

function runPreflight(args, environment) {
  return new Promise(resolve => {
    const preflightProcess = spawn(process.execPath, ["production-preflight.js", ...args], {
      cwd: hostedRoot,
      env: {
        ...process.env,
        ...environment
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    preflightProcess.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    preflightProcess.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    preflightProcess.on("close", status => {
      resolve({ status, stdout, stderr });
    });
  });
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
