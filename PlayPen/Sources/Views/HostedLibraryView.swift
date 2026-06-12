import SwiftData
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct HostedLibraryView: View {
    @Binding var selectedPlayground: Playground?
    @Binding var sidebarSelection: SidebarSelection?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(\.openURL) private var openURL
    @Query(sort: \Playground.modifiedAt, order: .reverse) private var localPlaygrounds: [Playground]
    @State private var hostedList: HostedPlaygroundList?
    @State private var loadErrorMessage: String?
    @State private var importMessage: String?
    @State private var importingID: String?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            Group {
                if HostedPlaygroundService.isUsingBundledService {
                    ContentUnavailableView {
                        Label("No Hosted Service", systemImage: "network.slash")
                    } description: {
                        Text("Set a hosted service URL before browsing hosted records.")
                    }
                } else if isLoading && hostedList == nil {
                    ProgressView("Loading hosted records")
                } else if let loadErrorMessage {
                    ContentUnavailableView {
                        Label("Couldn't Load Hosted Library", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(loadErrorMessage)
                    } actions: {
                        Button("Retry", systemImage: "arrow.clockwise") {
                            refresh()
                        }
                    }
                } else if let hostedList, hostedList.items.isEmpty {
                    ContentUnavailableView {
                        Label("No Hosted Records", systemImage: "tray")
                    } description: {
                        Text("Publish a playground to this host and it will appear here.")
                    } actions: {
                        Button("Refresh", systemImage: "arrow.clockwise") {
                            refresh()
                        }
                    }
                } else {
                    hostedRecordList
                }
            }
            .navigationTitle("Hosted Library")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        refresh()
                    }
                    .disabled(isLoading || HostedPlaygroundService.isUsingBundledService)
                }
            }
            .task {
                guard hostedList == nil else { return }
                await loadHostedRecords()
            }
            .safeAreaInset(edge: .bottom) {
                if let importMessage {
                    Text(importMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(.regularMaterial)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var hostedRecordList: some View {
        List {
            if let hostedList {
                Section {
                    ForEach(hostedList.items) { hostedRecord in
                        HostedRecordRow(
                            hostedRecord: hostedRecord,
                            localPlayground: localPlayground(for: hostedRecord),
                            isImporting: importingID == hostedRecord.id,
                            importAction: {
                                importHostedRecord(hostedRecord)
                            },
                            openAction: {
                                openURL(hostedRecord.url)
                            },
                            openManifestAction: {
                                if let manifestURL = hostedRecord.manifestURL {
                                    openURL(manifestURL)
                                }
                            },
                            copyManifestAction: {
                                if let manifestURL = hostedRecord.manifestURL {
                                    copyToClipboard(manifestURL.absoluteString)
                                    importMessage = "Manifest link copied for \(hostedRecord.title)."
                                }
                            }
                        )
                    }
                } header: {
                    Text("\(hostedList.total) hosted records")
                }
            }
        }
        .refreshable {
            await loadHostedRecords()
        }
    }

    private func refresh() {
        Task {
            await loadHostedRecords()
        }
    }

    private func loadHostedRecords() async {
        guard !HostedPlaygroundService.isUsingBundledService else { return }
        guard !isLoading else { return }
        isLoading = true
        loadErrorMessage = nil
        defer { isLoading = false }
        do {
            hostedList = try await HostedPlaygroundService.listHostedPlaygrounds(limit: 100)
        } catch is CancellationError {
            return
        } catch {
            loadErrorMessage = error.localizedDescription
        }
    }

    private func importHostedRecord(_ hostedRecord: HostedPlaygroundMetadata) {
        guard importingID == nil else { return }
        importingID = hostedRecord.id
        importMessage = nil
        Task {
            defer { importingID = nil }
            do {
                let payload = try await HostedPlaygroundService.resolve(hostedRecord.url)
                let existingPlayground = localPlayground(for: hostedRecord)
                let playground = existingPlayground ?? Playground(
                    title: payload.title.isEmpty ? "Untitled Playground" : payload.title,
                    content: payload.content,
                    kind: payload.kind
                )
                playground.title = payload.title.isEmpty ? "Untitled Playground" : payload.title
                playground.annotation = payload.annotation ?? ""
                playground.content = payload.content
                playground.kind = payload.kind
                playground.hostedID = payload.id
                playground.hostedURL = HostedPlaygroundService.canonicalHostedURL(for: hostedRecord.url, payload: payload)
                playground.hostedPublishedAt = payload.publishedAt
                playground.hostedContentDigest = HostedPlaygroundService.contentDigest(for: payload)
                playground.modifiedAt = .now
                if existingPlayground == nil {
                    modelContext.insert(playground)
                }
                sidebarSelection = .all
                selectedPlayground = playground
                importMessage = "Imported \(playground.title)."
            } catch is CancellationError {
                return
            } catch {
                importMessage = error.localizedDescription
            }
        }
    }

    private func localPlayground(for hostedRecord: HostedPlaygroundMetadata) -> Playground? {
        let canonicalHostedRecordURL = HostedPlaygroundService.canonicalHostedURL(for: hostedRecord.url, playgroundID: hostedRecord.id)
        return localPlaygrounds.first { playground in
            guard playground.hostedID == hostedRecord.id, let hostedURL = playground.hostedURL else { return false }
            return HostedPlaygroundService.canonicalHostedURL(for: hostedURL, playgroundID: hostedRecord.id) == canonicalHostedRecordURL
        }
    }

    private func copyToClipboard(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}

private struct HostedRecordRow: View {
    let hostedRecord: HostedPlaygroundMetadata
    let localPlayground: Playground?
    let isImporting: Bool
    let importAction: () -> Void
    let openAction: () -> Void
    let openManifestAction: () -> Void
    let copyManifestAction: () -> Void

    private var localStatusLabel: String? {
        guard let localPlayground else { return nil }
        return localPlayground.hostedContentDigest == hostedRecord.contentDigest ? "Current locally" : "Update available"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: hostedRecord.kind.symbolName)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(hostedRecord.title)
                        .font(.headline)
                        .lineLimit(2)
                    HStack(spacing: 8) {
                        Text(hostedRecord.kind.displayName)
                        Text(hostedRecord.publishedAt, format: .relative(presentation: .named))
                        Text(hostedRecord.contentBytes.formatted(.byteCount(style: .file)))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let localStatusLabel {
                        Label(localStatusLabel, systemImage: localStatusLabel == "Current locally" ? "checkmark.circle" : "arrow.triangle.2.circlepath")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let annotation = hostedRecord.annotation, !annotation.isEmpty {
                        Label(annotation, systemImage: "note.text")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer()
            }
            HStack {
                Button("Open", systemImage: "safari", action: openAction)
                Button(localPlayground == nil ? "Import" : "Sync", systemImage: localPlayground == nil ? "square.and.arrow.down" : "arrow.triangle.2.circlepath") {
                    importAction()
                }
                .disabled(isImporting)
                if hostedRecord.manifestURL != nil {
                    Button("Manifest", systemImage: "curlybraces", action: openManifestAction)
                    Button("Copy Manifest", systemImage: "doc.on.doc", action: copyManifestAction)
                }
                if isImporting {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Importing hosted record")
                }
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
    }
}
