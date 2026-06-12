# Security Policy

PlayPen is designed around public artifact inspection. Hosted playground links, metadata, and source routes are public by design. Publish, replace, and delete routes can be protected with `PLAYPEN_PUBLISH_TOKEN`.

## Supported Versions

This repository is currently a prototype/submission candidate. Security fixes should target the main development branch unless a release branch is created later.

## Reporting a Vulnerability

Please do not open a public issue for a sensitive vulnerability.

Preferred channel: use GitHub private vulnerability reporting or a private GitHub security advisory on the published repository. Before the repository is public, contact the repository owner privately and include `PlayPen security report` in the subject or message title.

Before a public release, maintainers should enable GitHub private vulnerability reporting or add a dedicated security email here.

Useful details:

- affected route or app surface
- reproduction steps
- expected impact
- whether credentials, hosted artifacts, or source routes are exposed unexpectedly

## Secret Handling

Never commit:

- `.env` files
- publish tokens
- S3/R2/MinIO credentials
- Apple signing identities or provisioning profiles
- deployment credentials
- private keys

Rotate any credential that appears in git history or logs.

## Hosted Service Expectations

- `POST /api/playgrounds`, `PUT /api/playgrounds/:id`, and `DELETE /api/playgrounds/:id` require a publish token when `PLAYPEN_PUBLISH_TOKEN` is set.
- `GET /p/:id`, `GET /api/playgrounds/:id`, `GET /api/playgrounds/:id/meta`, `GET /api/playgrounds/:id/manifest`, `GET /api/playgrounds/:id/source`, and HTML-only `GET /api/playgrounds/:id/render` remain public so agents and users can inspect or open shared artifacts.
- Do not host secrets or private customer data as playground content unless the deployment is intentionally private.
