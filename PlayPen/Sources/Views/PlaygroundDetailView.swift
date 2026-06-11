import SwiftUI
import SwiftData
import MapKit

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
    @State private var isAcquiringLocation = false
    @State private var isShowingLocationError = false
    @State private var locationErrorMessage = ""

    init(playground: Playground) {
        self.playground = playground
        _hasOutlineHeadings = State(initialValue: !MarkdownOutline.headings(in: playground.content).isEmpty)
    }

    private var hasPreviewableContent: Bool {
        !playground.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Title", text: $playground.title)
                    .font(.largeTitle.weight(.semibold))
                    .textFieldStyle(.plain)
                TagEditorView(playground: playground)
                if playground.hasLocation {
                    PlaygroundLocationCapsule(playground: playground)
                        .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .leading)))
                }
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
                if hasPreviewableContent {
                    HTMLPreviewView(
                        content: playground.content,
                        kind: playground.kind,
                        scrollTargetHeadingID: $previewScrollHeadingID
                    )
                } else {
                    ContentUnavailableView {
                        Label("Nothing to Preview", systemImage: "square.dashed")
                    } description: {
                        Text("This playground is empty. Switch to \(ViewMode.source.title(for: playground.kind)) to start writing.")
                    } actions: {
                        Button("Edit \(ViewMode.source.title(for: playground.kind))") {
                            viewMode = .source
                        }
                        .buttonStyle(.glassProminent)
                    }
                }
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
            ToolbarItem(placement: .primaryAction) {
                if isAcquiringLocation {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Acquiring location")
                } else {
                    Menu {
                        Button("Set Current Location", systemImage: "location") {
                            setCurrentLocation()
                        }
                        if playground.hasLocation {
                            Button("Remove Location", systemImage: "location.slash", role: .destructive) {
                                removeLocation()
                            }
                        }
                    } label: {
                        Label("Location", systemImage: playground.hasLocation ? "location.fill" : "location")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .accessibilityLabel(playground.hasLocation ? "Location, set" : "Location, not set")
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
        .alert("Couldn't Set Location", isPresented: $isShowingLocationError) {
        } message: {
            Text(locationErrorMessage)
        }
    }

    private func setCurrentLocation() {
        guard !isAcquiringLocation else { return }
        isAcquiringLocation = true
        Task {
            defer { isAcquiringLocation = false }
            do {
                let locationFix = try await CurrentLocationService.acquireFix()
                guard !playground.isDeleted, playground.modelContext != nil else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    playground.latitude = locationFix.latitude
                    playground.longitude = locationFix.longitude
                    playground.placeName = locationFix.placeName
                }
                playground.modifiedAt = .now
            } catch {
                locationErrorMessage = error.localizedDescription
                isShowingLocationError = true
            }
        }
    }

    private func removeLocation() {
        withAnimation(.easeOut(duration: 0.2)) {
            playground.latitude = nil
            playground.longitude = nil
            playground.placeName = nil
        }
        playground.modifiedAt = .now
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

struct PlaygroundLocationCapsule: View {
    let playground: Playground
    @State private var isShowingMapPopover = false

    var body: some View {
        if let coordinate = playground.coordinate {
            Button {
                isShowingMapPopover = true
            } label: {
                Label(capsuleTitle, systemImage: "location.fill")
                    .font(.caption)
                    .lineLimit(1)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(.tint.opacity(0.15), in: .capsule)
                    .foregroundStyle(Color.accentColor.mix(with: .primary, by: 0.4))
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Location: \(capsuleTitle)")
            .popover(isPresented: $isShowingMapPopover) {
                Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 1500, longitudinalMeters: 1500))) {
                    Marker(capsuleTitle, coordinate: coordinate)
                }
                .frame(width: 320, height: 240)
                .presentationCompactAdaptation(.popover)
            }
        }
    }

    private var capsuleTitle: String {
        if let placeName = playground.placeName, !placeName.isEmpty {
            return placeName
        }
        guard let latitude = playground.latitude, let longitude = playground.longitude else { return "Location" }
        return String(format: "%.4f, %.4f", latitude, longitude)
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
