# Plan 003: Harden public-link derivation against Host-header injection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5857287..HEAD -- PlayPen/Hosted/server.js PlayPen/Hosted/production-preflight.js`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5857287`, 2026-06-12
- **Issue**: —

## Why this matters

When `PLAYPEN_PUBLIC_BASE_URL` is not configured, the hosted service builds every
public link (record/meta/manifest/source URLs in JSON bodies, `Link` headers, and
the `/api/health` + `/api/capabilities` `publicBaseURL` field) from the request's
`x-forwarded-host` or `Host` header. Those headers are client-controlled. Behind
a misconfigured or permissive proxy, an attacker can set them to a domain they
control, so links the service hands back point at the attacker — a classic
host-header/cache-poisoning vector. The production preflight currently only
**warns** when `PLAYPEN_PUBLIC_BASE_URL` is unset, so a public deployment can pass
its readiness gate while still trusting attacker input. This plan (a) rejects
malformed forwarded hosts at the source and (b) makes `--require-public` fail
unless `PLAYPEN_PUBLIC_BASE_URL` is explicitly configured, which is the correct
posture for a real public host.

## Current state

### `PlayPen/Hosted/server.js`

`publicBaseURLForRequest` (around line 650) trusts the forwarded host as-is:

```js
function publicBaseURLForRequest(request) {
  if (configuredPublicBaseURL) {
    return configuredPublicBaseURL;
  }
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const hostHeader = forwardedHost || firstHeaderValue(request.headers.host);
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedPrefix = normalizedForwardedPrefix(firstHeaderValue(request.headers["x-forwarded-prefix"]));
  const proto = forwardedProto || "http";
  if (!hostHeader) {
    return listenBaseURL;
  }
  return normalizeBaseURL(`${proto}://${hostHeader}${forwardedPrefix}`);
}
```

Supporting helpers in the same file:

```js
function firstHeaderValue(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") {
    return "";
  }
  return rawValue.split(",")[0].trim();
}

function normalizeBaseURL(value) {
  const url = new URL(value);   // throws on clearly invalid input
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}
```

`listenBaseURL` is the safe, locally-derived fallback already used when no host
header is present. `normalizeBaseURL` will *throw* on grossly invalid input, but
accepts plenty of dubious hosts (e.g. embedded credentials, paths) and an
unhandled throw on a request path is itself a defect.

### `PlayPen/Hosted/production-preflight.js`

The configured-URL check (line 157) passes (`true`) even when the env var is
unset:

```js
function configuredPublicURLCheck() {
  if (!process.env.PLAYPEN_PUBLIC_BASE_URL) {
    return check("configured-public-url", true, "PLAYPEN_PUBLIC_BASE_URL is unset; forwarded headers or host headers will determine generated links.");
  }
  return publicURLCheck("configured-public-url", process.env.PLAYPEN_PUBLIC_BASE_URL, true);
}
```

Options are parsed earlier; `--require-public` sets `options.shouldRequirePublic = true`
(line 62-64). `runProductionPreflight(options)` (line 99) assembles `checks`,
including `configuredPublicURLCheck()` at line 102, and returns
`ok: checks.every(check => check.ok) && verifierReport.ok`. **`configuredPublicURLCheck`
currently takes no arguments** — you will thread `options` into it.

**Repo conventions to honor**: Zero runtime dependencies — use only Node
built-ins (`URL`, string methods). Match the existing functional style (small
named helpers, `check(name, isOK, message)` for preflight results). Tests are
plain `node` scripts using `assert`, run via `npm test`; there is no test
framework. The public read contract and CORS behavior must not change — see
`AGENTS.md` "Core Contract".

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax check | `cd PlayPen/Hosted && npm run check` | exit 0 |
| Full test suite | `cd PlayPen/Hosted && npm test` | all assertions pass, exit 0 |
| Smoke | `cd PlayPen/Hosted && npm run smoke` | exit 0 |

## Scope

**In scope**:
- `PlayPen/Hosted/server.js` (harden `publicBaseURLForRequest`)
- `PlayPen/Hosted/production-preflight.js` (make `--require-public` require the env var)
- `PlayPen/Hosted/tests/production-preflight.test.js` (add a regression test)

**Out of scope** (do NOT touch):
- The public read/inspect routes, CORS headers, or the `securityHeaders` /
  `renderedArtifactSecurityHeaders` constants — behavior must stay identical.
- `verify-host.js` and `env-doctor.js` — `env-doctor` already has its own
  `publicBaseURLCheck`; do not duplicate or move it.
- `openapi.json` — no route or response-shape change is introduced here.

## Git workflow

- Branch: `advisor/003-harden-public-base-url`
- Commit style: conventional commits. Suggested:
  `fix: reject malformed forwarded host and require configured public url in preflight`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a forwarded-host validator in `server.js`

Add a small helper that accepts only a syntactically valid `host` or `host:port`
(letters/digits/dot/hyphen, optional port; also allow bracketed IPv6). Place it
next to `firstHeaderValue`:

```js
function isValidForwardedHost(host) {
  if (!host || host.length > 255) {
    return false;
  }
  // host or host:port; bracketed IPv6 allowed. No spaces, slashes, '@', or control chars.
  return /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(:[0-9]{1,5})?$/.test(host);
}
```

**Verify**: `cd PlayPen/Hosted && node -e "const s=require('fs').readFileSync('server.js','utf8'); process.exit(s.includes('isValidForwardedHost')?0:1)"` → exit 0.

### Step 2: Use the validator in `publicBaseURLForRequest`

Fall back to `listenBaseURL` when the chosen host header is missing **or
invalid**, so a malformed forwarded host can never reach `normalizeBaseURL`:

```js
function publicBaseURLForRequest(request) {
  if (configuredPublicBaseURL) {
    return configuredPublicBaseURL;
  }
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const hostHeader = forwardedHost || firstHeaderValue(request.headers.host);
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedPrefix = normalizedForwardedPrefix(firstHeaderValue(request.headers["x-forwarded-prefix"]));
  const proto = forwardedProto === "https" ? "https" : "http";
  if (!isValidForwardedHost(hostHeader)) {
    return listenBaseURL;
  }
  return normalizeBaseURL(`${proto}://${hostHeader}${forwardedPrefix}`);
}
```

Note the `proto` tightening: only `https` forces https; any other value defaults
to `http` (prevents an injected `x-forwarded-proto` like `javascript`).

**Verify**: `cd PlayPen/Hosted && npm run check` → exit 0. Then
`cd PlayPen/Hosted && npm test` → all pass (existing reverse-proxy/prefix tests
must still pass, proving valid forwarded hosts still work).

### Step 3: Make `--require-public` require a configured public base URL

Thread `options` into `configuredPublicURLCheck` and fail the check when
`--require-public` is set but the env var is unset. Update the call site at
line 102.

```js
function configuredPublicURLCheck(options) {
  if (!process.env.PLAYPEN_PUBLIC_BASE_URL) {
    if (options.shouldRequirePublic) {
      return check("configured-public-url", false, "PLAYPEN_PUBLIC_BASE_URL must be set for a public deployment; otherwise client Host/X-Forwarded-Host headers determine generated links.");
    }
    return check("configured-public-url", true, "PLAYPEN_PUBLIC_BASE_URL is unset; forwarded headers or host headers will determine generated links.");
  }
  return publicURLCheck("configured-public-url", process.env.PLAYPEN_PUBLIC_BASE_URL, true);
}
```

And at the call site (line ~102), pass `options`:

```js
  const checks = [
    tokenCheck(options),
    storageConfigurationCheck(),
    configuredPublicURLCheck(options)
  ];
