import SwiftUI
import SwiftData

@Model
final class Note {
    var text: String
    var createdAt: Date
    init(text: String) {
        self.text = text
        self.createdAt = .now
    }
}

@main
struct SPMApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: Note.self)
    }
}

struct ContentView: View {
    @Environment(\.modelContext) var modelContext
    @Query var notes: [Note]
    var body: some View {
        VStack {
            Text("Notes: \(notes.count)")
            Button("Add") { modelContext.insert(Note(text: "hi")) }
        }
        .frame(minWidth: 300, minHeight: 200)
    }
}
