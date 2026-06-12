# PlayPen Improvement Plan

Goals: HTML file viewing, in-document find/outline navigation, annotation metadata,
iPad support via a single multiplatform target, iCloud sync via SwiftData + CloudKit.

Hosted-mirror MVP goal: make PlayPen submission-grade as open-source agent
artifact infrastructure. Agents and humans should be able to publish, inspect,
verify, and reopen HTML/Markdown playground artifacts through durable hosted
links, while the native Mac/iPad app acts as the local mirror/editor.

Stopping point: repo submission readiness is local and verifiable. It does not
include public deployment until an explicit host is approved, production secrets
are configured outside the repo, production preflight passes, and the native app
is pointed at that public host.

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

## Phase 5 — Annotations

- Optional annotation text on `Playground` for provenance, review notes, and
  agent handoff context without extra permission prompts.
- Detail view annotation editor near title/tags.
- Hosted mirror payloads preserve annotations so browser links, agents, and the
  native mirror share the same context.

## Phase 6 — Hosted mirror service

### Done (static service + native mirror metadata)

- [x] `Hosted/index.html`: hostable static mirror service. It reads
  `#playground=<base64url-json>` links, renders Markdown or sandboxed HTML, and
  can create links from pasted source or imported files without a backend.
- [x] `Hosted/server.js`: local/deployable Node host with `POST /api/playgrounds`,
  `GET /api/playgrounds/:id`, persistent filesystem records, and short `/p/:id`
  links.
- [x] `Hosted/tests/hosted-service.test.js`: API contract test for publish,
  fetch, CLI publishing, fragment fallback, short-link shell, routed assets,
  invalid payloads, and missing records.
- [x] `Hosted/publish-file.js`: agent-friendly CLI for publishing `.html` or
  `.md` files to any PlayPen host, with static fragment fallback when the API
  is unavailable.
- [x] `Hosted/publish-file.js`: `--replace --id <record-id>` updates an existing
  API-backed record while preserving the stable `/p/:id` link.
- [x] `Hosted/inspect-link.js`: agent-friendly CLI for inspecting hosted viewer,
  record, metadata, manifest, source, or static fragment URLs as JSON,
  metadata-only JSON, raw source, or digest verification without executing the
  artifact.
- [x] `Hosted/Dockerfile`: container deployment path with a persistent `/data`
  volume for hosts that can provide durable disk.
- [x] `Hosted/package.json`: declares Node.js 22+ so local, CI, and container
  hosted-service runs use the same modern runtime assumptions.
- [x] `Hosted/storage.js`: pluggable storage layer with default filesystem
  persistence plus S3-compatible object storage for durable short links on
  serverless/container hosts without local disks.
- [x] `GET /api/health`: exposes storage driver and public base URL so a deployed
  service can be checked before the app trusts it, without leaking filesystem
  paths, object-storage bucket names, endpoints, or credential-shaped fields.
- [x] Proxy-aware public URL derivation: `PLAYPEN_PUBLIC_BASE_URL` stays
  authoritative, and hosts behind reverse proxies can fall back to
  `X-Forwarded-Proto`, `X-Forwarded-Host`, and `Host`.
- [x] `GET /api/stats`: content-free host totals for record count, storage
  bytes, kind counts, and publish-date bounds.
- [x] `GET /api/playgrounds`: paginated metadata-only host index so agents and
  the native app can discover hosted records without downloading every source
  body.
- [x] `GET /.well-known/playpen-host.json` and `GET /api/capabilities`: expose
  the publish contract, link formats, payload schema, and native deep links for
  agents that discover the service dynamically.
- [x] `GET /openapi.json` and `GET /.well-known/openapi.json`: OpenAPI 3.1
  contract for generated clients and agent tooling.
- [x] `HEAD /p/:id`: validates that a record-backed hosted link exists without
  downloading the viewer shell, exposes digest/ETag headers for real records,
  and returns `404` for missing records.
- [x] `GET /api/playgrounds/:id/meta` and `GET /api/playgrounds/:id/source`:
  give agents stable metadata, digest, and raw non-executable source access
  without scraping the viewer page.
- [x] `GET /api/playgrounds/:id/manifest`: public agent handoff document with
  artifact metadata, inspectable links, native deep links, and digest-pinned CLI
  commands.