```

**Verify**: `cd PlayPen/Hosted && npm run check` → exit 0.

### Step 4: Add a regression test

In `tests/production-preflight.test.js`, add an assertion block modeled on the
existing `--require-public` test (around lines 46–53). With the local server
running and **no** `PLAYPEN_PUBLIC_BASE_URL` in the preflight env, assert that
`--require-public --allow-local` now fails the `configured-public-url` check:

```js
const requirePublicNoBaseURL = await runPreflight(["--service", baseURL, "--require-public", "--allow-local"], {
  PLAYPEN_STORE_DIR: storeDirectory
});
const requirePublicReport = JSON.parse(requirePublicNoBaseURL.stdout);
assert.notEqual(requirePublicNoBaseURL.status, 0);
assert.equal(requirePublicReport.ok, false);
assert.equal(requirePublicReport.checks.find(check => check.name === "configured-public-url").ok, false);
```

> `--allow-local` is required so the test isolates the *configured-public-url*
> failure from the unrelated localhost public-URL checks. Confirm `runPreflight`
> in this test file does not already inject `PLAYPEN_PUBLIC_BASE_URL` into the
> child env; if it does, override it to empty for this case.

**Verify**: `cd PlayPen/Hosted && npm test` → all pass, including the new
assertions.

### Step 5: Full verification

**Verify**: `cd PlayPen/Hosted && npm run check && npm test && npm run smoke` →
all exit 0.

## Test plan

- New assertions in `tests/production-preflight.test.js`: `--require-public`
  without `PLAYPEN_PUBLIC_BASE_URL` → preflight exits non-zero and the
  `configured-public-url` check is `ok: false`. Model after the existing
  `service-url-public` failure assertions in the same file.
- The existing reverse-proxy / `X-Forwarded-Prefix` tests in
  `tests/hosted-service.test.js` serve as the regression guard that **valid**
  forwarded hosts still produce correct links — they must continue to pass
  unchanged (do not edit them).
- Verification: `npm test` → all pass, including the new preflight assertions.

## Done criteria

ALL must hold:

- [ ] `cd PlayPen/Hosted && npm run check` exits 0
- [ ] `cd PlayPen/Hosted && npm test` exits 0; new preflight assertions present and passing
- [ ] `cd PlayPen/Hosted && npm run smoke` exits 0
- [ ] `grep -n "isValidForwardedHost" PlayPen/Hosted/server.js` returns the helper + its use (2+ matches)
- [ ] `grep -n "configuredPublicURLCheck(options)" PlayPen/Hosted/production-preflight.js` returns 1 match
- [ ] `git status` shows only the three in-scope files modified (plus `plans/README.md`)
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report if:

- `publicBaseURLForRequest` or `configuredPublicURLCheck` does not match the
  "Current state" excerpts (drift).
- Any **existing** test in `npm test` starts failing after Step 2 — that signals
  the forwarded-host regex is rejecting a host the reverse-proxy tests rely on;
  report rather than loosening the regex blindly.
- Implementing this appears to require changing CORS headers, route handlers, or
  `openapi.json`.

## Maintenance notes

- If IPv6 or non-ASCII (IDN) hosts must be supported behind a proxy later, widen
  `isValidForwardedHost` — it is the single chokepoint.
- Reviewer: confirm the `proto` change to `x-forwarded-proto === "https" ?
  "https" : "http"` doesn't break any deployment that relied on a non-standard
  proto value (none in-repo; document in the PR).
- The real production guidance remains "set `PLAYPEN_PUBLIC_BASE_URL`": this plan
  makes the preflight enforce that for `--require-public`, but the runtime
  validator is the belt-and-suspenders for deployments that don't.
