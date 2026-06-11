import SwiftUI
import SwiftData

enum SidebarSelection: Hashable {
    case all
    case map
    case project(Project)
    case tag(Tag)
}

struct ContentView: View {
    @State private var sidebarSelection: SidebarSelection? = .all
    @State private var selectedPlayground: Playground?
    @State private var searchText = ""
    @State private var searchTokens: [Tag] = []

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $sidebarSelection)
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
            if sidebarSelection == .map, selectedPlayground == nil {
                PlaygroundMapView(selectedPlayground: $selectedPlayground)
            } else if let selectedPlayground {
                PlaygroundDetailView(playground: selectedPlayground)
                    .id(selectedPlayground.persistentModelID)
                    .toolbar {
                        if sidebarSelection == .map {
                            ToolbarItem(placement: .navigation) {
                                Button("Back to Map", systemImage: "map") {
                                    self.selectedPlayground = nil
                                }
                            }
                        }
                    }
            } else {
                ContentUnavailableView(
                    "No Playground Selected",
                    systemImage: "square.dashed",
                    description: Text("Select a playground from the list, or create a new one.")
                )
            }
        }
        .onChange(of: sidebarSelection) {
            guard sidebarSelection == .map else { return }
            selectedPlayground = nil
        }
        .searchable(text: $searchText, tokens: $searchTokens, placement: .sidebar, prompt: "Search playgrounds") { token in
            Label(token.name, systemImage: "tag")
        }
        .searchSuggestions {
            SearchTagSuggestions(searchText: searchText, activeTokens: $searchTokens)
        }
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
