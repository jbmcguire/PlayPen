const assert = require("assert");
const fs = require("fs");
const path = require("path");

const hostedRoot = path.resolve(__dirname, "..");

(() => {
  const markdownPath = path.join(hostedRoot, "example.md");
  const htmlPath = path.join(hostedRoot, "example.html");
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(markdown, /^# PlayPen Agent Artifact/m);
  assert.match(markdown, /npm run publish -- \.\/example\.md/);
  assert.match(html, /<title>PlayPen HTML Artifact<\/title>/);
  assert.match(html, /<main>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script/i);

  console.log("example artifacts ok");
})();
