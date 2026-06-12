# PlayPen Agent Artifact

This Markdown playground is a small publishable sample for local demos.

## What To Inspect

- The hosted `/p/:id` viewer renders this page.
- The metadata route exposes title, kind, annotation, size, and digest.
- The source route returns this Markdown as non-executable text.
- The manifest route gives agents stable links and digest-pinned inspect commands.

## Handoff Note

Publish this file with:

```sh
npm run publish -- ./example.md --service http://127.0.0.1:4177 --id demo-from-cli
```

Then inspect it with:

```sh
npm run inspect -- http://127.0.0.1:4177/p/demo-from-cli --meta
```
