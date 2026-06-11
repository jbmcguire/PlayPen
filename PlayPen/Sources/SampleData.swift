import Foundation
import SwiftData

enum SampleData {
    private static let hasSeededKey = "SampleData.hasSeeded"

    static func seedIfNeeded(context: ModelContext) {
        guard !UserDefaults.standard.bool(forKey: hasSeededKey) else { return }

        let existingCount = (try? context.fetchCount(FetchDescriptor<Playground>())) ?? 0
        guard existingCount == 0 else {
            UserDefaults.standard.set(true, forKey: hasSeededKey)
            return
        }

        let swiftUIProject = Project(name: "SwiftUI Experiments")
        let apiProject = Project(name: "API Spikes")
        context.insert(swiftUIProject)
        context.insert(apiProject)

        let swiftTag = Tag(name: "swift")
        let uiTag = Tag(name: "ui")
        let networkingTag = Tag(name: "networking")
        let ideaTag = Tag(name: "idea")
        [swiftTag, uiTag, networkingTag, ideaTag].forEach { context.insert($0) }

        let glassPlayground = Playground(
            title: "Liquid Glass Buttons",
            content: """
            # Liquid Glass Buttons

            Exploring the new glass button styles introduced in macOS 26 Tahoe.

            ## Findings

            - `.buttonStyle(.glass)` works best on content backgrounds
            - `.buttonStyle(.glassProminent)` for the primary action only
            - Group nearby glass shapes inside a `GlassEffectContainer`

            ```swift
            Button("Run", systemImage: "play.fill") { run() }
                .buttonStyle(.glassProminent)
            ```

            > Don't stack glass on glass — toolbars and sidebars already get it for free.
            """,
            project: swiftUIProject
        )
        glassPlayground.tags = [swiftTag, uiTag]

        let flowPlayground = Playground(
            title: "Flow Layout for Tags",
            content: """
            # Flow Layout

            A custom `Layout` that wraps capsule tags onto multiple lines.

            | Approach | Verdict |
            | --- | --- |
            | LazyVGrid adaptive | columns, not true wrapping |
            | Custom `Layout` | exactly what we want |
            | HStack + manual math | fragile |

            1. Measure each subview
            2. Place left to right
            3. Wrap when the line is full
            """,
            project: swiftUIProject
        )
        flowPlayground.tags = [swiftTag, uiTag, ideaTag]

        let retryPlayground = Playground(
            title: "Retry with Exponential Backoff",
            content: """
            # Retry Strategy

            Testing **exponential backoff** with jitter against the staging API.

            ```swift
            func retry<T>(maxAttempts: Int = 3, operation: () async throws -> T) async throws -> T {
                for attempt in 0..<maxAttempts {
                    do { return try await operation() }
                    catch where attempt < maxAttempts - 1 {
                        let delay = pow(2.0, Double(attempt)) + .random(in: 0...0.5)
                        try await Task.sleep(for: .seconds(delay))
                    }
                }
                fatalError("unreachable")
            }
            ```

            See [the AWS architecture blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) for the jitter rationale.
            """,
            project: apiProject
        )
        retryPlayground.tags = [swiftTag, networkingTag]

        [glassPlayground, flowPlayground, retryPlayground].forEach { context.insert($0) }
        try? context.save()
        UserDefaults.standard.set(true, forKey: hasSeededKey)
    }
}