- [x] `DELETE /api/playgrounds/:id`: token-protected cleanup path for removing
  verifier probes or unwanted hosted records.
- [x] `PUT /api/playgrounds/:id`: token-protected replace path so agents and the
  native app can update a hosted record while preserving the shared `/p/:id`
  link.
- [x] Create-vs-replace safety: `POST /api/playgrounds` returns `409 Conflict`
  for duplicate IDs, so agents cannot accidentally overwrite a durable hosted
  link without using `PUT` or CLI `--replace`.
- [x] Storage-enforced create semantics: filesystem storage uses exclusive file
  creation and S3-compatible storage uses conditional `PUT` so duplicate-ID
  protection is enforced below the HTTP route.
- [x] Optional publish-token auth: public hosts can require
  `PLAYPEN_PUBLISH_TOKEN` for `POST /api/playgrounds` while keeping hosted
  links, metadata, and source publicly readable. The web composer, CLI, and
  native app can all send the token when configured.
- [x] `Hosted/verify-host.js`: deployment preflight that publishes a probe
  record and verifies health, capabilities, OpenAPI, stats, `/p/:id`, record
  JSON, metadata, and source routes before trusting a public host, then deletes
  the probe unless `--keep-record` is supplied. Static mode verifies the viewer
  shell/assets and emits a `#playground=` fallback link for static hosts.
- [x] `Hosted/app.js` and `Hosted/styles.css`: no-build service runtime and UI
  that can load hosted records, fragment payloads, or query payloads.
- [x] Hosted viewer inspection links: record-backed `/p/:id` pages expose direct
  Record JSON, Metadata, Manifest, and Raw source links for humans, using the same
  base-path-aware URLs that native import/configure deep links use.
- [x] Hosted annotations: native app, browser composer, CLI, JSON API, raw
  publishes, metadata, and verifier/preflight preserve annotation context.
- [x] `HostedPlaygroundService.swift`: app-side payload encoder, content digest,
  and service URL resolution. A bundled local service is used until
  `PlayPenHostedServiceURL` points at a public deployment.
- [x] Runtime hosted-service settings: the app can point at a public PlayPen host
  without rebuilding, while preserving the bundled fallback, and the health
  check now confirms the host index count.
- [x] Native hosted library browser: the app can list hosted records from the
  configured service, open public links, and import or sync a hosted record into
  the local SwiftData library.
- [x] `playpen://import?url=...` deep links: hosted pages can hand a mirror link
  back to the native app for local import.
- [x] `playpen://configure?service=...` deep links plus settings health check:
  hosted pages can configure PlayPen to publish back to that same host.
- [x] `Hosted/vercel.json`: static-host deployment config with clean URLs and
  security headers.
- [x] `Playground`: optional hosted mirror fields for id, URL, publish timestamp,
  and digest so local edits can be marked as needing re-publish.
- [x] Detail toolbar: publish/copy mirror link, open the current mirror, and share
  the published URL.
- [x] Detail toolbar: copy or open the public artifact manifest for API-backed
  hosted mirrors.
- [x] Detail toolbar: pull latest source from the hosted mirror back into the
  local playground, making the hosted service usable as the source of truth.
- [x] Submission-readiness docs: top-level README, open-source hygiene files,
  OpenAI/agent-tooling submission narrative, CI workflow, demo checklist, and
  deployment checklist position PlayPen as open-source agent artifact
  infrastructure.
- [x] `Hosted/production-preflight.js`: wraps verifier checks with production
  gates for public HTTPS links, token expectations, storage configuration, and
  probe cleanup.
- [x] `Hosted/smoke-local.js`: starts a temporary token-protected local host,
  runs production preflight with local URLs allowed, and cleans up the store so
  CI and agents can verify the full publish/read/inspect path without a public
  deployment.
- [x] `Hosted/env-doctor.js`: no-network deployment environment check for
  storage driver, durable filesystem/S3 settings, publish token, and public base
  URL before a host is started or uploaded.
- [x] `Hosted/example.md` and `Hosted/example.html`: runnable sample artifacts
  matching README/demo commands, with a test that keeps local publishing demos
  from drifting into missing-file failures.
