import Foundation
import Markdown

nonisolated struct HeadingOutlineItem: Identifiable {
    let id: Int
    let level: Int
    let title: String
    let lineNumber: Int
}

nonisolated enum MarkdownOutline {
    static func headings(in markdown: String) -> [HeadingOutlineItem] {
        var collector = HeadingCollector()
        collector.visit(Document(parsing: markdown))
        return collector.headings
    }
}

private nonisolated struct HeadingCollector: MarkupWalker {
    var headings: [HeadingOutlineItem] = []

    mutating func visitHeading(_ heading: Heading) {
        headings.append(HeadingOutlineItem(
            id: headings.count,
            level: heading.level,
            title: heading.plainText,
            lineNumber: heading.range?.lowerBound.line ?? 1
        ))
    }
}
