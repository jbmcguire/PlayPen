# Plan 004: Specify the content-digest algorithm and fix the verifier's divergent annotation handling

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5857287..HEAD -- PlayPen/Hosted/server.js PlayPen/Hosted/inspect-link.js PlayPen/Hosted/verify-host.js PlayPen/Sources/Hosting/HostedPlaygroundService.swift`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt (contains a correctness fix)
- **Planned at**: commit `5857287`, 2026-06-12
- **Issue**: —

## Why this matters

The PlayPen content digest is the artifact's identity: it backs the `ETag`,
`If-None-Match` caching, the manifest's digest-pinned inspect command, and the
CLI's `--expect-digest` verification. It is reimplemented in **four** places —
the Node server, the inspect CLI, the host verifier, and the Swift app. Three of
them trim the annotation before hashing; **the verifier does not**. So a payload
whose annotation has leading/trailing whitespace produces one digest on the
server and a *different* digest in `verify-host.js`, which can make the verifier
reject a correctly-published record (or, worse, mask a real mismatch). This plan
fixes that divergence and writes a single canonical specification all four
implementations must follow, plus a conformance test so the implementations can't
silently drift again. There is no shared-code option without adding cross-language
machinery (out of proportion for a zero-dep repo), so the control is: one spec +
one test vector all implementations are checked against.

## Current state

The digest is `sha256_hex( [title, kind, content, (trimmed annotation if
non-empty)].join("\n") )`. Three implementations agree; the verifier diverges.

**`PlayPen/Hosted/server.js:508` — canonical behavior (trims):**

```js
function contentDigest(payload) {
  const digestParts = [payload.title, payload.kind, payload.content];
  const annotation = normalizedAnnotation(payload);   // trims; "" -> undefined
  if (annotation) {
    digestParts.push(annotation);
  }
  return crypto.createHash("sha256").update(digestParts.join("\n")).digest("hex");
}
// normalizedAnnotation (server.js:520): returns payload.annotation.trim() || undefined
```

**`PlayPen/Hosted/inspect-link.js:311` — agrees (trims via its own `normalizedAnnotation`).**

**`PlayPen/Sources/Hosting/HostedPlaygroundService.swift:229` — agrees (trims with `.whitespacesAndNewlines`).**

**`PlayPen/Hosted/verify-host.js:663` — DIVERGENT (no trim):**

```js
function contentDigest(payload) {
  const digestParts = [payload.title, payload.kind, payload.content];
  if (payload.annotation) {              // <-- truthy check, pushes raw value
    digestParts.push(payload.annotation); // <-- NOT trimmed
  }
  return crypto.createHash("sha256").update(digestParts.join("\n")).digest("hex");
}
```

For annotation `"  note  "`: server/inspect/Swift hash `"note"`; verifier hashes
`"  note  "` → different digest.

**Repo conventions to honor**: zero runtime dependencies (Node built-ins only);
tests are plain `node` scripts using `assert`, run via `npm test`. Docs live at
the repo root and under `docs/`. `AGENTS.md` is the agent-facing contract — a
spec doc fits naturally referenced from there.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax check | `cd PlayPen/Hosted && npm run check` | exit 0 |
| Tests | `cd PlayPen/Hosted && npm test` | all pass, exit 0 |
| Smoke | `cd PlayPen/Hosted && npm run smoke` | exit 0 |
| Native build (only if Swift touched) | `cd PlayPen && xcodegen && xcodebuild -project PlayPen.xcodeproj -scheme PlayPen -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=27.0' build` | `** BUILD SUCCEEDED **` |

## Scope

**In scope**:
- `PlayPen/Hosted/verify-host.js` (fix the divergent `contentDigest`)
- `docs/CONTENT_DIGEST.md` (create — the canonical spec + test vectors)
- `PlayPen/Hosted/tests/storage.test.js` **or** a new
  `PlayPen/Hosted/tests/content-digest.test.js` (add conformance test; see Step 3)
- `PlayPen/Hosted/package.json` (only if you add a new test file — wire it into
  the `test` and `check` scripts)
- `AGENTS.md` (add one line pointing at the spec)

**Out of scope** (do NOT touch):
- `server.js`, `inspect-link.js`, and `HostedPlaygroundService.swift` digest
  functions — they are already correct; changing them would alter every existing
  published record's digest. The fix is to bring the verifier **to** them, not
  the reverse.
- The digest formula itself (parts, order, separator, hash). Do **not** "improve"
  it — any change breaks every record already published anywhere.

## Git workflow

- Branch: `advisor/004-unify-content-digest`
- Commit style: conventional commits. Suggested:
  `fix: trim annotation in verifier digest to match server, add digest spec`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix the verifier to match canonical behavior

Edit `PlayPen/Hosted/verify-host.js`. Replace the divergent `contentDigest` so it
trims the annotation and treats an all-whitespace annotation as absent, exactly
like `server.js`:

```js
function normalizedAnnotation(payload) {
  if (typeof payload.annotation !== "string") {
    return undefined;
  }
  const annotation = payload.annotation.trim();
  return annotation || undefined;
}

function contentDigest(payload) {
  const digestParts = [payload.title, payload.kind, payload.content];
  const annotation = normalizedAnnotation(payload);
  if (annotation) {
    digestParts.push(annotation);
  }
  return crypto.createHash("sha256").update(digestParts.join("\n")).digest("hex");
}
```

(If a `normalizedAnnotation` already exists in `verify-host.js`, reuse it instead
of redeclaring — check with `grep -n "normalizedAnnotation" PlayPen/Hosted/verify-host.js` first.)