- [x] `Hosted/demo-local.js`: runnable local demo proof that starts a
  token-protected host, publishes Markdown and HTML examples, replaces a stable
  `/p/:id`, inspects metadata/source/manifest links, and prints agent handoff
  URLs without deploying to a third-party host.
- [x] Public read CORS: metadata/source/capabilities/OpenAPI routes are
  browser-readable across origins, advertised in capabilities, and enforced by
  the verifier while write routes stay token-protected.
- [x] Viewer discovery headers: `/p/:id` exposes `Link` and `X-PlayPen-*`
  headers for record, metadata, source, OpenAPI, and capabilities discovery
  from a cheap `HEAD` request.
- [x] Artifact ETags: record, metadata, and source reads expose digest-derived
  `ETag` headers and support `If-None-Match` so agents can verify unchanged
  hosted artifacts without refetching bodies.
- [x] Raw file publishing: `POST /api/playgrounds` and
  `PUT /api/playgrounds/:id` accept `text/html`, `text/markdown`, and
  `text/plain` bodies with query/header metadata so agents can publish files
  without JSON wrapping, and the verifier exercises this path with a separate
  cleanup probe.
- [x] Payload limit contract: over-2 MB publish/replace bodies return
  `413 Payload Too Large` with `maxPayloadBytes` instead of a generic server
  error.
- [x] Machine-readable API errors: JSON error responses include stable `code`
  values so agents can branch on failures without scraping human-readable text.

### Local MVP stopping point

The hosted-mirror MVP is complete locally when:

- Node API and static fallback can publish/open HTML and Markdown links.
- Agents can publish, inspect, verify, and replace via CLI/OpenAPI without the
  native app.
- Users can open `/p/:id` links in a browser and import/configure them back into
  PlayPen.
- Native app can publish, list, import, sync, and pull hosted records.
- Filesystem storage is the default; S3-compatible storage is available and
  tested with mocks.
- Public reads stay public; publish/replace/delete are token-protected when
  configured.
- `npm run check`, `npm test`, `npm run smoke`, `npm run demo`, and
  `git diff --check` pass.
- Xcode simulator build passes when Swift/native project files are touched.
- No public deployment is attempted without approval.

That is the repo-submission stopping point. The broader hosted-service goal only
stops being active after an approved public HTTPS target is named, durable
storage and publish-token auth are configured there, production preflight passes
with `--require-public --require-token`, and the native app is pointed at that
public host.

The evidence checklist for this stopping point lives in
`docs/MVP_READINESS.md`.

### Remaining — public hosting flip-on steps

1. Choose an approved public HTTPS target and storage mode.
2. Deploy `PlayPen/Hosted/` as a Node API host when durable short `/p/:id`
   links are required.
3. Configure durable storage:
   - filesystem storage for hosts with persistent mounted disk
   - S3-compatible storage for serverless/container hosts without persistent
     local files
4. Set `PLAYPEN_PUBLIC_BASE_URL` to the approved public origin and configure
   `PLAYPEN_PUBLISH_TOKEN` through the host secret manager.
5. Run:

   ```sh
   cd PlayPen/Hosted
   npm run doctor -- --production
   npm run preflight -- --service https://your-playpen-host.example --token "$PLAYPEN_PUBLISH_TOKEN" --require-public --require-token
   ```

6. Set `PlayPenHostedServiceURL` in the app bundle/build settings, or configure
   the same public URL in the native app Hosted Service settings.
7. Use static-only deployment only as a fallback when encoded `#playground=`
   links are acceptable and short mutable API-backed links are not required.

### Deployment note

Public deployment was not attempted without explicit approval to upload
`PlayPen/Hosted/` to a third-party host using local credentials.

## Risks & notes

- CloudKit needs real signing + iCloud-signed-in devices — biggest setup friction.
- Phases 3–5 schema changes are additive optional fields, safe after CloudKit is on.
- Phase 6 supports short IDs when deployed with the Node host and persistent
  storage. Pure static hosts still fall back to embedding payloads in the URL.
- The current Node service can use filesystem storage or S3-compatible object
  storage; production deployment still needs one of those durable backends
  configured before short links should be trusted.
- XcodeGen is source of truth: edit project.yml and regenerate; never edit the
  Xcode project directly.
