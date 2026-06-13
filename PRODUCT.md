# Product

## Register

brand

## Users
PlayPen's marketing page is for Mac and iPad users who collect code experiments, Markdown notes, HTML snippets, and annotated artifact trails. They are likely developers, technical founders, designers, and power users who want a small native tool to keep experiments readable without turning every idea into a project.

## Product Purpose
PlayPen gives rough technical notes a focused native workspace: source editing, rendered preview, projects, tags, outline navigation, search, annotations, and hosted mirror links for sharing HTML or Markdown playgrounds outside the app. The marketing site should make the app feel quick to understand, trustworthy, and worth trying because it shows real product behavior instead of an invented dashboard.

The MVP does not include geotagging or map views. Context should travel through lightweight annotations, tags, projects, outlines, and hosted metadata.

## Brand Personality
Native, clean, quick. The page should feel precise, calm, and confident, closer to a top-tier Apple, Google, or Linear product launch than a generic SaaS landing page.

## Anti-references
Avoid generic landing pages, fake dashboards, feature-card grids, hero metric strips, beige AI-template polish, purple-blue gradients, excessive pills, and marketing copy that overexplains. Do not invent product states the app does not support.

## Design Principles
- Lead with the real product: use actual screenshots and generated product imagery grounded in the running app.
- Make speed legible: every section should scan fast, with short copy and a direct visual point.
- Preserve native trust: typography, spacing, and motion should feel like a serious Mac/iPad app launch.
- Prefer openness over enclosure: avoid stacked cards, boxed wrappers, and decorative chrome.
- Keep the promise concrete: describe what PlayPen literally helps users do.

## Hosted Mirror Service
The native app is a local mirror and editor for playgrounds that can also exist as web links. A hosted mirror link should open in any browser, render Markdown or sandboxed HTML, expose source, and keep agents/users on the same artifact without requiring PlayPen to be installed. The first implementation is static-host compatible; a later backend can replace fragment payloads with short IDs and mutable hosted records.

The hosted mirror must be able to run as a service with short `/p/:id` records when persistent storage is available, while still running as a plain static site when fragment links are acceptable. Links may use `/p/:id`, `#playground=`, or `?playground=` payloads, and malformed links should fail visibly instead of showing a blank surface.

## Accessibility & Inclusion
Target WCAG AA contrast, visible keyboard focus, readable mobile type, no horizontal overflow, and reduced-motion support. Motion should enhance orientation, not gate content.
