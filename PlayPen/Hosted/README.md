# PlayPen Hosted Mirror

Service for opening PlayPen HTML and Markdown playgrounds as shareable links.

## Local Check

Requires Node.js 22 or newer.

```sh
npm run check
npm test
npm run doctor
npm run demo
npm run smoke
npm run start
npm run verify -- --service http://127.0.0.1:4177
npm run preflight -- --service http://127.0.0.1:4177 --allow-local
npm run verify -- --service http://127.0.0.1:4177 --static
```

Open `http://127.0.0.1:4177/`, paste or import a playground, then create a mirror link. By default the local server stores records in `.playpen-store/` and returns short `/p/:id` links.

API-backed HTML playgrounds render through `/api/playgrounds/:id/render` inside
a sandboxed iframe with scripts enabled but without same-origin access to the
PlayPen host. Agents and reviewers can inspect the raw source through
`/api/playgrounds/:id/source` before opening the rendered artifact.

`npm run smoke` starts a throwaway local host with a publish token, runs
production preflight with local URLs allowed, and deletes the temporary store.
Use it when you want a quick end-to-end publish/read/verify check without
deploying.

`npm run demo` starts a temporary token-protected local host, publishes
`example.md` and `example.html` through the CLI, replaces one stable `/p/:id`
record, inspects metadata/source/manifest links, and prints a JSON handoff. Use
`npm run demo -- --keep-running` to leave the local host alive until Ctrl+C.

`npm run doctor -- --production` checks the current process environment without
touching the network. It catches deployment mistakes such as missing durable
storage, missing publish token, unsupported storage driver, or invalid public
base URL before you start the service. Use `preflight` after the host is live.

`.env.example` documents the supported environment variables. The service reads
environment variables from the process environment; source a local `.env` file
yourself or configure secrets in the host platform.

Publish and replace bodies are limited to 2 MB. Over-limit writes return
`413 Payload Too Large` with the advertised `maxPayloadBytes` value.
Malformed JSON and structurally invalid playground objects return
`400 invalid_payload` so agents can correct payload construction errors without
treating them as host failures.

`GET /api/health` reports the active storage driver and public base URL without
exposing filesystem paths, object-storage bucket names, endpoints, or
credential-shaped fields.
Set `PLAYPEN_PUBLIC_BASE_URL` in production so generated links use the public
origin. If it is unset, the service derives public links from
`X-Forwarded-Proto` and `X-Forwarded-Host`, then falls back to `Host`.
`GET /api/stats` reports content-free host totals: record count, storage bytes,
kind counts, and publish-date bounds.
`GET /api/playgrounds` returns a paginated metadata-only index of hosted records
for agents and native clients that need to mirror the host without downloading
every playground body.
`GET /.well-known/playpen-host.json` and `GET /api/capabilities` describe the
payload schema, supported routes, link formats, and native app deep links for
agents that need to discover the service contract.
Capabilities also advertise stable JSON error codes so agents can branch on
`playground_conflict`, `publish_token_required`, `payload_too_large`, and other
failure states without scraping human-readable messages.
`GET /openapi.json` and `GET /.well-known/openapi.json` expose the OpenAPI 3.1
contract for generated clients and agent tooling.
`GET /api/playgrounds/:id/meta` returns stable artifact metadata,
`GET /api/playgrounds/:id/manifest` returns an agent handoff document with
links, deep links, and digest-pinned inspect commands, and
`GET /api/playgrounds/:id/source` returns the raw source as non-executable text.
`GET /api/playgrounds/:id/render` returns HTML artifact content with a dedicated
sandbox CSP for the hosted viewer iframe.
Public read and inspect routes send read-only CORS headers so browser-based
agents can fetch metadata, source, capabilities, and OpenAPI from another
origin. Capabilities advertise this as `cors.publicRead`, and the verifier
checks the source route CORS and read-only `OPTIONS` behavior.
`PUT /api/playgrounds/:id` replaces a hosted record at a stable link and uses
the same publish token policy as publishing.
`DELETE /api/playgrounds/:id` removes a record and uses the same publish token
policy as publishing.

Agents can publish local files directly:

```sh
npm run publish -- ./example.html --service http://127.0.0.1:4177
npm run publish -- ./example.html --service http://127.0.0.1:4177 --json
npm run publish -- ./example.html --service http://127.0.0.1:4177 --id example-html --replace --json
```

