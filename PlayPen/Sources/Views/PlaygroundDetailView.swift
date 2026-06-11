import SwiftUI
import SwiftData

enum ViewMode: String, CaseIterable, Identifiable {
    case source
    case preview
    var id: String { rawValue }

    func title(for kind: PlaygroundKind) -> String {
        switch self {
        case .source: kind == .html ? "Source" : "Markdown"
        case .preview: "Preview"
        }
    }
}

struct PlaygroundDetailView: View {
    @Bindable var playground: Playground
    @State private var viewMode: ViewMode = .preview

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Title", text: $playground.title)
                    .font(.largeTitle.weight(.semibold))
                    .textFieldStyle(.plain)
                TagEditorView(playground: playground)
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 12)

            Divider()

            switch viewMode {
            case .source:
                TextEditor(text: $playground.content)
                    .font(.system(.body, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            case .preview:
                HTMLPreviewView(content: playground.content, kind: playground.kind)
            }
        }
        .scrollEdgeEffectStyle(.soft, for: .top)
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View Mode", selection: $viewMode) {
                    ForEach(ViewMode.allCases) { mode in
                        Text(mode.title(for: playground.kind)).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }
            .visibilityPriority(.high)
            ToolbarItem(placement: .secondaryAction) {
                ProjectAssignmentMenu(playground: playground)
            }
            .visibilityPriority(.low)
        }
        .onChange(of: playground.content) {
            playground.modifiedAt = .now
        }
        .onChange(of: playground.title) {
            playground.modifiedAt = .now
        }
    }
}

struct ProjectAssignmentMenu: View {
    @Bindable var playground: Playground
    @Query(sort: \Project.name) private var projects: [Project]

    var body: some View {
        Menu("Project", systemImage: "folder") {
            Picker("Project", selection: $playground.project) {
                Text("None").tag(Project?.none)
                ForEach(projects) { project in
                    Text(project.name).tag(Project?.some(project))
                }
            }
            .pickerStyle(.inline)
        }
    }
}
