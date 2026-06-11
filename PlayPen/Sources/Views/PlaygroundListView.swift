import SwiftUI
import SwiftData
import CoreTransferable
import UniformTypeIdentifiers

struct PlaygroundListView: View {
    let sidebarSelection: SidebarSelection
    @Binding var selectedPlayground: Playground?
    let searchText: String
    let searchTokens: [Tag]

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Playground.modifiedAt, order: .reverse) private var playgrounds: [Playground]
    @State private var isShowingFileImporter = false
    @State private var isShowingImportError = false
    @State private var importErrorMessage = ""

    private static let htmlFileExtensions: Set<String> = ["html", "htm"]
    private static let markdownFileExtensions: Set<String> = ["md", "markdown"]

    private var filteredPlaygrounds: [Playground] {
        playgrounds.filter { playground in
            let playgroundTags = playground.tags ?? []
            switch sidebarSelection {
            case .all:
                break
            case .map:
                guard playground.hasLocation else { return false }
            case .project(let project):
                guard playground.project == project else { return false }
            case .tag(let tag):
                guard playgroundTags.contains(tag) else { return false }
            }
            for token in searchTokens where !playgroundTags.contains(token) {
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
                emptyStateView
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
            ToolbarItem(placement: .secondaryAction) {
                Button("Import Files", systemImage: "square.and.arrow.down") {
                    isShowingFileImporter = true
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            }
            .visibilityPriority(.low)
        }
        .fileImporter(
            isPresented: $isShowingFileImporter,
            allowedContentTypes: [.html, .markdown],
            allowsMultipleSelection: true
        ) { pickerResult in
            switch pickerResult {
            case .success(let pickedURLs):
                importPlaygrounds(from: pickedURLs)
            case .failure(let pickerError):
                presentImportError(pickerError.localizedDescription)
            }
        }
        .dropDestination(for: ImportedPlaygroundFile.self) { droppedFiles, _ in
            importPlaygrounds(droppedFiles)
        }
        .alert("Import Failed", isPresented: $isShowingImportError) {
        } message: {
            Text(importErrorMessage)
        }
    }

    @ViewBuilder
    private var emptyStateView: some View {
        if sidebarSelection == .map {
            ContentUnavailableView {
                Label("No Geotagged Playgrounds", systemImage: "location.slash")
            } description: {
                Text("Tag a playground with your current location from its toolbar to see it here.")
            }
        } else {
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
        }
    }

    private var listTitle: String {
        switch sidebarSelection {
        case .all: "All Playgrounds"
        case .map: "Geotagged"
        case .project(let project): project.name
        case .tag(let tag): "#\(tag.name)"
        }
    }

    private func createPlayground() {
        let playground = Playground(title: "Untitled Playground", content: "# Untitled Playground\n\n")
        applyListContext(to: playground)
        modelContext.insert(playground)
        selectedPlayground = playground
    }

    private func applyListContext(to playground: Playground) {
        if case .project(let project) = sidebarSelection {
            playground.project = project
        }
        if case .tag(let tag) = sidebarSelection {
            playground.tags = [tag]
        }
    }

    private func deletePlayground(_ playground: Playground) {
        if selectedPlayground == playground {
            selectedPlayground = nil
        }
        modelContext.delete(playground)
    }

    private func importPlaygrounds(_ importedFiles: [ImportedPlaygroundFile]) {
        guard !importedFiles.isEmpty else { return }
        var lastImportedPlayground: Playground?
        for importedFile in importedFiles {
            let playground = Playground(
                title: importedFile.title,
                content: importedFile.content,
                kind: importedFile.kind
            )
            applyListContext(to: playground)
            modelContext.insert(playground)
            lastImportedPlayground = playground
        }
        selectedPlayground = lastImportedPlayground
    }

    private func importPlaygrounds(from fileURLs: [URL]) {
        var unreadableFileNames: [String] = []
        var lastImportedPlayground: Playground?
        for fileURL in fileURLs {
            guard let importedPlayground = importPlayground(at: fileURL) else {
                unreadableFileNames.append(fileURL.lastPathComponent)
                continue
            }
            lastImportedPlayground = importedPlayground
        }
        if let lastImportedPlayground {
            selectedPlayground = lastImportedPlayground
        }
        guard !unreadableFileNames.isEmpty else { return }
        presentImportError("Could not read \(unreadableFileNames.formatted(.list(type: .and))).")
    }

    private func importPlayground(at fileURL: URL) -> Playground? {
        let hasSecurityScope = fileURL.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScope { fileURL.stopAccessingSecurityScopedResource() }
        }
        guard let fileContent = try? String(contentsOf: fileURL, encoding: .utf8) else { return nil }
        let importedKind: PlaygroundKind = Self.htmlFileExtensions.contains(fileURL.pathExtension.lowercased()) ? .html : .markdown
        let playground = Playground(
            title: fileURL.deletingPathExtension().lastPathComponent,
            content: fileContent,
            kind: importedKind
        )
        applyListContext(to: playground)
        modelContext.insert(playground)
        return playground
    }

    private func presentImportError(_ message: String) {
        importErrorMessage = message
        isShowingImportError = true
    }
}

nonisolated struct ImportedPlaygroundFile: Transferable {
    let title: String
    let content: String
    let kind: PlaygroundKind

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .markdown) { receivedFile in
            try Self(fileURL: receivedFile.file, kind: .markdown)
        }
        FileRepresentation(importedContentType: .html) { receivedFile in
            try Self(fileURL: receivedFile.file, kind: .html)
        }
    }

    init(fileURL: URL, kind: PlaygroundKind) throws {
        title = fileURL.deletingPathExtension().lastPathComponent
        content = try String(contentsOf: fileURL, encoding: .utf8)
        self.kind = kind
    }
}

struct PlaygroundRow: View {
    let playground: Playground

    private var displayTags: [Tag] {
        Array((playground.tags ?? []).sorted { $0.name < $1.name }.prefix(4))
    }

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
                Image(systemName: playground.kind.symbolName)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityLabel(playground.kind.displayName)
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
            if !displayTags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(displayTags) { tag in
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
