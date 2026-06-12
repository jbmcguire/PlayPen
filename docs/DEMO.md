# Demo Checklist

Use this checklist to show PlayPen as agent artifact infrastructure.

## Local Hosted Service

1. Run the automated local proof:

   ```sh
   cd PlayPen/Hosted
   npm run demo
   ```

   For a live browser/native-app walkthrough, keep the local service running:

   ```sh
   npm run demo -- --keep-running
   ```

2. Or start the hosted mirror manually:

   ```sh
   cd PlayPen/Hosted
   PLAYPEN_STORE_DIR=/tmp/playpen-demo-store npm run start
   ```

3. Open `http://127.0.0.1:4177`.

4. Create a Markdown playground:

   ```markdown
   # Agent Artifact

   This page was published as a durable PlayPen mirror link.
   ```

5. Publish it from the browser composer and open the `/p/:id` link.

6. Inspect the host as an agent:

   ```sh
   curl -sS http://127.0.0.1:4177/api/playgrounds
   curl -sS http://127.0.0.1:4177/api/playgrounds/<id>/meta
   curl -sS http://127.0.0.1:4177/api/playgrounds/<id>/source
   ```

7. Publish from a local file:

   ```sh
   npm run publish -- ./example.md --service http://127.0.0.1:4177 --id demo-from-cli
   npm run publish -- ./example.md --service http://127.0.0.1:4177 --id demo-from-cli-json --json
   npm run publish -- ./example.md --service http://127.0.0.1:4177 --id demo-from-cli --replace --json
   curl -sS -X POST 'http://127.0.0.1:4177/api/playgrounds?id=demo-raw-html&title=Demo%20Raw%20HTML' -H 'content-type: text/html' --data-binary @example.html
   curl -sS http://127.0.0.1:4177/api/playgrounds/demo-raw-html/meta
   curl -sS http://127.0.0.1:4177/api/playgrounds/demo-raw-html/render
   ```

8. Verify the host:

   ```sh
   npm run verify -- --service http://127.0.0.1:4177 --id demo-verifier
   ```

## Native App Mirror

1. Build and run the native app from Xcode.
2. Open Hosted Service settings.
3. Set service URL to `http://127.0.0.1:4177`.
4. Open Hosted Library.
5. Confirm hosted records are listed.
6. Use Copy Manifest from a hosted row and inspect that URL in a browser or with `npm run inspect`.
7. Import or sync a hosted record into the local library.
8. Edit the local playground and use Hosted Mirror -> Publish and Open Link.
9. Use Hosted Mirror -> Copy Manifest Link.
10. Use Pull Latest from Host to show the hosted service can be treated as source of truth.

## Browser Deep Links

1. Open a hosted `/p/:id` page.
2. Click `Open in PlayPen`.
3. Confirm the native app imports the hosted record.
4. Repeat with a copied `/api/playgrounds/<id>/meta`, `/api/playgrounds/<id>/manifest`, or `/api/playgrounds/<id>/source` URL through `playpen://import?url=...`.
5. Click `Use as Host`.
6. Confirm PlayPen configures that service URL.

## Public Deployment Demo

Do not run this without approval and a named target.

1. Deploy `PlayPen/Hosted` to the approved host.
2. Configure durable storage and `PLAYPEN_PUBLISH_TOKEN`.
3. Run:

   ```sh
   npm run preflight -- --service https://your-playpen-host.example --token "$PLAYPEN_PUBLISH_TOKEN" --require-public --require-token
   ```

4. Set the native app Hosted Service URL to the public host.
5. Publish a real playground and share the public link.
