# Plan 001: Require explicit user confirmation before a `playpen://configure` deep link changes the publish host

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5857287..HEAD -- PlayPen/Sources/Views/ContentView.swift`
> If `ContentView.swift` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5857287`, 2026-06-12
- **Issue**: —

## Why this matters

PlayPen registers a `playpen://` URL scheme. A `playpen://configure?service=<url>`
deep link **silently** overwrites the hosted-service URL that every future
publish, replace, and delete request is sent to, and only shows an informational
alert *after* the change is already stored. Because publish/replace/delete can
carry `PLAYPEN_PUBLISH_TOKEN`, a crafted link delivered through a webpage, chat
message, or email can reroute a user's authored artifacts **and their publish
token** to an attacker-controlled server without consent. The fix is to make the
host change an explicit, confirmable action: show the destination URL and require
the user to approve it before it is persisted. This closes a phishing surface
that matters now that the repo and scheme are public.

## Current state

- `PlayPen/Sources/Views/ContentView.swift` — owns deep-link dispatch and all
  related SwiftUI state. Relevant pieces:

Deep-link dispatch (around line 88):

```swift
private func handlePlayPenLink(_ incomingURL: URL) {
    guard incomingURL.scheme == "playpen" else { return }
    switch incomingURL.host {
    case "import":
        importHostedMirror(from: incomingURL)
    case "configure":
        configureHostedService(from: incomingURL)
    default:
        presentDeepLinkImportError("This PlayPen link is not supported.")
    }
}
```

The vulnerable handler (around line 131) — it validates only the scheme, then
**immediately persists** the override and shows an after-the-fact alert:

```swift
private func configureHostedService(from incomingURL: URL) {
    guard let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false),
          let serviceURLString = components.queryItems?.first(where: { $0.name == "service" })?.value,
          let serviceURL = URL(string: serviceURLString),
          serviceURL.scheme == "http" || serviceURL.scheme == "https" else {
        presentDeepLinkImportError("This PlayPen configure link is missing a valid service URL.")
        return
    }
    UserDefaults.standard.set(serviceURL.absoluteString, forKey: HostedPlaygroundService.serviceURLOverrideKey)
    deepLinkMessageTitle = "Hosted Service Configured"
    deepLinkMessage = "PlayPen will publish to \(serviceURL.absoluteString)."
    isShowingDeepLinkMessage = true
}
```

Existing SwiftUI state declarations (lines 16–21):

```swift
@State private var isShowingDeepLinkImportError = false
@State private var deepLinkImportErrorMessage = ""
@State private var isShowingDeepLinkMessage = false
@State private var deepLinkMessageTitle = ""
@State private var deepLinkMessage = ""
@State private var isImportingDeepLink = false
```

Existing alert modifiers on the view body (lines 63–70), for the pattern to match:

```swift
.alert("Couldn't Import Hosted Link", isPresented: $isShowingDeepLinkImportError) {
} message: {
    Text(deepLinkImportErrorMessage)
}
.alert(deepLinkMessageTitle, isPresented: $isShowingDeepLinkMessage) {
} message: {
    Text(deepLinkMessage)
}
```

The override key lives at `PlayPen/Sources/Hosting/HostedPlaygroundService.swift:77`:
`static let serviceURLOverrideKey = "HostedPlaygroundService.serviceURLOverride"`.

**Repo conventions to honor**: This app targets macOS/iPadOS 27 only and uses
the newest SwiftUI APIs with **no availability fallbacks** (deliberate, recorded
decision — do not add `if #available` guards). Match the existing `@State` +
`.alert(...)` style already in this file. Use a SwiftUI `confirmationDialog` or a
two-button `alert` with a destructive/confirm action — both are available on the
27 SDK; prefer `alert` with explicit buttons to match the file's existing
`.alert` usage.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Generate project | `cd PlayPen && xcodegen` | exit 0, regenerates `PlayPen.xcodeproj` |
| Build (native) | `cd PlayPen && xcodebuild -project PlayPen.xcodeproj -scheme PlayPen -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=27.0' build` | `** BUILD SUCCEEDED **` |

> The native app requires Xcode beta with the OS-27 SDKs. If `xcodebuild` reports
> the destination/SDK is unavailable in this environment, that is a STOP
> condition for verification — see STOP conditions; do not work around it by
> changing deployment targets.

## Scope

**In scope** (the only file you should modify):
- `PlayPen/Sources/Views/ContentView.swift`

**Out of scope** (do NOT touch):
- `PlayPen/Sources/Hosting/HostedPlaygroundService.swift` — the override key and
  resolution logic are correct; only the *gating* of when the override is written
  changes, and that lives in `ContentView`.
- The `import` deep-link path is handled in a separate plan (002). Do not change
  `importHostedMirror` or `hostedURL(from:)` here.
- Do not change the URL scheme registration in `PlayPen/project.yml`.

## Git workflow

- Branch: `advisor/001-confirm-configure-deep-link`
- Commit style: conventional commits (repo uses `feat:`/`fix:`/`chore:` — see
  `git log --oneline`). Suggested message:
  `fix: require confirmation before configure deep link changes publish host`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add pending-configuration state

Near the existing `@State` declarations (lines 16–21), add state to hold the
URL awaiting confirmation and to present a confirmation alert:

