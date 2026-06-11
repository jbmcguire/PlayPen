import SwiftUI
import SwiftData

struct TagEditorView: View {
    @Bindable var playground: Playground
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Tag.name) private var allTags: [Tag]
    @State private var newTagName = ""

    private var sortedTags: [Tag] {
        (playground.tags ?? []).sorted { $0.name < $1.name }
    }

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(sortedTags) { tag in
                HStack(spacing: 4) {
                    Text(tag.name)
                        .font(.caption)
                    Button {
                        removeTag(tag)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove tag \(tag.name)")
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(.tint.opacity(0.15), in: .capsule)
                .foregroundStyle(.tint)
            }

            TextField("Add tag…", text: $newTagName)
                .textFieldStyle(.plain)
                .font(.caption)
                .frame(width: 90)
                .onSubmit { addTag() }
        }
    }

    private func addTag() {
        let normalizedName = newTagName
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        newTagName = ""
        guard !normalizedName.isEmpty else { return }
        let currentTags = playground.tags ?? []
        guard !currentTags.contains(where: { $0.name == normalizedName }) else { return }

        if let existingTag = allTags.first(where: { $0.name == normalizedName }) {
            playground.tags = currentTags + [existingTag]
            return
        }
        let tag = Tag(name: normalizedName)
        modelContext.insert(tag)
        playground.tags = currentTags + [tag]
    }

    private func removeTag(_ tag: Tag) {
        var remainingTags = playground.tags ?? []
        remainingTags.removeAll { $0 == tag }
        playground.tags = remainingTags
    }
}

nonisolated struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let containerWidth = proposal.width ?? .infinity
        let placements = computePlacements(subviews: subviews, containerWidth: containerWidth)
        let height = placements.map { $0.position.y + $0.size.height }.max() ?? 0
        return CGSize(width: containerWidth == .infinity ? (placements.map { $0.position.x + $0.size.width }.max() ?? 0) : containerWidth, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placements = computePlacements(subviews: subviews, containerWidth: bounds.width)
        for (index, subview) in subviews.enumerated() {
            let placement = placements[index]
            subview.place(
                at: CGPoint(x: bounds.minX + placement.position.x, y: bounds.minY + placement.position.y),
                proposal: ProposedViewSize(placement.size)
            )
        }
    }

    private struct Placement {
        let position: CGPoint
        let size: CGSize
    }

    private func computePlacements(subviews: Subviews, containerWidth: CGFloat) -> [Placement] {
        var placements: [Placement] = []
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var currentLineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursorX > 0, cursorX + size.width > containerWidth {
                cursorX = 0
                cursorY += currentLineHeight + spacing
                currentLineHeight = 0
            }
            placements.append(Placement(position: CGPoint(x: cursorX, y: cursorY), size: size))
            cursorX += size.width + spacing
            currentLineHeight = max(currentLineHeight, size.height)
        }
        return placements
    }
}
