const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const hostedRoot = path.resolve(__dirname, "..");
const appScript = fs.readFileSync(path.join(hostedRoot, "app.js"), "utf8");

function loadApp(href, fetchImplementation = null) {
  const elementByID = new Map();
  const windowLocation = new URL(href);
  const context = {
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    crypto: {
      randomUUID: () => "runtime-test-record"
    },
    document: {
      createElement: tagName => createElement(tagName),
      getElementById(id) {
        if (!elementByID.has(id)) {
          elementByID.set(id, createElement(id));
        }
        return elementByID.get(id);
      }
    },
    fetch: fetchImplementation || (async () => ({
      ok: true,
      json: async () => ({
        version: 1,
        id: "runtime-test-record",
        title: "Runtime Test",
        kind: "markdown",
        annotation: "Runtime annotation",
        content: "# Runtime Test",
        publishedAt: "2026-06-12T00:00:00.000Z"
      })
    })),
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    },
    window: {
      location: windowLocation,
      addEventListener() {},
      setTimeout() {}
    }
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(appScript, context);
  return {
    context,
    element: id => elementByID.get(id)
  };
}

function createElement(id) {
  return {
    id,
    children: [],
    hidden: false,
    href: "#",
    textContent: "",
    value: "",
    files: [],
    classList: {
      toggle() {}
    },
    addEventListener() {},
    append(child) {
      this.children.push(child);
    },
    click() {},
    replaceChildren() {
      this.children = [];
    },
    setAttribute(name, value) {
      this[name] = value;
    }
  };
}