```swift
@State private var pendingServiceURL: URL?
@State private var isShowingConfigureConfirmation = false
```

**Verify**: `grep -n "pendingServiceURL" PlayPen/Sources/Views/ContentView.swift` → 2+ matches.

### Step 2: Change `configureHostedService` to stage, not commit

Rewrite `configureHostedService(from:)` so that on a valid link it **stores the
URL in `pendingServiceURL` and triggers the confirmation alert** instead of
writing to `UserDefaults`. Keep the existing validation guard (including the
`http`/`https` scheme check) and the existing error path unchanged:

```swift
private func configureHostedService(from incomingURL: URL) {
    guard let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false),
          let serviceURLString = components.queryItems?.first(where: { $0.name == "service" })?.value,
          let serviceURL = URL(string: serviceURLString),
          serviceURL.scheme == "http" || serviceURL.scheme == "https" else {
        presentDeepLinkImportError("This PlayPen configure link is missing a valid service URL.")
        return
    }
    pendingServiceURL = serviceURL
    isShowingConfigureConfirmation = true
}
```

**Verify**: `grep -n "UserDefaults.standard.set" PlayPen/Sources/Views/ContentView.swift`
→ the `serviceURLOverrideKey` write no longer appears inside `configureHostedService`
(it moves to Step 3's apply function).

### Step 3: Add an explicit apply function

Add a function that performs the persist + confirmation message only when the
user approves:

```swift
private func applyPendingServiceConfiguration() {
    guard let serviceURL = pendingServiceURL else { return }
    UserDefaults.standard.set(serviceURL.absoluteString, forKey: HostedPlaygroundService.serviceURLOverrideKey)
    pendingServiceURL = nil
    deepLinkMessageTitle = "Hosted Service Configured"
    deepLinkMessage = "PlayPen will publish to \(serviceURL.absoluteString)."
    isShowingDeepLinkMessage = true
}
```

**Verify**: `grep -n "applyPendingServiceConfiguration" PlayPen/Sources/Views/ContentView.swift` → 2 matches (definition + the button call added in Step 4).

### Step 4: Present a confirmation alert with the destination URL visible

Add an `.alert` modifier alongside the existing alerts (after the block at lines
67–70). It must show the destination host so the user sees where publishing will
go, with an explicit confirm button and a cancel that discards the pending URL:

```swift
.alert("Change Publish Destination?", isPresented: $isShowingConfigureConfirmation) {
    Button("Use This Service") { applyPendingServiceConfiguration() }
    Button("Cancel", role: .cancel) { pendingServiceURL = nil }
} message: {
    Text("PlayPen will send future publishes — including any publish token — to \(pendingServiceURL?.absoluteString ?? "this service"). Only continue if you trust this link.")
}
```

**Verify**: `grep -n "Change Publish Destination" PlayPen/Sources/Views/ContentView.swift` → 1 match.

### Step 5: Build

**Verify**: `cd PlayPen && xcodegen && xcodebuild -project PlayPen.xcodeproj -scheme PlayPen -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=27.0' build` → `** BUILD SUCCEEDED **`.

## Test plan

The native app currently has no test target (tracked separately in plan 003's
sibling concerns and in `plans/README.md`). Do **not** add a test target as part
of this plan — it would expand scope from S to L. Verification here is:

1. Build succeeds (Step 5).
2. Manual check, documented in the PR description (the reviewer reproduces):
   opening `playpen://configure?service=https://example.test/` now shows a
   "Change Publish Destination?" alert naming `https://example.test/`, and the
   override in `UserDefaults` is written **only** after tapping "Use This
   Service" — not on Cancel.

If a `PlayPenTests` target already exists by the time you run this (check
`PlayPen/project.yml` for a `Tests` target), add one unit test that calls a
testable seam around the staging logic and asserts `UserDefaults` is unchanged
until apply is invoked; otherwise skip and note it as deferred.

## Done criteria

ALL must hold:

- [ ] `cd PlayPen && xcodegen && xcodebuild ... build` prints `** BUILD SUCCEEDED **`
- [ ] `grep -n "UserDefaults.standard.set" PlayPen/Sources/Views/ContentView.swift` shows the override write only inside `applyPendingServiceConfiguration`, not inside `configureHostedService`
- [ ] `grep -n "Change Publish Destination" PlayPen/Sources/Views/ContentView.swift` returns 1 match
- [ ] `git status` shows only `PlayPen/Sources/Views/ContentView.swift` modified (plus `plans/README.md`)
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `configureHostedService` or `handlePlayPenLink` code does not match the
  "Current state" excerpts (the file has drifted).
- `xcodebuild` cannot resolve the OS-27 simulator/SDK in this environment —
  report that verification could not run locally; do **not** lower the deployment
  target or add availability fallbacks to make it build.
- Making the change appears to require editing `HostedPlaygroundService.swift` or
  `project.yml`.

## Maintenance notes

- If a settings UI later lets users change the hosted service, that path already
  has its own confirmation surface (`HostedServiceSettingsView`); this plan only
  hardens the *deep-link* entry point, which is the unattended one.
- A reviewer should confirm the Cancel button clears `pendingServiceURL` so a
  dismissed dialog cannot leave a stale URL that a later confirm would apply.
- Deferred out of scope: adding a trusted-host allowlist. Confirmation is the
  minimum viable fix; an allowlist is a larger product decision.