Agents can also publish raw file bodies without wrapping content in JSON:

```sh
curl -sS -X POST 'http://127.0.0.1:4177/api/playgrounds?id=raw-html-demo&title=Raw%20HTML%20Demo' \
  -H 'content-type: text/html' \
  --data-binary @example.html
```

The command prints a hosted URL. If the API is unavailable, it prints a static
`#playground=` fragment URL instead, so a plain static host can still mirror the
artifact.

Pass `--replace --id <record-id>` to update an API-backed record while
preserving the same `/p/:id` link. Replace mode requires the API because static
fragment fallback links cannot update stable hosted records.
Plain `POST /api/playgrounds` is create-only when an ID is supplied; duplicate
IDs return `409 Conflict` so agents do not accidentally overwrite durable links.
Use `PUT /api/playgrounds/:id` or CLI `--replace --id <record-id>` for
intentional updates. The storage layer enforces create-only writes atomically
for filesystem storage and S3-compatible storage that honors conditional
`PUT` requests.

Pass `--json` when an agent needs a structured handoff containing `url`,
`recordURL`, `metaURL`, `manifestURL`, `sourceURL`, optional HTML-only
`renderURL`, `annotation`, `contentDigest`, `mode`, and fallback details.

Use `--annotation "..."` or the browser composer annotation field to attach a
short provenance, review, or agent handoff note to the hosted artifact.

Agents can inspect any PlayPen link without running the native app:

```sh
npm run inspect -- http://127.0.0.1:4177/p/example-id
npm run inspect -- http://127.0.0.1:4177/p/example-id --meta
npm run inspect -- http://127.0.0.1:4177/p/example-id --source
npm run inspect -- http://127.0.0.1:4177/p/example-id --expect-digest sha256-...
```

The inspect command accepts hosted viewer links, record JSON URLs, metadata
URLs, manifest URLs, source URLs, render URLs, and static `#playground=`
fallback links. It prints JSON by default, metadata-only JSON with `--meta`, or
raw source with `--source`. Use
`--expect-digest` to make the command fail when a mutable hosted record no
longer matches the digest an agent recorded earlier.

For HTML artifacts, publish results, metadata, and manifests include `renderURL`
for the sandboxed executable view. Agents should inspect `sourceURL` before
opening `renderURL`.

Raw publishes support `text/html`, `text/markdown`, and `text/plain`. For
`text/plain`, pass `kind=markdown` or `kind=html` as a query parameter or
`X-PlayPen-Kind` header when the content type is ambiguous.
Raw publishes can also pass `annotation=...` or `X-PlayPen-Annotation`.

When `PLAYPEN_PUBLISH_TOKEN` is set on the host, publishing requires that token.
Viewing `/p/:id`, reading metadata, manifests, and source stay public:

```sh
PLAYPEN_PUBLISH_TOKEN=secret npm run start
npm run publish -- ./example.html --service http://127.0.0.1:4177 --token secret
```

The browser composer also accepts the publish token. If no token is supplied, or
the API is unavailable on a static host, it still falls back to a static
`#playground=` link. If a real API host rejects the write with `401`, `409`,
`413`, or another explicit API error, the composer surfaces that error instead
of hiding it behind a fallback snapshot.

Hosted `/p/:id` links support `HEAD`, so agents can validate a shared link
without downloading the viewer shell. Existing records expose `ETag` and
`X-PlayPen-Content-Digest`; missing records return `404`.
The hosted viewer also shows Record JSON, Metadata, Manifest, and Raw source
links when a record-backed `/p/:id` page is open, and those links respect the
service base path for reverse-proxy or subpath deployments.

Use the verifier before trusting a deployed host:

```sh
npm run verify -- --service https://your-playpen-host.example --token secret
npm run verify -- --service https://your-static-playpen-host.example --static
```

API mode publishes and replaces a preflight record, checks raw file publishing,
then checks health, capabilities, OpenAPI, stats, `/p/:id`, record JSON,
manifest, metadata, list, and source routes, then deletes probe records. Pass
`--keep-record` when you want to inspect the generated URLs. Static mode checks
the viewer shell/assets and emits a `#playground=` link. Both modes output JSON
and include a verified hosted URL.

Use production preflight before calling a deployed API host ready:

```sh
npm run doctor -- --production
npm run preflight -- --service https://your-playpen-host.example \
  --token "$PLAYPEN_PUBLISH_TOKEN" \
  --require-public \
  --require-token
```

