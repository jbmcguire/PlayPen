# MVP Readiness Audit

Last verified locally: 2026-06-12.

This audit defines the repo submission stopping point for the hosted-mirror goal.
It does not mark the public hosted-service goal complete; that still requires an
approved public HTTPS deployment and production preflight.

## True MVP

PlayPen is a local native mirror/editor plus a hosted artifact service. The MVP
is ready for repo submission when an agent can publish an HTML or Markdown
artifact, share a durable hosted URL, inspect the source and metadata without
executing the artifact, verify the host contract, and reopen the artifact in the
native app.

## Evidence Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Hosted API can publish HTML/Markdown records at `/p/:id` links | `PlayPen/Hosted/server.js`, `npm test`, `npm run smoke`, `npm run demo` | Verified locally |
| Hosted HTML playgrounds can run as playgrounds while remaining isolated | API-backed HTML records render through `/api/playgrounds/:id/render` with a sandbox CSP and iframe sandbox; publish, metadata, manifest, CLI, verifier, viewer `HEAD`, runtime, and hosted-service tests cover the contract | Verified locally |
| Browser composer works under reverse-proxy subpaths | Hosted runtime derives publish and inspection API URLs from the current service base path; runtime test covers prefixed deployments | Verified locally |
| Node host accepts prefixed reverse-proxy routes | Server strips configured public base paths for routing and honors `X-Forwarded-Prefix`; hosted-service contract covers both | Verified locally |
| Static fallback remains available for hosts without an API | `PlayPen/Hosted/index.html`, `npm test`, `npm run verify -- --static` path covered by tests | Verified locally |
| Agents can publish files from CLI | `PlayPen/Hosted/publish-file.js`, `npm test`, `npm run demo` | Verified locally |
| Agents can inspect metadata, manifest, render links, and raw source without executing artifacts | `PlayPen/Hosted/inspect-link.js`, public `/meta`, `/manifest`, `/render`, `/source` routes, `npm test` | Verified locally |
| OpenAPI/capabilities support generated clients and discovery | `PlayPen/Hosted/openapi.json`, `/.well-known/playpen-host.json`, `npm run check`, `npm test` | Verified locally |
| Publish, replace, and delete are token-protected when configured | `PLAYPEN_PUBLISH_TOKEN`, `npm test`, `npm run smoke` | Verified locally |
| Public read/source/meta routes remain public by design | CORS/read-route tests in `tests/hosted-service.test.js` and verifier output | Verified locally |
| Filesystem storage is default and S3-compatible storage is mocked | `PlayPen/Hosted/storage.js`, `tests/storage.test.js` | Verified locally |
| Duplicate IDs cannot accidentally overwrite existing hosted records | HTTP `409`, atomic filesystem create, conditional S3 `PUT`, `npm test` | Verified locally |
| API failures are machine-readable for agents | Stable JSON `code` values advertised in capabilities, `server.js`, `openapi.json`, and tests | Verified locally |
| Bad agent payloads fail as client errors | Malformed JSON and structurally invalid playground objects return `400 invalid_payload`, covered by hosted-service contract tests | Verified locally |
| API write rejections are not hidden behind fallback links | CLI, browser composer, and native app surface explicit API errors while preserving fallback for static/unavailable hosts | Verified locally |
| Native app mirrors the hosted service | `HostedPlaygroundService.swift`, hosted library/settings views, deep-link handlers, iOS simulator build | Verified locally |
| Native imports preserve the shareable hosted link | API record/meta/manifest/source imports canonicalize back to `/p/:id` before storing local mirror metadata | Verified locally |
| Static fallback imports are not treated as mutable API records | Native publish only uses `PUT` for API-backed hosted URLs; static snapshots publish as new API creates when a service is configured or remain static fallback | Verified locally |
| Location sharing is removed; annotations carry context instead | Deleted location/map sources, annotation fields in model/native/hosted payloads | Verified locally |
| Open-source hygiene is present | `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.gitignore`, `.env.example` | Present |
| Submission narrative positions PlayPen as agent infrastructure | `OPENAI_SUBMISSION.md`, top-level `README.md`, `PRODUCT.md` | Present |
| CI checks hosted service realistically | `.github/workflows/ci.yml` runs check, doctor, tests, smoke, and demo on Node 22 | Present |

## Verification Commands

Run these before claiming local MVP readiness:

```sh
cd PlayPen/Hosted
npm run check
npm test
npm run smoke
npm run demo
```

From the repo root:

```sh
git diff --check
```

When Swift or project files change, also run an iOS simulator build from Xcode or
XcodeBuildMCP. The current project uses macOS/iOS/iPadOS 27 SDKs, so GitHub CI
does not attempt native builds until public runners support the required SDKs.

## Public Completion Gate

The broader hosted-service goal is complete only after:

- a public HTTPS target is explicitly approved
- durable filesystem or S3-compatible storage is configured there
- `PLAYPEN_PUBLISH_TOKEN` is configured through the host secret manager
- `npm run doctor -- --production` passes for that environment
- production preflight passes against the final public URL:

  ```sh
  cd PlayPen/Hosted
  npm run preflight -- --service https://your-playpen-host.example --token "$PLAYPEN_PUBLISH_TOKEN" --require-public --require-token
  ```

- the native app is configured to that public URL and can publish/open/import
  from it

No public deployment should be attempted without approval and a named target.
