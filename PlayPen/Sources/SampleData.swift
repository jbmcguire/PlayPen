import Foundation
import SwiftData

enum SampleData {
    private static let hasSeededKey = "SampleData.hasSeeded.v4"

    static func seedIfNeeded(context: ModelContext) {
        guard !UserDefaults.standard.bool(forKey: hasSeededKey) else { return }

        let existingCount = (try? context.fetchCount(FetchDescriptor<Playground>())) ?? 0
        guard existingCount == 0 else {
            UserDefaults.standard.set(true, forKey: hasSeededKey)
            return
        }

        let swiftUIProject = Project(name: "SwiftUI Experiments")
        swiftUIProject.sortIndex = 0
        let apiProject = Project(name: "API Spikes")
        apiProject.sortIndex = 1
        let reviewNotesProject = Project(name: "Review Notes")
        reviewNotesProject.sortIndex = 2
        let webClipsProject = Project(name: "Web Clips")
        webClipsProject.sortIndex = 3

        [swiftUIProject, apiProject, reviewNotesProject, webClipsProject].forEach { context.insert($0) }

        let swiftTag = Tag(name: "swift")
        let uiTag = Tag(name: "ui")
        let networkingTag = Tag(name: "networking")
        let reliabilityTag = Tag(name: "reliability")
        let htmlTag = Tag(name: "html")
        let polishTag = Tag(name: "polish")
        let docsTag = Tag(name: "docs")
        let ideaTag = Tag(name: "idea")

        [
            swiftTag,
            uiTag,
            networkingTag,
            reliabilityTag,
            htmlTag,
            polishTag,
            docsTag,
            ideaTag
        ].forEach { context.insert($0) }

        let retryPlayground = addPlayground(
            title: "Retry Budget + Jitter",
            content: """
            # Retry Budget + Jitter

            Keep retry time inside the request budget. The staging API gets noisy after deploys, but the UI should still fail predictably.

            ## Current rule

            | Attempt | Delay | Notes |
            | --- | ---: | --- |
            | 1 | 0.25s | optimistic fast path |
            | 2 | 0.75s | add jitter |
            | 3 | 1.50s | final visible attempt |

            ```swift
            struct RetryBudget {
                let attempts = 3
                let totalTimeout: Duration = .seconds(5)

                func delay(for attempt: Int) -> Duration {
                    let base = pow(2.0, Double(attempt)) * 0.25
                    let jitter = Double.random(in: 0...0.35)
                    return .milliseconds(Int((base + jitter) * 1000))
                }
            }
            ```

            ## Follow-ups

            - Surface the final error inline, not in a sheet
            - Log exhausted retries with request family and endpoint
            - Re-test under constrained network conditions before shipping
            """,
            project: apiProject,
            tags: [swiftTag, networkingTag, reliabilityTag],
            minutesAgo: 4,
            context: context
        )

        addPlayground(
            title: "Offline Save Queue",
            content: """
            # Offline Save Queue

            Notes from testing edits during an offline QA session. The editor should keep accepting input even while sync is parked.

            ## Queue shape

            ```swift
            enum PendingWrite {
                case create(id: UUID, body: String)
                case update(id: UUID, patch: Patch)
                case delete(id: UUID)
            }
            ```

            - Merge adjacent edits before replay
            - Keep deleted playgrounds tombstoned for one sync pass
            - Show "Saved on device" when the network is down
            """,
            project: apiProject,
            tags: [swiftTag, networkingTag, reliabilityTag],
            minutesAgo: 18,
            context: context
        )

        addPlayground(
            title: "Share Sheet Import QA",
            content: """
            # Share Sheet Import QA

            Importing from Safari, Files, and Mail should all land in the same review flow.

            ## Test matrix

            | Source | Markdown | HTML | Result |
            | --- | --- | --- | --- |
            | Safari reader | yes | yes | strips tracking links |
            | Files | yes | no | keeps file title |
            | Mail | partial | yes | needs cleanup pass |

            The empty title case is fixed. Still need a friendlier duplicate filename prompt.
            """,
            project: apiProject,
            tags: [docsTag, networkingTag, polishTag],
            minutesAgo: 31,
            context: context
        )

        addPlayground(
            title: "Command Palette Notes",
            content: """
            # Command Palette Notes

            Fast actions should feel native, not like a web overlay.

            ## Commands to keep

            - New Playground
            - Import Files
            - Copy Rendered HTML
            - Move to Project
            - Toggle Preview

            ```swift
            CommandGroup(after: .newItem) {
                Button("New Playground") { newPlayground() }
                    .keyboardShortcut("n", modifiers: .command)
            }
            ```

            Keep icons quiet. The palette should scan by verb first, shortcut second.
            """,
            project: swiftUIProject,
            tags: [swiftTag, uiTag, polishTag],
            minutesAgo: 44,
            context: context
        )

        addPlayground(
            title: "Inline Table Renderer",
            content: """
            # Inline Table Renderer

            Markdown tables need to stay readable in narrow preview columns.

            | Case | Behavior |
            | --- | --- |
            | two columns | normal table |
            | five columns | horizontal scroll |
            | no header | render as simple grid |

            Next pass: add a subtle edge fade when the table can scroll sideways.
            """,
            project: swiftUIProject,
            tags: [swiftTag, uiTag, docsTag],
            minutesAgo: 58,
            context: context
        )

        addPlayground(
            title: "Liquid Glass Buttons",
            content: """
            # Liquid Glass Buttons

            Exploring the new glass button styles introduced in macOS Tahoe.

            ## Findings

            - `.buttonStyle(.glass)` works best on content backgrounds
            - `.buttonStyle(.glassProminent)` for the primary action only
            - Group nearby glass shapes inside a `GlassEffectContainer`

            ```swift
            Button("Run", systemImage: "play.fill") { run() }
                .buttonStyle(.glassProminent)
            ```

            Avoid stacking glass on glass. Toolbars and sidebars already get it for free.
            """,
            project: swiftUIProject,
            tags: [swiftTag, uiTag, polishTag],
            minutesAgo: 76,
            context: context
        )

        addPlayground(
            title: "Artifact Annotation Notes",
            content: """
            # Artifact Annotation Notes

            Notes need lightweight context without asking for device permissions or adding another navigation surface.

            ## Annotation behavior

            - Keep a short note beside the source
            - Publish the annotation with hosted records
            - Treat it as review context, not rendered content

            Good examples: "Generated during visual QA", "Needs security review", "Imported from a support repro".
            """,
            project: reviewNotesProject,
            tags: [polishTag, ideaTag],
            minutesAgo: 93,
            annotation: "Use annotations for provenance or review notes.",
            context: context
        )

        addPlayground(
            title: "Weak Wi-Fi Latency",
            content: """
            # Weak Wi-Fi Latency

            Captured during manual QA on weak Wi-Fi. Useful repro for slow sync and preview refresh.

            ```text
            average ping: 180ms
            packet loss: 3%
            preview refresh: visible after second save
            ```

            Keep this around for offline save queue testing.
            """,
            project: reviewNotesProject,
            tags: [networkingTag, reliabilityTag],
            minutesAgo: 117,
            annotation: "Weak network repro captured during manual QA.",
            context: context
        )

        addPlayground(
            title: "HTML Embed Sanitizer",
            content: """
            <h1>HTML Embed Sanitizer</h1>
            <p>Imported snippets need a narrow safe subset before preview.</p>
            <ul>
              <li>Allow inline code, tables, links, and images.</li>
              <li>Strip scripts, iframes, and external stylesheets.</li>
              <li>Keep source untouched so users can recover the original.</li>
            </ul>
            <pre><code>let allowedTags = ["p", "a", "code", "pre", "table"]</code></pre>
            """,
            kind: .html,
            project: webClipsProject,
            tags: [htmlTag, docsTag, reliabilityTag],
            minutesAgo: 142,
            context: context
        )

        addPlayground(
            title: "Launch Copy Fragments",
            content: """
            # Launch Copy Fragments

            Candidate language for the marketing page.

            > A native workspace for rough notes to become useful again.

            Stronger than "knowledge base" because the product is lighter than that. The promise is speed, trust, and finding the useful bit later.

            ## Keep

            - native
            - quick
            - source and preview
            - real screenshots
            """,
            project: webClipsProject,
            tags: [docsTag, htmlTag, ideaTag],
            minutesAgo: 188,
            context: context
        )

        _ = retryPlayground
        try? context.save()
        UserDefaults.standard.set(true, forKey: hasSeededKey)
    }

    @discardableResult
    private static func addPlayground(
        title: String,
        content: String,
        kind: PlaygroundKind = .markdown,
        project: Project,
        tags: [Tag],
        minutesAgo: Int,
        annotation: String = "",
        context: ModelContext
    ) -> Playground {
        let playground = Playground(title: title, content: content, kind: kind, project: project)
        let timestamp = Calendar.current.date(byAdding: .minute, value: -minutesAgo, to: .now) ?? .now
        playground.createdAt = timestamp
        playground.modifiedAt = timestamp
        playground.tags = tags
        playground.annotation = annotation
        context.insert(playground)
        return playground
    }
}
