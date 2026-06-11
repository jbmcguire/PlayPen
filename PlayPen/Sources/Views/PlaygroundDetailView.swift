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
    @State private var isFindNavigatorPresented = false
    @State private var hasOutlineHeadings = false
    @State private var sourceSelection: TextSelection?
    @State private var previewScrollHeadingID: Int?

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
                TextEditor(text: $playground.content, selection: $sourceSelection)
                    .font(.system(.body, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .findNavigator(isPresented: $isFindNavigatorPresented)
            case .preview:
                HTMLPreviewView(
                    content: playground.content,
                    kind: playground.kind,
                    scrollTargetHeadingID: $previewScrollHeadingID
                )
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
            if playground.kind == .markdown {
                ToolbarItem(placement: .primaryAction) {
                    Menu("Outline", systemImage: "list.bullet.indent") {
                        OutlineMenuItems(markdown: playground.content, onSelect: navigate(to:))
                    }
                    .disabled(!hasOutlineHeadings)
                }
            }
            if viewMode == .source {
                ToolbarItem(placement: .primaryAction) {
                    Button("Find", systemImage: "magnifyingglass") {
                        isFindNavigatorPresented.toggle()
                    }
                    .keyboardShortcut("f", modifiers: .command)
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                ProjectAssignmentMenu(playground: playground)
            }
            .visibilityPriority(.low)
        }
        .task(id: playground.content) {
            guard (try? await Task.sleep(for: .milliseconds(250))) != nil else { return }
            hasOutlineHeadings = !MarkdownOutline.headings(in: playground.content).isEmpty
        }
        .onChange(of: playground.content) {
            playground.modifiedAt = .now
        }
        .onChange(of: playground.title) {
            playground.modifiedAt = .now
        }
    }

    private func navigate(to headingItem: HeadingOutlineItem) {
        switch viewMode {
        case .source:
            moveSourceSelection(toLineNumber: headingItem.lineNumber)
        case .preview:
            previewScrollHeadingID = headingItem.id
        }
    }

    private func moveSourceSelection(toLineNumber lineNumber: Int) {
        let contentLines = playground.content.split(separator: "\n", omittingEmptySubsequences: false)
        guard lineNumber >= 1, lineNumber <= contentLines.count else { return }
        let headingLine = contentLines[lineNumber - 1]
        sourceSelection = TextSelection(range: headingLine.startIndex..<headingLine.endIndex)
    }
}

struct OutlineMenuItems: View {
    let markdown: String
    let onSelect: (HeadingOutlineItem) -> Void

    var body: some View {
        let headings = MarkdownOutline.headings(in: markdown)
        if headings.isEmpty {
            Text("No Headings")
        } else {
            ForEach(headings) { headingItem in
                Button(menuTitle(for: headingItem)) {
                    onSelect(headingItem)
                }
            }
        }
    }

    private func menuTitle(for headingItem: HeadingOutlineItem) -> String {
        let indentation = String(repeating: "\u{2003}", count: max(headingItem.level - 1, 0))
        let displayTitle = headingItem.title.isEmpty ? "Untitled" : headingItem.title
        return indentation + displayTitle
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
