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

- `Models.swift`: remove `@Attribute(.unique)` from `Tag.name` (CloudKit doesn't
  support unique constraints) — replace with fetch-or-create when tagging.
  Every property needs a default value or to be optional.
- Entitlements via project.yml: iCloud container + CloudKit, push notifications,
  remote-notification background mode on iOS.
- `PlayPenApp.swift`: `ModelConfiguration(cloudKitDatabase: .automatic)`.
- Guard `SampleData.seedIfNeeded` against double-seeding when a second device syncs.
- Test with two simulators/devices on one iCloud account + CloudKit Console.
  Requires paid developer account.

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
