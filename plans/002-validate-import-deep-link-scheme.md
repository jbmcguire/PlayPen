# Plan 002: Restrict `playpen://import` to http(s) hosted URLs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5857287..HEAD -- PlayPen/Sources/Views/ContentView.swift`
> If `ContentView.swift` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independent of 001, but both touch `ContentView.swift` — sequence after 001 to avoid merge churn)
- **Category**: security
- **Planned at**: commit `5857287`, 2026-06-12
- **Issue**: —

## Why this matters

`playpen://import?url=<url>` extracts the `url` query value and hands it straight
to `HostedPlaygroundService.resolve(_:)` with **no scheme validation**. Today the
practical blast radius is limited because `resolve` only accepts an
`HTTPURLResponse`, so `file://` and `data:` URLs fail late rather than
exfiltrating data. But relying on a downstream type check for a security boundary
is fragile: any future change to `resolve` (e.g. accepting cached/local
responses) would silently re-open local-file or `data:` import. Validating the
scheme at the deep-link boundary makes the contract explicit and defense-in-depth
cheap. This is a hardening change, not an active-exploit fix.

## Current state

- `PlayPen/Sources/Views/ContentView.swift` — `hostedURL(from:)` builds the URL
  passed to `resolve`. It validates the `playpen` scheme and `import` host of the
  *incoming* link, but returns the embedded URL **without checking its scheme**
  (around line 145):

```swift
private func hostedURL(from incomingURL: URL) -> URL? {
    guard incomingURL.scheme == "playpen",
          incomingURL.host == "import",
          let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false),
          let hostedURLString = components.queryItems?.first(where: { $0.name == "url" })?.value else {
        return nil
    }
    return URL(string: hostedURLString)
}
```

The caller `importHostedMirror(from:)` (around line 100) presents
`"This PlayPen link is missing a hosted mirror URL."` when `hostedURL(from:)`
returns `nil`. That existing error path is the right home for a rejected scheme.

**Repo conventions to honor**: macOS/iPadOS 27 only, newest APIs, no availability
fallbacks. Match the existing guard style in this function. Note that the sibling
`configureHostedService` already uses exactly this scheme check
(`serviceURL.scheme == "http" || serviceURL.scheme == "https"`) — mirror it for
consistency.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Generate project | `cd PlayPen && xcodegen` | exit 0 |
| Build (native) | `cd PlayPen && xcodebuild -project PlayPen.xcodeproj -scheme PlayPen -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=27.0' build` | `** BUILD SUCCEEDED **` |

> Requires Xcode beta with OS-27 SDKs. If unavailable here, that is a STOP
> condition for verification — do not lower the deployment target.

## Scope

**In scope**:
- `PlayPen/Sources/Views/ContentView.swift`

**Out of scope** (do NOT touch):
- `PlayPen/Sources/Hosting/HostedPlaygroundService.swift` — `resolve` stays as
  is; this plan adds an *upstream* guard, it does not change resolution.
- The `configure` deep-link path (plan 001).

## Git workflow

- Branch: `advisor/002-validate-import-deep-link-scheme`
- Commit style: conventional commits. Suggested:
  `fix: reject non-http(s) urls in playpen://import deep link`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a scheme guard to `hostedURL(from:)`

Build the candidate URL, then return it only if its scheme is `http` or `https`;
otherwise return `nil` so the existing error alert fires:

```swift
private func hostedURL(from incomingURL: URL) -> URL? {
    guard incomingURL.scheme == "playpen",
          incomingURL.host == "import",
          let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false),
          let hostedURLString = components.queryItems?.first(where: { $0.name == "url" })?.value,
          let candidateURL = URL(string: hostedURLString),
          candidateURL.scheme == "http" || candidateURL.scheme == "https" else {
        return nil
    }
    return candidateURL
}
```

**Verify**: `grep -n "candidateURL.scheme == \"http\"" PlayPen/Sources/Views/ContentView.swift` → 1 match.

### Step 2: Build

**Verify**: `cd PlayPen && xcodegen && xcodebuild -project PlayPen.xcodeproj -scheme PlayPen -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=27.0' build` → `** BUILD SUCCEEDED **`.

## Test plan

No native test target exists yet; do not add one here (keeps this S, not L).
Manual check for the PR description: `playpen://import?url=file:///etc/hosts` and
`playpen://import?url=data:text/html,<b>x</b>` both surface the
"missing a hosted mirror URL" alert and perform no network/file fetch, while a
normal `playpen://import?url=https://host.example/p/<id>` still imports.

If a `PlayPenTests` target already exists, add a unit test asserting
`hostedURL(from:)` returns `nil` for `file:`, `data:`, and `javascript:` embedded
URLs and non-`nil` for an `https:` URL.

## Done criteria

ALL must hold:

- [ ] `cd PlayPen && xcodegen && xcodebuild ... build` prints `** BUILD SUCCEEDED **`
- [ ] `grep -n "candidateURL.scheme" PlayPen/Sources/Views/ContentView.swift` returns the new guard
- [ ] `git status` shows only `ContentView.swift` modified (plus `plans/README.md`)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report if:

- `hostedURL(from:)` does not match the "Current state" excerpt (drift).
- `xcodebuild` cannot resolve the OS-27 SDK here — report; do not change targets.
- The change appears to need edits in `HostedPlaygroundService.swift`.

## Maintenance notes

- If `resolve` is ever extended to accept additional schemes (e.g. a custom
  bundled-host scheme), this guard is the single place to widen the allowlist —
  keep the security boundary here, at the deep-link entry, not deep in the
  network layer.
- Reviewer: confirm the rejected-scheme path reuses the existing user-facing
  error and doesn't crash on a malformed embedded URL string.
