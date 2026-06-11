import SwiftUI
import SwiftData

struct PlaygroundListView: View {
    let sidebarSelection: SidebarSelection
    @Binding var selectedPlayground: Playground?
    let searchText: String
    let searchTokens: [Tag]

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Playground.modifiedAt, order: .reverse) private var playgrounds: [Playground]

    private var filteredPlaygrounds: [Playground] {
        playgrounds.filter { playground in
            switch sidebarSelection {
            case .all:
                break
            case .project(let project):
                guard playground.project == project else { return false }
            case .tag(let tag):
                guard playground.tags.contains(tag) else { return false }
            }
            for token in searchTokens where !playground.tags.contains(token) {
                return false
            }
            if !searchText.isEmpty {
                return playground.title.localizedCaseInsensitiveContains(searchText)
                    || playground.content.localizedCaseInsensitiveContains(searchText)
            }
            return true
        }
    }

    var body: some View {
        Group {
            if filteredPlaygrounds.isEmpty {
                ContentUnavailableView {
                    Label("No Playgrounds", systemImage: "square.dashed")
                } description: {
                    Text("Create a playground to start cataloging your experiments.")
                } actions: {
                    Button("New Playground", systemImage: "plus") {
                        createPlayground()
                    }
                    .buttonStyle(.glassProminent)
                }
            } else {
                List(filteredPlaygrounds, selection: $selectedPlayground) { playground in
                    PlaygroundRow(playground: playground)
                        .tag(playground)
                        .contextMenu {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                deletePlayground(playground)
                            }
                        }
                }
                .scrollEdgeEffectStyle(.soft, for: .top)
            }
        }
        .navigationTitle(listTitle)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Playground", systemImage: "plus") {
                    createPlayground()
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            .visibilityPriority(.high)
        }
    }

    private var listTitle: String {
        switch sidebarSelection {
        case .all: "All Playgrounds"
        case .project(let project): project.name
        case .tag(let tag): "#\(tag.name)"
        }
    }

    private func createPlayground() {
        let playground = Playground(title: "Untitled Playground", content: "# Untitled Playground\n\n")
        if case .project(let project) = sidebarSelection {
            playground.project = project
        }
        if case .tag(let tag) = sidebarSelection {
            playground.tags = [tag]
        }
        modelContext.insert(playground)
        selectedPlayground = playground
    }

    private func deletePlayground(_ playground: Playground) {
        if selectedPlayground == playground {
            selectedPlayground = nil
        }
        modelContext.delete(playground)
    }
}

struct PlaygroundRow: View {
    let playground: Playground

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(playground.title)
                .font(.headline)
                .lineLimit(1)
            Text(playground.snippet)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 6) {
                if let project = playground.project {
                    Label(project.name, systemImage: "folder")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
                Spacer()
                Text(playground.modifiedAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            if !playground.tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(playground.tags.sorted { $0.name < $1.name }.prefix(4)) { tag in
                        TagCapsule(name: tag.name)
                    }
                }
            }
        }
        .padding(.vertical, 3)
    }
}

struct TagCapsule: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.caption2)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(.tint.opacity(0.15), in: .capsule)
            .foregroundStyle(.tint)
    }
}
