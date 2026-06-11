import Foundation
import Markdown

nonisolated enum MarkdownHTML {
    static func render(_ markdown: String) -> String {
        var renderer = HTMLVisitor()
        return renderer.visit(Document(parsing: markdown))
    }
}

nonisolated struct HTMLVisitor: MarkupVisitor {
    typealias Result = String

    mutating func defaultVisit(_ markup: any Markup) -> String {
        childrenHTML(of: markup)
    }

    private mutating func childrenHTML(of markup: any Markup) -> String {
        markup.children.map { visit($0) }.joined()
    }

    mutating func visitDocument(_ document: Document) -> String {
        childrenHTML(of: document)
    }

    mutating func visitHeading(_ heading: Heading) -> String {
        "<h\(heading.level)>\(childrenHTML(of: heading))</h\(heading.level)>\n"
    }

    mutating func visitParagraph(_ paragraph: Paragraph) -> String {
        "<p>\(childrenHTML(of: paragraph))</p>\n"
    }

    mutating func visitText(_ text: Markdown.Text) -> String {
        text.string.htmlEscaped
    }

    mutating func visitEmphasis(_ emphasis: Emphasis) -> String {
        "<em>\(childrenHTML(of: emphasis))</em>"
    }

    mutating func visitStrong(_ strong: Strong) -> String {
        "<strong>\(childrenHTML(of: strong))</strong>"
    }

    mutating func visitStrikethrough(_ strikethrough: Strikethrough) -> String {
        "<del>\(childrenHTML(of: strikethrough))</del>"
    }

    mutating func visitInlineCode(_ inlineCode: InlineCode) -> String {
        "<code>\(inlineCode.code.htmlEscaped)</code>"
    }

    mutating func visitCodeBlock(_ codeBlock: CodeBlock) -> String {
        let languageClass = codeBlock.language.map { " class=\"language-\($0.htmlEscaped)\"" } ?? ""
        return "<pre><code\(languageClass)>\(codeBlock.code.htmlEscaped)</code></pre>\n"
    }

    mutating func visitLink(_ link: Markdown.Link) -> String {
        let destination = link.destination?.htmlEscaped ?? "#"
        return "<a href=\"\(destination)\">\(childrenHTML(of: link))</a>"
    }

    mutating func visitImage(_ image: Markdown.Image) -> String {
        let source = image.source?.htmlEscaped ?? ""
        let altText = image.plainText.htmlEscaped
        return "<img src=\"\(source)\" alt=\"\(altText)\">"
    }

    mutating func visitUnorderedList(_ unorderedList: UnorderedList) -> String {
        "<ul>\n\(childrenHTML(of: unorderedList))</ul>\n"
    }

    mutating func visitOrderedList(_ orderedList: OrderedList) -> String {
        "<ol>\n\(childrenHTML(of: orderedList))</ol>\n"
    }

    mutating func visitListItem(_ listItem: ListItem) -> String {
        "<li>\(childrenHTML(of: listItem))</li>\n"
    }

    mutating func visitBlockQuote(_ blockQuote: BlockQuote) -> String {
        "<blockquote>\n\(childrenHTML(of: blockQuote))</blockquote>\n"
    }

    mutating func visitThematicBreak(_ thematicBreak: ThematicBreak) -> String {
        "<hr>\n"
    }

    mutating func visitLineBreak(_ lineBreak: LineBreak) -> String {
        "<br>\n"
    }

    mutating func visitSoftBreak(_ softBreak: SoftBreak) -> String {
        "\n"
    }

    mutating func visitTable(_ table: Markdown.Table) -> String {
        "<table>\n\(childrenHTML(of: table))</table>\n"
    }

    mutating func visitTableHead(_ tableHead: Markdown.Table.Head) -> String {
        let cells = tableHead.children.map { "<th>\(visit($0))</th>" }.joined()
        return "<thead><tr>\(cells)</tr></thead>\n"
    }

    mutating func visitTableBody(_ tableBody: Markdown.Table.Body) -> String {
        "<tbody>\n\(childrenHTML(of: tableBody))</tbody>\n"
    }

    mutating func visitTableRow(_ tableRow: Markdown.Table.Row) -> String {
        let cells = tableRow.children.map { "<td>\(visit($0))</td>" }.joined()
        return "<tr>\(cells)</tr>\n"
    }

    mutating func visitTableCell(_ tableCell: Markdown.Table.Cell) -> String {
        childrenHTML(of: tableCell)
    }

    mutating func visitHTMLBlock(_ html: HTMLBlock) -> String {
        html.rawHTML
    }

    mutating func visitInlineHTML(_ inlineHTML: InlineHTML) -> String {
        inlineHTML.rawHTML
    }
}

nonisolated extension String {
    var htmlEscaped: String {
        replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
