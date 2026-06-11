import SwiftUI
import SwiftData

@main
struct PlayPenApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(for: Playground.self, Project.self, Tag.self)
        } catch {
            fatalError("Failed to create model container: \(error)")
        }
        SampleData.seedIfNeeded(context: container.mainContext)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(container)
        .defaultSize(width: 1150, height: 740)
    }
}
