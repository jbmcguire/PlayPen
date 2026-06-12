# Contributing

Thanks for helping make PlayPen useful for agent and human artifact workflows.

## Development Setup

Hosted service:

```sh
cd PlayPen/Hosted
npm run check
npm test
npm run smoke
npm run start
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

The native target currently expects Xcode beta SDKs for macOS/iOS/iPadOS 27.

## Before Opening a PR

- Run `npm run check`, `npm test`, and `npm run smoke` in `PlayPen/Hosted`.
- Run `npm run demo` when changing CLI, verifier, sample artifact, or handoff behavior.
- Run the Xcode build locally when touching Swift, XcodeGen, app resources, or hosted app integration.
- Run `git diff --check`.
- Keep changes scoped to the feature or fix.
- Update README, API docs, OpenAPI, and demo/deployment docs when behavior changes.

## Secrets

Never commit:

- `.env` files
- API tokens
- object-storage credentials
- Apple signing identities, provisioning profiles, or team secrets
- deployment credentials
- private keys

Use local environment variables or your deployment platform's secret store.

## Coding Notes

- Preserve the hosted service contract for agents: public read/meta/source routes, token-protected publish/replace/delete routes, and static fallback links.
- Keep the native app usable as a local mirror of the hosted service.
- Keep `npm run publish`, `npm run inspect`, `npm run verify`, and `npm run smoke` usable for agent workflows without the native app.
- Prefer small, testable changes over broad refactors.
- If a change affects external routes, update `PlayPen/Hosted/openapi.json` and `verify-host.js`.

## Public Deployment

Do not deploy or upload `PlayPen/Hosted` to any third-party host from this repository without explicit approval and a named target.
