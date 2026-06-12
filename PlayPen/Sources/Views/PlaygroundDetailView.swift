import SwiftUI
import SwiftData
#if os(macOS)
import AppKit
#else
import UIKit
#endif

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
    @State private var isShowingHostedMirrorMessage = false
    @State private var hostedMirrorMessage = ""
    @State private var isPublishingHostedMirror = false
    @State private var isRefreshingHostedMirror = false
    @Environment(\.openURL) private var openURL

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
                AnnotationEditor(playground: playground)
                if playground.hasHostedMirror {
                    HostedMirrorStatus(playground: playground)
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
                if isPublishingHostedMirror || isRefreshingHostedMirror {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel(isPublishingHostedMirror ? "Publishing hosted mirror" : "Refreshing hosted mirror")
                } else {
                    Menu("Hosted Mirror", systemImage: playground.hasHostedMirror ? "link.circle.fill" : "link.circle") {
                        Button("Publish and Copy Link", systemImage: "doc.on.doc") {
                            publishHostedMirror(copyLink: true, openLink: false)
                        }
                        Button("Publish and Open Link", systemImage: "safari") {
                            publishHostedMirror(copyLink: false, openLink: true)
                        }
                        if let hostedURL = playground.hostedURL {
                            Divider()
                            Button("Pull Latest from Host", systemImage: "arrow.down.doc") {
                                refreshFromHostedMirror(hostedURL)
                            }
                            if let manifestURL = HostedPlaygroundService.manifestURL(for: playground) {
                                Button("Copy Manifest Link", systemImage: "doc.on.doc.fill") {
                                    copyManifestLink(manifestURL)
                                }
                                Button("Open Manifest", systemImage: "curlybraces") {
                                    openURL(manifestURL)
                                }
                            }
                            ShareLink(item: hostedURL) {
                                Label("Share Published Link", systemImage: "square.and.arrow.up")
                            }
                        }
                        if playground.hasHostedMirror {
                            Text(playground.isHostedMirrorCurrent ? "Published snapshot is current" : "Local edits need publishing")
                        }
                    }
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
        .onChange(of: playground.annotation) {
            playground.modifiedAt = .now
        }
        .alert("Hosted Mirror", isPresented: $isShowingHostedMirrorMessage) {
        } message: {
            Text(hostedMirrorMessage)
        }
    }

    private func publishHostedMirror(copyLink: Bool, openLink: Bool) {
        guard !isPublishingHostedMirror else { return }
        guard !isRefreshingHostedMirror else { return }
        isPublishingHostedMirror = true
        Task {
            defer { isPublishingHostedMirror = false }
            do {
                let publishResult = try await HostedPlaygroundService.publish(playground)
                guard !playground.isDeleted, playground.modelContext != nil else { return }
                playground.hostedID = publishResult.id
                playground.hostedPublishedAt = publishResult.publishedAt
                playground.hostedContentDigest = publishResult.contentDigest
                playground.hostedURL = publishResult.url
                playground.annotation = publishResult.annotation ?? ""
                playground.modifiedAt = .now
                if copyLink {
                    copyToClipboard(publishResult.url.absoluteString)
                    hostedMirrorMessage = message(for: publishResult)
                    isShowingHostedMirrorMessage = true
                }
                if openLink {
                    openURL(publishResult.url)
                }
            } catch {
                hostedMirrorMessage = error.localizedDescription
                isShowingHostedMirrorMessage = true
            }
        }
    }

    private func refreshFromHostedMirror(_ hostedURL: URL) {
        guard !isRefreshingHostedMirror else { return }
        guard !isPublishingHostedMirror else { return }
        isRefreshingHostedMirror = true
        Task {
            defer { isRefreshingHostedMirror = false }
            do {
                let payload = try await HostedPlaygroundService.resolve(hostedURL)
                guard !playground.isDeleted, playground.modelContext != nil else { return }
                playground.title = payload.title.isEmpty ? "Untitled Playground" : payload.title
                playground.annotation = payload.annotation ?? ""
                playground.content = payload.content
                playground.kind = payload.kind
                playground.hostedID = payload.id
                playground.hostedURL = HostedPlaygroundService.canonicalHostedURL(for: hostedURL, payload: payload)
                playground.hostedPublishedAt = payload.publishedAt
                playground.hostedContentDigest = HostedPlaygroundService.contentDigest(for: payload)
                playground.modifiedAt = .now
                hostedMirrorMessage = "Pulled the latest hosted source into this playground."
                isShowingHostedMirrorMessage = true
            } catch {
                hostedMirrorMessage = error.localizedDescription
                isShowingHostedMirrorMessage = true
            }
        }
    }

    private func copyManifestLink(_ manifestURL: URL) {
        copyToClipboard(manifestURL.absoluteString)
        hostedMirrorMessage = "Manifest link copied. Share it with agents for metadata, source, deep links, and digest-pinned inspect commands."
        isShowingHostedMirrorMessage = true
    }

    private func message(for publishResult: HostedPublishResult) -> String {
        if publishResult.didUseHostedAPI {
            return "Hosted link copied. Service: \(HostedPlaygroundService.serviceName)."
        }
        if let fallbackReason = publishResult.fallbackReason {
            return "Encoded mirror link copied because the hosted API was unavailable: \(fallbackReason)"
        }
        return "Encoded mirror link copied. Configure a hosted service URL to publish short links."
    }

    private func copyToClipboard(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
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

struct HostedMirrorStatus: View {
    let playground: Playground

    var body: some View {
        Label {
            Text(statusText)
                .lineLimit(1)
        } icon: {
            Image(systemName: playground.isHostedMirrorCurrent ? "checkmark.circle" : "arrow.triangle.2.circlepath")
        }
        .font(.caption)
        .padding(.horizontal, 9)
        .padding(.vertical, 3)
        .background(statusColor.opacity(0.14), in: .capsule)
        .foregroundStyle(statusColor)
        .frame(minWidth: 44, minHeight: 44, alignment: .leading)
        .accessibilityLabel(statusText)
    }

    private var statusText: String {
        if playground.isHostedMirrorCurrent {
            return "Hosted mirror current"
        }
        return "Hosted mirror needs publishing"
    }

    private var statusColor: Color {
        playground.isHostedMirrorCurrent ? .green : .orange
    }
}

struct AnnotationEditor: View {
    @Bindable var playground: Playground

    var body: some View {
        TextField("Annotation", text: $playground.annotation, axis: .vertical)
            .font(.callout)
            .textFieldStyle(.plain)
            .lineLimit(1...3)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 8))
            .accessibilityLabel("Annotation")
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
