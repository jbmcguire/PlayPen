import SwiftUI
import SwiftData

enum SidebarSelection: Hashable {
    case all
    case project(Project)
    case tag(Tag)
}

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var sidebarSelection: SidebarSelection? = .all
    @State private var selectedPlayground: Playground?
    @State private var searchText = ""
    @State private var searchTokens: [Tag] = []
    @State private var isShowingDeepLinkImportError = false
    @State private var deepLinkImportErrorMessage = ""
    @State private var isShowingDeepLinkMessage = false
    @State private var deepLinkMessageTitle = ""
    @State private var deepLinkMessage = ""
    @State private var isImportingDeepLink = false
    @Query(sort: \Playground.modifiedAt, order: .reverse) private var playgrounds: [Playground]

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $sidebarSelection, selectedPlayground: $selectedPlayground)
                .navigationSplitViewColumnWidth(min: 200, ideal: 230)
        } content: {
            PlaygroundListView(
                sidebarSelection: sidebarSelection ?? .all,
                selectedPlayground: $selectedPlayground,
                searchText: searchText,
                searchTokens: searchTokens
            )
            .navigationSplitViewColumnWidth(min: 260, ideal: 300)
        } detail: {
            if let selectedPlayground {
                PlaygroundDetailView(playground: selectedPlayground)
                    .id(selectedPlayground.persistentModelID)
            } else {
                ContentUnavailableView(
                    "No Playground Selected",
                    systemImage: "square.dashed",
                    description: Text("Select a playground from the list, or create a new one.")
                )
            }
        }
        .onAppear {
            selectFirstPlaygroundIfNeeded()
        }
        .onChange(of: playgrounds.count) {
            selectFirstPlaygroundIfNeeded()
        }
        .searchable(text: $searchText, tokens: $searchTokens, placement: .sidebar, prompt: "Search playgrounds") { token in
            Label(token.name, systemImage: "tag")
        }
        .searchSuggestions {
            SearchTagSuggestions(searchText: searchText, activeTokens: $searchTokens)
        }
        .onOpenURL { incomingURL in
            handlePlayPenLink(incomingURL)
        }
        .alert("Couldn't Import Hosted Link", isPresented: $isShowingDeepLinkImportError) {
        } message: {
            Text(deepLinkImportErrorMessage)
        }
        .alert(deepLinkMessageTitle, isPresented: $isShowingDeepLinkMessage) {
        } message: {
            Text(deepLinkMessage)
        }
        .overlay(alignment: .top) {
            if isImportingDeepLink {
                Label("Importing hosted mirror", systemImage: "link")
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.regularMaterial, in: .capsule)
                    .padding(.top, 12)
            }
        }
    }

    private func selectFirstPlaygroundIfNeeded() {
        guard selectedPlayground == nil else { return }
        selectedPlayground = playgrounds.first
    }

    private func handlePlayPenLink(_ incomingURL: URL) {
        guard incomingURL.scheme == "playpen" else { return }
        switch incomingURL.host {
        case "import":
            importHostedMirror(from: incomingURL)
        case "configure":
            configureHostedService(from: incomingURL)
        default:
            presentDeepLinkImportError("This PlayPen link is not supported.")
        }
    }

    private func importHostedMirror(from incomingURL: URL) {
        guard let hostedURL = hostedURL(from: incomingURL) else {
            presentDeepLinkImportError("This PlayPen link is missing a hosted mirror URL.")
            return
        }
        guard !isImportingDeepLink else { return }
        isImportingDeepLink = true
        Task {
            defer { isImportingDeepLink = false }
            do {
                let payload = try await HostedPlaygroundService.resolve(hostedURL)
                let playground = Playground(
                    title: payload.title.isEmpty ? "Untitled Playground" : payload.title,
                    content: payload.content,
                    kind: payload.kind
                )
                playground.annotation = payload.annotation ?? ""
                playground.hostedID = payload.id
                playground.hostedURL = HostedPlaygroundService.canonicalHostedURL(for: hostedURL, payload: payload)
                playground.hostedPublishedAt = payload.publishedAt
                playground.hostedContentDigest = HostedPlaygroundService.contentDigest(for: payload)
                playground.modifiedAt = .now
                modelContext.insert(playground)
                sidebarSelection = .all
                selectedPlayground = playground
            } catch {
                presentDeepLinkImportError(error.localizedDescription)
            }
        }
    }

    private func configureHostedService(from incomingURL: URL) {
        guard let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false),
              let serviceURLString = components.queryItems?.first(where: { $0.name == "service" })?.value,
              let serviceURL = URL(string: serviceURLString),
              serviceURL.scheme == "http" || serviceURL.scheme == "https" else {
            presentDeepLinkImportError("This PlayPen configure link is missing a valid service URL.")
            return
        }
        UserDefaults.standard.set(serviceURL.absoluteString, forKey: HostedPlaygroundService.serviceURLOverrideKey)
        deepLinkMessageTitle = "Hosted Service Configured"
        deepLinkMessage = "PlayPen will publish to \(serviceURL.absoluteString)."
        isShowingDeepLinkMessage = true
    }

    private func hostedURL(from incomingURL: URL) -> URL? {
        guard incomingURL.scheme == "playpen",
              incomingURL.host == "import",
              let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false),
              let hostedURLString = components.queryItems?.first(where: { $0.name == "url" })?.value else {
            return nil
        }
        return URL(string: hostedURLString)
    }

    private func presentDeepLinkImportError(_ message: String) {
        deepLinkImportErrorMessage = message
        isShowingDeepLinkImportError = true
    }
}

struct SearchTagSuggestions: View {
    @Query(sort: \Tag.name) private var allTags: [Tag]
    let searchText: String
    @Binding var activeTokens: [Tag]

    var body: some View {
        let matchingTags = allTags.filter { tag in
            !activeTokens.contains(tag) &&
            (searchText.isEmpty || tag.name.localizedCaseInsensitiveContains(searchText))
        }
        ForEach(matchingTags) { tag in
            Label(tag.name, systemImage: "tag")
                .searchCompletion(tag)
        }
    }
}
