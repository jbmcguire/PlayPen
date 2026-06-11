import SwiftUI
import SwiftData
import MapKit

struct PlaygroundMapView: View {
    @Binding var selectedPlayground: Playground?
    @Query(filter: #Predicate<Playground> { $0.latitude != nil && $0.longitude != nil })
    private var geotaggedPlaygrounds: [Playground]
    @State private var selectedMarkerID: PersistentIdentifier?

    var body: some View {
        if geotaggedPlaygrounds.isEmpty {
            ContentUnavailableView {
                Label("No Geotagged Playgrounds", systemImage: "location.slash")
            } description: {
                Text("Tag a playground with your current location from its toolbar, and it will appear on this map.")
            }
        } else {
            Map(selection: $selectedMarkerID) {
                ForEach(geotaggedPlaygrounds) { playground in
                    if let coordinate = playground.coordinate {
                        Marker(playground.title, systemImage: playground.kind.symbolName, coordinate: coordinate)
                            .tag(playground.persistentModelID)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let markedPlayground {
                    MarkedPlaygroundCard(playground: markedPlayground) {
                        selectedPlayground = markedPlayground
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeOut(duration: 0.25), value: selectedMarkerID)
        }
    }

    private var markedPlayground: Playground? {
        guard let selectedMarkerID else { return nil }
        return geotaggedPlaygrounds.first { $0.persistentModelID == selectedMarkerID }
    }
}

struct MarkedPlaygroundCard: View {
    let playground: Playground
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(playground.title)
                    .font(.headline)
                    .lineLimit(1)
                if let placeName = playground.placeName, !placeName.isEmpty {
                    Text(placeName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Button("Open Playground") {
                onOpen()
            }
            .buttonStyle(.glassProminent)
        }
        .padding(14)
        .glassEffect(in: .rect(cornerRadius: 18))
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }
}
