import Foundation
import SwiftData

@Model
final class Project {
    var name: String
    var createdAt: Date
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
    @Attribute(.unique) var name: String
    var playgrounds: [Playground] = []

    init(name: String) {
        self.name = name
    }
}

@Model
final class Playground {
    var title: String
    var content: String
    var createdAt: Date
    var modifiedAt: Date
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