**Verify**: `cd PlayPen/Hosted && npm run check` → exit 0, and
`grep -n "const annotation = normalizedAnnotation(payload)" PlayPen/Hosted/verify-host.js` → 1 match.

### Step 2: Write the canonical spec

Create `docs/CONTENT_DIGEST.md` documenting the one true algorithm so every
implementation (and future port) has a single source of truth. It must state:

- **Inputs in order**: `title`, `kind`, `content`, then `annotation` **only if**
  it is a string that is non-empty after trimming leading/trailing whitespace;
  the trimmed value is what gets hashed.
- **Separator**: a single newline `\n` joining the parts.
- **Hash**: SHA-256 over the UTF-8 bytes of the joined string.
- **Output**: lowercase hex. The `ETag` / pinned form is `sha256-<hex>`.
- **A worked test vector** (so any implementation can self-check). Include at
  least: a payload with no annotation, and a payload whose annotation is
  `"  spaced  "` (must hash identically to one with annotation `"spaced"`).
  Compute the expected hex by running, in `PlayPen/Hosted`:
  `node -e "const c=require('crypto'); console.log(c.createHash('sha256').update(['T','markdown','C'].join('\n')).digest('hex'))"`
  and record the output as the expected digest for `{title:'T', kind:'markdown', content:'C', annotation: undefined}`. Do the same for the annotated vector
  (`['T','markdown','C','spaced'].join('\n')`).
- A list of the four implementation sites (the files above) with line references,
  and the rule: **change the formula here first, then all four, then the test
  vector.**

**Verify**: `test -f docs/CONTENT_DIGEST.md && grep -c "sha256" docs/CONTENT_DIGEST.md` → ≥1.

### Step 3: Add a conformance test

Add a Node test that pins the formula against the spec's vectors and asserts the
JS implementations agree. Create `PlayPen/Hosted/tests/content-digest.test.js`:

- `require` the digest from the modules if they export it; if they do **not**
  export `contentDigest` (likely — these are scripts), instead reimplement the
  canonical formula **once** in the test and assert it equals the hardcoded
  expected hex from the spec for both vectors (no-annotation and
  `"  spaced  "` → same as `"spaced"`). This pins the contract even though the
  production functions aren't importable.
- Assert explicitly that the whitespace-padded annotation and the trimmed
  annotation produce the **same** digest (the regression this plan fixes).

Model the file structure on `PlayPen/Hosted/tests/storage.test.js` (plain
`require("assert")`, top-level `(async () => {...})()` or synchronous asserts,
process exit on throw).

Then wire it into `package.json`:
- Add `&& node tests/content-digest.test.js` to the end of the `test` script.
- Add `&& node --check tests/content-digest.test.js` to the `check` script.

**Verify**: `cd PlayPen/Hosted && npm run check && npm test` → all pass, and the
output shows the new test executing.

### Step 4 (only if you want belt-and-suspanders on Swift — OPTIONAL, skip if uncertain)

The Swift implementation already matches. Do **not** modify it. If a
`PlayPenTests` target exists (`grep -n "Tests" PlayPen/project.yml`), you may add
a Swift test asserting `HostedPlaygroundService` digest equals the spec's
expected hex for the two vectors. If no test target exists, **skip this step** —
do not create a test target here (that is a separate, larger effort tracked in
`plans/README.md`).

**Verify** (only if attempted): native build succeeds (command in the table).

## Test plan

- New `tests/content-digest.test.js`: pins the canonical digest for a
  no-annotation vector and a whitespace-padded-annotation vector, and asserts
  padded == trimmed. This is the regression guard for the verifier bug.
- Existing `npm test` (storage, hosted-service, production-preflight, etc.) must
  continue to pass unchanged — they exercise the real publish/verify path with
  the now-consistent digest.
- Verification: `cd PlayPen/Hosted && npm test` → all pass including the new file.

## Done criteria

ALL must hold:

- [ ] `grep -n "payload.annotation)" PlayPen/Hosted/verify-host.js` no longer
      shows a raw untrimmed push in `contentDigest` (the truthy-on-raw-value
      pattern is gone)
- [ ] `docs/CONTENT_DIGEST.md` exists and contains the formula, a worked test
      vector, and the four implementation sites
- [ ] `PlayPen/Hosted/tests/content-digest.test.js` exists and runs under `npm test`
- [ ] `cd PlayPen/Hosted && npm run check && npm test && npm run smoke` all exit 0
- [ ] `AGENTS.md` references `docs/CONTENT_DIGEST.md`
- [ ] `git status` shows only in-scope files modified (plus `plans/README.md`)
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report if:

- Any of the four `contentDigest` excerpts don't match "Current state" (drift) —
  especially if `server.js`/`inspect-link.js`/Swift have themselves changed,
  because then "canonical" must be re-established before fixing the verifier.
- An existing test fails after Step 1 — that would mean the verifier's untrimmed
  behavior was actually load-bearing somewhere; report before proceeding.
- You find yourself tempted to change the digest formula (parts/order/separator/
  hash) — that is explicitly out of scope; STOP.

## Maintenance notes

- The spec doc is now the contract. A reviewer of any future digest change should
  require: spec updated first, then all four sites, then the test vector — in
  that order, in one PR.
- If the project later adds a shared JS module imported by server + CLI + verifier
  (collapsing three of the four sites into one), update `docs/CONTENT_DIGEST.md`
  to list the new single site; Swift will remain a separate port by necessity.
- Reviewer scrutiny: confirm the test's hardcoded expected hex was generated from
  the documented formula, not copied from a possibly-buggy implementation.
