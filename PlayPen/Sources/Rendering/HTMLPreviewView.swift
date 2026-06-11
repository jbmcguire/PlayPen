import SwiftUI
import WebKit

struct HTMLPreviewView: View {
    let content: String
    let kind: PlaygroundKind

    @Environment(\.openURL) private var openURL
    @Binding var scrollTargetHeadingID: Int?
    @State private var navigationDecider: ExternalLinkNavigationDecider
    @State private var page: WebPage

    init(content: String, kind: PlaygroundKind, scrollTargetHeadingID: Binding<Int?> = .constant(nil)) {
        self.content = content
        self.kind = kind
        _scrollTargetHeadingID = scrollTargetHeadingID
        let decider = ExternalLinkNavigationDecider()
        _navigationDecider = State(initialValue: decider)
        _page = State(initialValue: WebPage(navigationDecider: decider))
    }

    var body: some View {
        WebView(page)
            .onAppear {
                navigationDecider.openExternalLink = { destinationURL in openURL(destinationURL) }
                loadPreview()
            }
            .onChange(of: content) { loadPreview() }
            .onChange(of: kind) { loadPreview() }
            .onChange(of: scrollTargetHeadingID) { scrollToTargetHeading() }
    }

    private func scrollToTargetHeading() {
        guard let headingIndex = scrollTargetHeadingID else { return }
        scrollTargetHeadingID = nil
        Task {
            _ = try? await page.callJavaScript(
                "document.getElementById(anchorID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })",
                arguments: ["anchorID": "heading-\(headingIndex)"]
            )
        }
    }

    private func loadPreview() {
        page.load(html: previewDocumentHTML, baseURL: URL(string: "about:blank")!)
    }

    private var previewDocumentHTML: String {
        switch kind {
        case .markdown:
            return Self.documentHTML(body: MarkdownHTML.render(content))
        case .html:
            let hasDocumentRoot = content.range(of: "<html", options: .caseInsensitive) != nil
            return hasDocumentRoot ? content : Self.documentHTML(body: content)
        }
    }

    private static func documentHTML(body: String) -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
        :root { color-scheme: light dark; }
        body {
            font: -apple-system-body;
            font-family: -apple-system, system-ui;
            font-size: 14px;
            line-height: 1.6;
            color: light-dark(#1d1d1f, #f5f5f7);
            background: transparent;
            max-width: 720px;
            margin: 0 auto;
            padding: 24px 32px 48px;
        }
        h1, h2, h3, h4 { font-weight: 600; letter-spacing: -0.01em; }
        h1 { font-size: 2em; margin-bottom: 0.4em; }
        h1, h2 {
            border-bottom: 1px solid light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.12));
            padding-bottom: 0.25em;
        }
        a { color: light-dark(#0066cc, #2997ff); text-decoration: none; }
        a:hover { text-decoration: underline; }
        code {
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
            font-size: 0.88em;
            background: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.1));
            border-radius: 4px;
            padding: 0.15em 0.4em;
        }
        pre {
            background: light-dark(rgba(0,0,0,0.04), rgba(255,255,255,0.07));
            border: 1px solid light-dark(rgba(0,0,0,0.07), rgba(255,255,255,0.1));
            border-radius: 10px;
            padding: 14px 16px;
            overflow-x: auto;
        }
        pre code { background: none; padding: 0; }
        blockquote {
            margin: 0;
            padding: 0.1em 1em;
            border-left: 3px solid light-dark(#0066cc, #2997ff);
            color: light-dark(#515154, #a1a1a6);
        }
        table { border-collapse: collapse; width: 100%; }
        th, td {
            border: 1px solid light-dark(rgba(0,0,0,0.12), rgba(255,255,255,0.15));
            padding: 6px 12px;
            text-align: left;
        }
        th { background: light-dark(rgba(0,0,0,0.04), rgba(255,255,255,0.07)); }
        hr { border: none; border-top: 1px solid light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.12)); }
        img { max-width: 100%; }
        </style>
        </head>
        <body>\(body)</body>
        </html>
        """
    }
}

final class ExternalLinkNavigationDecider: WebPage.NavigationDeciding {
    var openExternalLink: (URL) -> Void = { _ in }

    func decidePolicy(for action: WebPage.NavigationAction, preferences: inout WebPage.NavigationPreferences) async -> WKNavigationActionPolicy {
        guard action.navigationType == .linkActivated else { return .allow }
        guard let destinationURL = action.request.url else { return .cancel }
        guard destinationURL.scheme != "about" else { return .allow }
        openExternalLink(destinationURL)
        return .cancel
    }
}
