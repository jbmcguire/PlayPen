# PlayPen Improvement Plan

Goals: HTML file viewing, in-document find/outline navigation, geolocation tagging,
iPad support via a single multiplatform target, iCloud sync via SwiftData + CloudKit.

## Platform baseline (hard constraint)

macOS 27 and iOS/iPadOS 27 ONLY. No older OS support, ever:

- No `#available` / `@available` fallbacks — use the newest APIs directly.
- Prefer current-generation APIs throughout: `WebPage`/`WebView` (not WKWebView),
  SwiftData (+ CloudKit), `NavigationSplitView`, `.findNavigator`, modern toolbar
  and scroll-edge-effect APIs, Liquid Glass design idioms.
- Deployment targets stay pinned at 27.0 for both destinations in project.yml.

## Phase 1 — Multiplatform (macOS + iPadOS)

First, because all later features should be built/tested on both platforms.

- `project.yml`: `supportedDestinations: [macOS, iOS]` with both deployment
  targets at 27.0, set `TARGETED_DEVICE_FAMILY`,
  move mac-only Info.plist keys (`NSPrincipalClass`) to platform-conditional settings,
  set a real development team (needed for CloudKit later; current signing is ad-hoc).
- `NavigationSplitView` and the `WebView`/`WebPage` API already work on iPadOS.
  Expected touch-ups: toolbar placements, keyboard avoidance around `TextEditor`,
  search placement on compact widths.
- Verify in iPad simulator.

## Phase 2 — iCloud sync (SwiftData + CloudKit)

Schema changes now, while the dataset is small.

### Done (schema is CloudKit-compatible; sync NOT yet enabled)

- [x] `Models.swift`: removed `@Attribute(.unique)` from `Tag.name`; every
  persisted property on `Project`/`Tag`/`Playground` now has a default value
  or is optional, as CloudKit requires.
- [x] `Models.swift`: all relationships are optional (`Project.playgrounds`,
  `Tag.playgrounds`, `Playground.tags` are `[...]? = []`; `Playground.project`
  was already `Project?`) — CloudKit rejects non-optional relationships at
  container creation, so call sites nil-coalesce instead.
- [x] Tag uniqueness is app logic: `TagEditorView.addTag()` normalizes
  (trim + lowercase) and fetch-or-creates — the single runtime `Tag` creation
  site (SampleData seeds already-normalized names once into an empty store).
- [x] Launch-time dedupe: `Tag.deduplicate(in:)` (Models.swift) merges Tags
  with identical names — repoints playgrounds to one canonical Tag, deletes
  extras — run in `PlayPenApp.init` right after container creation, before
  seeding. Idempotent, so future CloudKit merge conflicts self-heal on launch.
- [x] `SampleData.seedIfNeeded` is double-seed-proof: empty-store check plus a
  `UserDefaults` "SampleData.hasSeeded" flag (also set when a non-empty store
  is found, e.g. after a fresh device syncs down an existing library).

### Remaining — exact flip-on steps (requires real development team + paid account)

1. project.yml: replace the ad-hoc signing settings (`CODE_SIGN_IDENTITY: "-"`,
   `CODE_SIGN_STYLE: Manual`) with `CODE_SIGN_STYLE: Automatic` and
   `DEVELOPMENT_TEAM: <TEAMID>`.
2. project.yml: add the entitlements block below to the `PlayPen` target plus
   the iOS background mode, then run `xcodegen`:

   ```yaml
   entitlements:
     path: Generated/PlayPen.entitlements
     properties:
       com.apple.developer.icloud-services: [CloudKit]
       com.apple.developer.icloud-container-identifiers:
         - iCloud.com.boltsystem.PlayPen
       aps-environment: development
       com.apple.developer.aps-environment: development
   ```

   (`aps-environment` is the iOS push entitlement key;
   `com.apple.developer.aps-environment` is the macOS one. The single shared
   entitlements file needs both, or the Mac app never receives CloudKit
   remote-change pushes and degrades to launch/foreground polling.)

   and under `info.properties` (iOS picks it up; macOS ignores it):

   ```yaml
   UIBackgroundModes: [remote-notification]
   ```

3. `PlayPenApp.swift`: build the container with an explicit configuration:
   `ModelConfiguration(cloudKitDatabase: .automatic)` passed to
   `ModelContainer(for:configurations:)`.
4. CloudKit Console: deploy the development schema to production
   (CloudKit Console → iCloud.com.boltsystem.PlayPen → Deploy Schema Changes)
   before shipping; development devices auto-create the schema on first sync.
5. Test with two simulators/devices signed into one iCloud account.

## Phase 3 — HTML file viewing

- Add `kind` field to `Playground` (`markdown` | `html`, defaulted — CloudKit-safe).
- `.fileImporter` + drag-and-drop for `.html` files → HTML playgrounds.
- Detail view: HTML playgrounds render content directly via `WebPage` in Preview;
  editor mode shows HTML source.
- Default to blocking remote resource loads in previews; toggle later if needed.

## Phase 4 — Find & navigate

- `.findNavigator` on `TextEditor` for in-source find (⌘F), both platforms.
- Outline: parse headings via swift-markdown, jump-to-heading menu (toolbar popover
  on Mac, sheet on iPad), inject anchor IDs into rendered HTML, scroll preview via
  `WebPage`.
- Optional: extend list search to match content, not just titles.

## Phase 5 — Geolocation

- Optional `latitude`, `longitude`, `placeName` on `Playground` (nil defaults).
- "Tag with current location" button (CoreLocation,
  `NSLocationWhenInUseUsageDescription` on both platforms).
- MapKit map in detail view when location exists; sidebar "Map" section showing
  all geotagged playgrounds.

## Risks & notes

- CloudKit needs real signing + iCloud-signed-in devices — biggest setup friction.
- Phases 3–5 schema changes are additive optional fields, safe after CloudKit is on.
- XcodeGen is source of truth: edit project.yml and regenerate; never edit the
  Xcode project directly.
