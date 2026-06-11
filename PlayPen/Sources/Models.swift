import Foundation
import SwiftData

@Model
final class Project {
    var name: String = ""
    var createdAt: Date = Date.now
    var sortIndex: Int = 0

    @Relationship(deleteRule: .cascade, inverse: \Playground.project)
    var playgrounds: [Playground] = []

    init(name: String) {
        self.name = name
        self.createdAt = .now
    }
}

@Model
final class Tag {
    var name: String = ""
    var playgrounds: [Playground] = []

    init(name: String) {
        self.name = name
    }
}

@Model
final class Playground {
    var title: String = ""
    var content: String = ""
    var createdAt: Date = Date.now
    var modifiedAt: Date = Date.now
    var project: Project?

    @Relationship(inverse: \Tag.playgrounds)
    var tags: [Tag] = []

    init(title: String, content: String = "", project: Project? = nil) {
        self.title = title
        self.content = content
        self.createdAt = .now
        self.modifiedAt = .now
        self.project = project
    }

    var snippet: String {
        let firstContentLine = content
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty && !$0.hasPrefix("#") }
        return firstContentLine ?? "Empty playground"
    }
}

extension Tag {
    static func deduplicate(in context: ModelContext) {
        guard let allTags = try? context.fetch(FetchDescriptor<Tag>(sortBy: [SortDescriptor(\.name)])) else { return }

        var canonicalTagsByName: [String: Tag] = [:]
        for tag in allTags {
            guard let canonicalTag = canonicalTagsByName[tag.name] else {
                canonicalTagsByName[tag.name] = tag
                continue
            }
            let affectedPlaygrounds = Array(tag.playgrounds)
            for playground in affectedPlaygrounds {
                if !playground.tags.contains(canonicalTag) {
                    playground.tags.append(canonicalTag)
                }
                playground.tags.removeAll { $0 == tag }
            }
            context.delete(tag)
        }

        guard context.hasChanges else { return }
        try? context.save()
    }
}
