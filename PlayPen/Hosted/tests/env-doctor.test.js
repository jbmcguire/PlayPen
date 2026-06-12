const assert = require("assert");
const { environmentReport, parseArguments } = require("../env-doctor");

(() => {
  assertLocalDefaults();
  assertProductionFilesystemFailures();
  assertProductionFilesystemSuccess();
  assertS3Failures();
  assertS3Success();
  assertStaticMode();
  console.log("env-doctor contract ok");
})()

function assertLocalDefaults() {
  const report = environmentReport({}, {});
  assert.equal(report.ok, true);
  assert.equal(report.mode, "api");
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 1);
  assert.equal(report.checks.find(check => check.name === "publish-token").level, "warn");
}

function assertProductionFilesystemFailures() {
  const report = environmentReport({
    PLAYPEN_STORAGE_DRIVER: "filesystem",
    PLAYPEN_PUBLIC_BASE_URL: "http://127.0.0.1:4177"
  }, {
    shouldCheckProduction: true
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(check => check.name === "filesystem-storage").ok, false);
  assert.equal(report.checks.find(check => check.name === "publish-token").ok, false);
  assert.equal(report.checks.find(check => check.name === "public-base-url").ok, false);
}

function assertProductionFilesystemSuccess() {
  const report = environmentReport({
    PLAYPEN_STORAGE_DRIVER: "filesystem",
    PLAYPEN_STORE_DIR: "/data/playpen-store",
    PLAYPEN_PUBLIC_BASE_URL: "https://playpen.example",
    PLAYPEN_PUBLISH_TOKEN: "secret"
  }, {
    shouldCheckProduction: true
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
}

function assertS3Failures() {
  const report = environmentReport({
    PLAYPEN_STORAGE_DRIVER: "s3",
    PLAYPEN_PUBLIC_BASE_URL: "https://playpen.example",
    PLAYPEN_PUBLISH_TOKEN: "secret"
  }, {
    shouldCheckProduction: true
  });
  assert.equal(report.ok, false);
  assert.match(report.checks.find(check => check.name === "s3-storage").message, /PLAYPEN_S3_BUCKET/);
}

function assertS3Success() {
  const report = environmentReport({
    PLAYPEN_STORAGE_DRIVER: "s3",
    PLAYPEN_S3_BUCKET: "playpen",
    PLAYPEN_S3_ACCESS_KEY_ID: "test-access-key",
    PLAYPEN_S3_SECRET_ACCESS_KEY: "test-secret-key",
    PLAYPEN_S3_ENDPOINT: "https://objects.example",
    PLAYPEN_PUBLIC_BASE_URL: "https://playpen.example",
    PLAYPEN_PUBLISH_TOKEN: "secret"
  }, {
    shouldCheckProduction: true
  });
  assert.equal(report.ok, true);
}

function assertStaticMode() {
  const options = parseArguments(["--static", "--production", "--allow-local"]);
  const report = environmentReport({
    PLAYPEN_PUBLIC_BASE_URL: "http://127.0.0.1:4177"
  }, options);
  assert.equal(report.ok, true);
  assert.equal(report.mode, "static");
  assert.equal(report.checks.some(check => check.name === "publish-token"), false);
}