The preflight wraps the verifier and fails when public deployment gates are not
met, including non-HTTPS/private URLs, missing required publish token, failed
cleanup, or incomplete storage configuration.

Hosted viewer pages include an `Open in PlayPen` action that calls
`playpen://import?url=<hosted-link>`. The native app resolves that hosted link
and imports the playground into the local library.

The browser composer, inspection links, deep links, and routed assets derive API
URLs from the current service base path, so deployments mounted under a prefix
such as `/tools/mirror` continue to publish and inspect through that prefix.
The Node host accepts either stripped routes (`/api/...`, `/p/...`) or unstripped
prefixed routes when `PLAYPEN_PUBLIC_BASE_URL` contains a path, and it honors
`X-Forwarded-Prefix` when deriving public links from proxy headers.

Agents can also pass the API `recordURL`, `metaURL`, `sourceURL`, or a static
`#playground=` URL to `playpen://import?url=...`; the native app normalizes
public artifact URLs back to the hosted record before import.

Hosted `/p/:id` pages expose `Link`, `X-PlayPen-Record-URL`,
`X-PlayPen-Meta-URL`, `X-PlayPen-Manifest-URL`, `X-PlayPen-Source-URL`, and
HTML-only `X-PlayPen-Render-URL` headers so agents can discover the inspectable
artifact routes with `HEAD` before fetching rendered HTML.

Record, metadata, and source reads return strong `ETag` values derived from the
content digest and support `If-None-Match` conditional requests.

Hosted viewer pages also include `Use as Host`, which calls
`playpen://configure?service=<origin>` so PlayPen can publish to the same host
without rebuilding.

## Public Deploy

Deploy this directory as a Node service with persistent storage, or as a static site when fragment-only links are acceptable. The Node service supports filesystem storage for hosts with durable disks and S3-compatible object storage for serverless or container hosts without persistent local files.

Filesystem storage is the default:

```sh
PLAYPEN_STORAGE_DRIVER=filesystem
PLAYPEN_STORE_DIR=/data/playpen-store
```

S3-compatible storage keeps short `/p/:id` links durable without a mounted
volume. Use a provider that honors conditional `PUT` requests with
`If-None-Match: *` so create-only publishes cannot overwrite existing IDs.
It works with AWS S3, Cloudflare R2, MinIO, and similar APIs when that
precondition behavior is supported:

```sh
PLAYPEN_STORAGE_DRIVER=s3
PLAYPEN_S3_BUCKET=playpen
PLAYPEN_S3_REGION=auto
PLAYPEN_S3_ENDPOINT=https://accountid.r2.cloudflarestorage.com
PLAYPEN_S3_ACCESS_KEY_ID=...
PLAYPEN_S3_SECRET_ACCESS_KEY=...
PLAYPEN_S3_PREFIX=playgrounds
```

Use `.env.example` as a template only. Keep real publish tokens, object-storage
credentials, and deployment credentials in local environment variables or the
hosting provider's secret manager.

Set `PLAYPEN_S3_FORCE_PATH_STYLE=false` for virtual-hosted S3 buckets when no
custom endpoint is used. Custom endpoints default to path-style requests.

Container hosts can use the included `Dockerfile`. Mount persistent storage at
`/data`, set `PLAYPEN_PUBLIC_BASE_URL` to the public origin when available, and
expose port `4177`:

```sh
docker build -t playpen-hosted .
docker run --rm -p 4177:4177 -v playpen-data:/data \
  -e PLAYPEN_PUBLIC_BASE_URL=https://your-playpen-host.example \
  -e PLAYPEN_PUBLISH_TOKEN=secret \
  playpen-hosted
```

If the container runs behind a reverse proxy that sets forwarded headers, the
explicit public URL can be omitted, but setting it keeps generated links stable
across proxy changes.

Vercel static fallback example:

```sh
npx vercel . --prod --yes
```

For static-only deployments, verify with `--static` and use the emitted
`#playground=` URL shape. Short `/p/:id` links require the Node API plus durable
filesystem or S3-compatible storage.

After deployment, set `PLAYPEN_HOSTED_SERVICE_URL` in the app build settings to the public service URL. PlayPen will then publish records against `/api/playgrounds` and receive short `/p/:id` links. If that API is unavailable, the app and web composer fall back to encoded fragment links.
