# Deployment Checklist

PlayPen hosted links are not complete until a real public host has been deployed and verified. Do not deploy or upload `PlayPen/Hosted` to a third-party host without explicit approval and a named target.

Use [PlayPen/Hosted/.env.example](../PlayPen/Hosted/.env.example) as a local template. Never commit a filled `.env` file.

The Node API deployment requires Node.js 22 or newer. The included Dockerfile
uses `node:22-alpine`, and CI runs hosted checks on Node 22.

## Predeployment Approval Packet

Before any third-party upload, record these decisions:

- approved target host and account
- deployment mode: Node API or static fallback
- durable storage mode: filesystem volume or S3-compatible object storage
- public base URL
- publish-token owner and rotation path
- where secrets will be stored
- rollback owner and rollback command

Do not place tokens, object-storage keys, Apple signing secrets, or deployment
credentials in the repository, docs, CI logs, screenshots, or demo artifacts.

## Choose Hosting Mode

### Static fallback

Use this when encoded `#playground=` links are acceptable and short mutable `/p/:id` links are not required.

```sh
cd PlayPen/Hosted
npm run verify -- --service https://your-static-host.example --static
```

### Node API with filesystem storage

Use this when the platform provides durable mounted disk.

Required environment:

```sh
PLAYPEN_STORAGE_DRIVER=filesystem
PLAYPEN_STORE_DIR=/data/playpen-store
PLAYPEN_PUBLIC_BASE_URL=https://your-playpen-host.example
PLAYPEN_PUBLISH_TOKEN=<secret>
```

### Node API with S3-compatible storage

Use this for serverless/container hosts without durable local disk.
The object store must honor conditional `PUT` requests with `If-None-Match: *`
so create-only publishes return `409 Conflict` instead of overwriting existing
stable IDs.

Required environment:

```sh
PLAYPEN_STORAGE_DRIVER=s3
PLAYPEN_S3_BUCKET=<bucket>
PLAYPEN_S3_REGION=<region-or-auto>
PLAYPEN_S3_ACCESS_KEY_ID=<secret>
PLAYPEN_S3_SECRET_ACCESS_KEY=<secret>
PLAYPEN_S3_ENDPOINT=<optional-custom-endpoint>
PLAYPEN_S3_PREFIX=playgrounds
PLAYPEN_PUBLIC_BASE_URL=https://your-playpen-host.example
PLAYPEN_PUBLISH_TOKEN=<secret>
```

## Preflight

Before deploying, run the local smoke check:

```sh
cd PlayPen/Hosted
npm run doctor -- --production
npm run smoke
```

Run before trusting a deployed host:

```sh
cd PlayPen/Hosted
npm run preflight -- --service https://your-playpen-host.example --token "$PLAYPEN_PUBLISH_TOKEN" --require-public --require-token
```

The preflight publishes, replaces, checks raw file publishing, reads, lists, inspects source/meta/manifest, checks the viewer, verifies OpenAPI/capabilities/stats, and deletes probe records.

A public deployment is not considered ready until this command passes against
the final public HTTPS URL with `--require-public` and `--require-token`.

## App Configuration

After deployment:

1. Set `PLAYPEN_HOSTED_SERVICE_URL` in build settings, or configure the runtime Hosted Service URL in the app.
2. Add the publish token in Hosted Service settings if the host requires one.
3. Check service health from the app.
4. Open Hosted Library and confirm the host index loads.
5. Publish a playground and verify the `/p/:id` link opens in a browser.

## Secrets

Never commit `.env`, publish tokens, object-storage credentials, Apple signing credentials, deployment credentials, provisioning profiles, or private keys. Use the deployment platform's secret manager.

## Rollback

For API deployments:

1. Stop new writes by removing or rotating `PLAYPEN_PUBLISH_TOKEN`.
2. Keep read routes online if hosted artifacts must remain available.
3. Roll back the service image or static files.
4. Run `npm run preflight` again before re-enabling publishing.
