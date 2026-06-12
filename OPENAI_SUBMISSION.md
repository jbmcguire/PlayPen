# OpenAI / Agent Tooling Submission

## Summary

PlayPen is open-source infrastructure for AI-generated artifacts. It lets agents and humans publish HTML or Markdown playgrounds to durable hosted links, inspect those artifacts through a browser-accessible service, and reopen them in a native Mac/iPad mirror for editing and sync.

The core idea is simple: agent outputs should not be trapped in chat history, screenshots, or local temp folders. They should become reproducible, inspectable, shareable artifacts with stable URLs and source-level transparency.

Public repository: https://github.com/jbmcguire/PlayPen

## Form Starter

- Project name: PlayPen
- Repository URL: https://github.com/jbmcguire/PlayPen
- License: MIT
- Category: agent tooling / developer infrastructure
- Current status: working prototype / submission candidate
- Primary audience: AI coding agents, developers, product/design reviewers, support, and QA teams
- Demo assets: `PlayPen/Marketing/screenshots` and `PlayPen/Marketing/share`
- Verification: hosted service check/test/smoke/demo pass locally; native app builds for iOS Simulator
- Remaining public-host gate: deploy to an approved host and run production preflight with `--require-public --require-token`

## Why This Matters for Agent Workflows

Codex-style workflows already produce useful intermediate products: visual QA pages, generated reports, dashboards, HTML prototypes, Markdown plans, review canvases, and implementation notes. Those outputs need a neutral artifact layer that supports:

- durable links agents and users can both open
- raw source inspection without scraping rendered pages
- metadata and content digests for verification
- CLI publishing from local workspaces
- OpenAPI discovery for generated clients
- verifier/preflight tooling before a host is trusted
- `AGENTS.md`-friendly repositories where agents can publish reproducible artifacts as part of their work

PlayPen provides that layer while keeping the native app as the local mirror/editor instead of the only source of truth.

## What Is Working Now

- Static hosted mirror links with `#playground=` fallback payloads
- Node hosted API with short `/p/:id` links
- Markdown and sandboxed HTML rendering
- Public read, metadata, manifest, source, stats, capabilities, OpenAPI, and hosted index routes
- Token-protected publish, replace, and delete routes
- Filesystem storage by default
- S3-compatible object storage adapter with mocked contract tests
- CLI file publishing, link inspection, source extraction, and digest verification
- Deployment verifier and production preflight
- Native SwiftUI app with hosted publishing, manifest handoff, hosted import, hosted library browsing, and pull-from-host sync
- Deep links for `playpen://import` and `playpen://configure`

## Why Open Source

Agent artifacts need trustworthy infrastructure. Open source lets teams inspect the hosted contract, self-host it, adapt storage and auth to their environment, and verify that public read/source behavior is intentional rather than accidental.

Open source also makes PlayPen useful as a reference pattern for agent-native apps: every important user action should have a parallel agent-accessible route, CLI, or contract.

## Who Benefits

- AI coding agents that need to publish artifacts during development
- developers reviewing generated HTML, Markdown, reports, or dashboards
- product/design teams sharing quick prototypes without a full app deployment
- support and QA teams preserving browser-reproducible evidence
- open-source maintainers who want generated artifacts to be inspectable and reusable

## What Remains

- Public deployment to an approved host
- Verification of a real public URL with `npm run preflight -- --require-public`
- Native app signing and distribution setup
- Fresh screenshots and demo video for submission
- Optional stronger auth models for private deployments
- Long-term hosted storage and retention policy decisions

## Program Claim

No public OpenAI free-membership, grant, or submission program has been verified in this repository snapshot. This document is written as a reusable submission narrative for an OpenAI/open-source/agent-tooling opportunity, not as a claim that a specific current public program exists.