(async () => {
{
  const app = loadApp("https://playpen.example/p/root-record");
  assert.equal(app.context.playgroundIDFromPath(), "root-record");
  assert.equal(app.context.serviceBaseURL(), "https://playpen.example");
  assert.equal(app.context.recordEndpointURL("root-record"), "https://playpen.example/api/playgrounds/root-record");
  assert.equal(app.context.renderEndpointURL("root-record"), "https://playpen.example/api/playgrounds/root-record/render");
  assert.equal(new URL(app.context.openInPlayPenURL()).searchParams.get("url"), "https://playpen.example/p/root-record");
  assert.equal(new URL(app.context.configurePlayPenURL()).searchParams.get("service"), "https://playpen.example");
  app.context.updateInspectionLinks();
  app.context.renderPayload({
    version: 1,
    id: "root-record",
    title: "Root Record",
    kind: "markdown",
    annotation: "Visible annotation",
    content: "# Root Record",
    publishedAt: "2026-06-12T00:00:00.000Z"
  });
  assert.equal(app.element("annotation").hidden, false);
  assert.equal(app.element("annotation").textContent, "Visible annotation");
  assert.equal(app.element("record-json").href, "https://playpen.example/api/playgrounds/root-record");
  assert.equal(app.element("metadata-link").href, "https://playpen.example/api/playgrounds/root-record/meta");
  assert.equal(app.element("manifest-link").href, "https://playpen.example/api/playgrounds/root-record/manifest");
  assert.equal(app.element("source-link").href, "https://playpen.example/api/playgrounds/root-record/source");
  assert.equal(app.element("record-json").hidden, false);
}

{
  const app = loadApp("https://playpen.example/p/html-record");
  app.context.renderPayload({
    version: 1,
    id: "html-record",
    title: "HTML Record",
    kind: "html",
    content: "<button onclick=\"document.body.dataset.clicked = 'yes'\">Run</button><script>document.body.dataset.ready = 'yes'</script>",
    publishedAt: "2026-06-12T00:00:00.000Z"
  });
  const [iframe] = app.element("preview-panel").children;
  assert.equal(iframe.sandbox, "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
  assert.doesNotMatch(iframe.sandbox, /allow-same-origin/);
  assert.equal(iframe.src, "https://playpen.example/api/playgrounds/html-record/render");
  assert.equal(iframe.srcdoc, undefined);
}

{
  const app = loadApp("https://playpen.example/tools/mirror/p/subpath-record");
  assert.equal(app.context.playgroundIDFromPath(), "subpath-record");
  assert.equal(app.context.serviceBaseURL(), "https://playpen.example/tools/mirror");
  assert.equal(app.context.recordEndpointURL("subpath-record"), "https://playpen.example/tools/mirror/api/playgrounds/subpath-record");
  assert.equal(app.context.renderEndpointURL("subpath-record"), "https://playpen.example/tools/mirror/api/playgrounds/subpath-record/render");
  assert.equal(app.context.publishEndpointURL(), "https://playpen.example/tools/mirror/api/playgrounds");
  assert.equal(new URL(app.context.openInPlayPenURL()).searchParams.get("url"), "https://playpen.example/tools/mirror/p/subpath-record");
  assert.equal(new URL(app.context.configurePlayPenURL()).searchParams.get("service"), "https://playpen.example/tools/mirror");
  app.context.updateInspectionLinks();
  assert.equal(app.element("record-json").href, "https://playpen.example/tools/mirror/api/playgrounds/subpath-record");
  assert.equal(app.element("metadata-link").href, "https://playpen.example/tools/mirror/api/playgrounds/subpath-record/meta");
  assert.equal(app.element("manifest-link").href, "https://playpen.example/tools/mirror/api/playgrounds/subpath-record/manifest");
  assert.equal(app.element("source-link").href, "https://playpen.example/tools/mirror/api/playgrounds/subpath-record/source");
}

{
  let capturedURL = "";
  let capturedOptions = {};
  const app = loadApp("https://playpen.example/tools/mirror/index.html", async (url, options) => {
    capturedURL = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({
        id: "subpath-publish-record",
        url: "https://playpen.example/tools/mirror/p/subpath-publish-record",
        publishedAt: "2026-06-12T00:00:00.000Z",
        contentDigest: "abc123"
      })
    };
  });
  const result = await app.context.publishPayload({
    version: 1,
    id: "subpath-publish-record",
    title: "Subpath Publish",
    kind: "markdown",
    content: "# Subpath Publish",
    publishedAt: "2026-06-12T00:00:00.000Z"
  });
  assert.equal(capturedURL, "https://playpen.example/tools/mirror/api/playgrounds");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(result.url, "https://playpen.example/tools/mirror/p/subpath-publish-record");
}

{
  const app = loadApp("https://playpen.example/tools/mirror/index.html#playground=abc");
  assert.equal(app.context.playgroundIDFromPath(), null);
  assert.equal(app.context.serviceBaseURL(), "https://playpen.example/tools/mirror");
  assert.equal(new URL(app.context.configurePlayPenURL()).searchParams.get("service"), "https://playpen.example/tools/mirror");
  app.context.updateInspectionLinks();
  assert.equal(app.element("record-json").hidden, true);
  assert.equal(app.element("metadata-link").hidden, true);
  assert.equal(app.element("manifest-link").hidden, true);
  assert.equal(app.element("source-link").hidden, true);
}

{
  const app = loadApp("https://playpen.example/", async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({
      error: "Publish token required",
      code: "publish_token_required"
    })
  }));
  await assert.rejects(
    () => app.context.publishPayload({
      version: 1,
      id: "runtime-test-record",
      title: "Runtime Test",
      kind: "markdown",
      content: "# Runtime Test",
      publishedAt: "2026-06-12T00:00:00.000Z"
    }),
    error => {
      assert.equal(error.status, 401);
      assert.equal(error.shouldUseStaticFallback, false);
      assert.match(error.message, /publish_token_required/);
      return true;
    }
  );
}

{
  const app = loadApp("https://playpen.example/", async () => ({
    ok: false,
    status: 404,
    text: async () => "Not found"
  }));
  await assert.rejects(
    () => app.context.publishPayload({
      version: 1,
      id: "runtime-test-record",
      title: "Runtime Test",
      kind: "markdown",
      content: "# Runtime Test",
      publishedAt: "2026-06-12T00:00:00.000Z"
    }),
    error => {
      assert.equal(error.status, 404);
      assert.equal(error.shouldUseStaticFallback, true);
      return true;
    }
  );
}

console.log("hosted app runtime ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
