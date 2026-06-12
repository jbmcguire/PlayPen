# Agent Instructions

PlayPen is agent artifact infrastructure: a native Mac/iPad mirror app plus a hosted service for durable HTML and Markdown playground links.

## Core Contract

- Keep `PlayPen/Hosted` usable by agents without the native app.
- Preserve public read routes: `/p/:id`, `/api/playgrounds/:id`, `/api/playgrounds/:id/meta`, `/api/playgrounds/:id/manifest`, `/api/playgrounds/:id/source`, `/api/playgrounds`, `/api/health`, `/api/capabilities`, `/.well-known/playpen-host.json`, and `/openapi.json`.
- Preserve cross-origin browser readability for public read/inspect routes.
- Preserve token protection for publish, replace, and delete when `PLAYPEN_PUBLISH_TOKEN` is configured.
- Preserve static `#playground=` fallback links for static-only hosts or unavailable APIs.
- Do not deploy or upload `PlayPen/Hosted` to a third-party host without explicit approval and a named target.

## Commands

Hosted service:

```sh
cd PlayPen/Hosted
npm run check
npm test
npm run smoke
npm run demo
npm run start
```

With the local server running:

```sh
cd PlayPen/Hosted
npm run inspect -- http://127.0.0.1:4177/p/example-id --meta
npm run verify -- --service http://127.0.0.1:4177
```

Native app:

```sh
cd PlayPen
xcodegen
xcodebuild -project PlayPen.xcodeproj \
  -scheme PlayPen \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=27.0' \
  build
```

Production host gate:

```sh
cd PlayPen/Hosted
npm run preflight -- --service https://your-playpen-host.example --token "$PLAYPEN_PUBLISH_TOKEN" --require-public --require-token
```

## Secrets

Never commit `.env`, tokens, object-storage credentials, Apple signing secrets, deployment credentials, private keys, provisioning profiles, or generated user-state files.

Use `.env.example` files only as templates. Replace placeholder values through local environment variables or the deployment platform's secret manager.
