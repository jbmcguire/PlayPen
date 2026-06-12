import CryptoKit
import Foundation

struct HostedPlaygroundPayload: Codable {
    let version: Int
    let id: String
    let title: String
    let kind: PlaygroundKind
    let annotation: String?
    let content: String
    let publishedAt: Date
}

struct HostedPublishResult {
    let id: String
    let url: URL
    let manifestURL: URL?
    let publishedAt: Date
    let contentDigest: String
    let annotation: String?
    let didUseHostedAPI: Bool
    let fallbackReason: String?
}

struct HostedServiceHealth: Decodable {
    let ok: Bool
    let storage: String
    let publicBaseURL: String
    let publishAuthRequired: Bool?
}

struct HostedPlaygroundMetadata: Decodable, Identifiable {
    let id: String
    let title: String
    let kind: PlaygroundKind
    let annotation: String?
    let publishedAt: Date
    let contentBytes: Int
    let contentDigest: String
    let url: URL
    let manifestURL: URL?
    let recordURL: URL
    let sourceURL: URL
}

struct HostedPlaygroundList: Decodable {
    let ok: Bool
    let storage: String
    let total: Int
    let count: Int
    let limit: Int
    let offset: Int
    let items: [HostedPlaygroundMetadata]
}

enum HostedPlaygroundError: LocalizedError {
    case invalidLink
    case missingHostedRecordID
    case invalidServerResponse
    case bundledServiceHasNoHealthEndpoint

    var errorDescription: String? {
        switch self {
        case .invalidLink:
            return "This is not a valid PlayPen mirror link."
        case .missingHostedRecordID:
            return "This hosted mirror link does not include a playground ID."
        case .invalidServerResponse:
            return "The hosted service returned an invalid playground."
        case .bundledServiceHasNoHealthEndpoint:
            return "Set a hosted service URL before checking health."
        }
    }
}

enum HostedPlaygroundService {
    static let serviceURLOverrideKey = "HostedPlaygroundService.serviceURLOverride"
    static let publishTokenKey = "HostedPlaygroundService.publishToken"

    static var serviceURL: URL {
        if let overrideURL = configuredURL(from: UserDefaults.standard.string(forKey: serviceURLOverrideKey)) {
            return overrideURL
        }
        if let configuredURLString = Bundle.main.object(forInfoDictionaryKey: "PlayPenHostedServiceURL") as? String,
           let configuredURL = configuredURL(from: configuredURLString) {
            return configuredURL
        }
        if let bundledServiceURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Hosted") {
            return bundledServiceURL
        }
        return URL(string: "https://playpen.example/host/")!
    }

    static var isUsingBundledService: Bool {
        serviceURL.isFileURL
    }

    static var serviceName: String {
        if serviceURL.isFileURL {
            return "Local mirror service"
        }
        return serviceURL.host ?? "Hosted mirror service"
    }

    static func link(for playground: Playground) -> URL {
        let publishedAt = playground.hostedPublishedAt ?? .now
        let payload = payload(for: playground, publishedAt: publishedAt)
        return encodedSnapshotLink(for: payload)
    }

    static func publish(_ playground: Playground) async throws -> HostedPublishResult {
        let publishedAt = Date.now
        let payload = payload(for: playground, publishedAt: publishedAt)
        let digest = contentDigest(for: playground)
        guard let publishTarget = publishTarget(for: playground, playgroundID: payload.id) else {
            return HostedPublishResult(
                id: payload.id,
                url: encodedSnapshotLink(for: payload),
                manifestURL: nil,
                publishedAt: publishedAt,
                contentDigest: digest,
                annotation: payload.annotation,
                didUseHostedAPI: false,
                fallbackReason: nil
            )
        }

        do {
            let publishResponse = try await send(payload, to: publishTarget.url, method: publishTarget.method)
            let hostedURL = URL(string: publishResponse.url, relativeTo: serviceURL)?.absoluteURL ?? encodedSnapshotLink(for: payload)
            let canonicalHostedURL = canonicalHostedURL(for: hostedURL, playgroundID: publishResponse.id)
            let confirmedDigest = publishResponse.contentDigest ?? digest
            return HostedPublishResult(
                id: publishResponse.id,
                url: canonicalHostedURL,
                manifestURL: absoluteURL(publishResponse.manifestURL, relativeTo: serviceURL),
                publishedAt: publishResponse.publishedAt ?? publishedAt,
                contentDigest: confirmedDigest,
                annotation: publishResponse.annotation ?? payload.annotation,
                didUseHostedAPI: true,
                fallbackReason: nil
            )
        } catch {
            if let rejection = error as? HostedAPIRejection, !rejection.shouldUseStaticFallback {
                throw rejection
            }
            return HostedPublishResult(
                id: payload.id,
                url: encodedSnapshotLink(for: payload),
                manifestURL: nil,
                publishedAt: publishedAt,
                contentDigest: digest,
                annotation: payload.annotation,
                didUseHostedAPI: false,
                fallbackReason: error.localizedDescription
            )
        }
    }

    static func resolve(_ hostedURL: URL) async throws -> HostedPlaygroundPayload {
        if let encodedPayload = encodedPayload(in: hostedURL) {
            return try decode(encodedPayload)
        }
        let playgroundID = try playgroundID(in: hostedURL)
        let endpointURL = recordEndpointURL(for: hostedURL, playgroundID: playgroundID)
        return try await getPayload(from: endpointURL)
    }

    static func manifestURL(for playground: Playground) -> URL? {
        guard let hostedURL = playground.hostedURL else { return nil }
        guard !hostedURL.isFileURL else { return nil }
        guard encodedPayload(in: hostedURL) == nil else { return nil }
        let hostedRecordID = playground.hostedID ?? (try? playgroundID(in: hostedURL))
        guard let hostedRecordID else { return nil }
        return recordEndpointURL(for: hostedURL, playgroundID: hostedRecordID).appendingPathComponent("manifest")
    }

    static func canonicalHostedURL(for hostedURL: URL, payload: HostedPlaygroundPayload) -> URL {
        canonicalHostedURL(for: hostedURL, playgroundID: payload.id)
    }

    static func canonicalHostedURL(for hostedURL: URL, playgroundID: String) -> URL {
        guard encodedPayload(in: hostedURL) == nil else { return hostedURL }
        return viewURL(for: hostedURL, playgroundID: playgroundID)
    }

    static func checkHealth(at serviceURL: URL = serviceURL) async throws -> HostedServiceHealth {
        guard !serviceURL.isFileURL else { throw HostedPlaygroundError.bundledServiceHasNoHealthEndpoint }
        let endpointURL = healthEndpointURL(for: serviceURL)
        var request = URLRequest(url: endpointURL)
        request.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try jsonDecoder.decode(HostedServiceHealth.self, from: data)
    }

    static func listHostedPlaygrounds(limit: Int = 50, offset: Int = 0, at serviceURL: URL = serviceURL) async throws -> HostedPlaygroundList {
        guard !serviceURL.isFileURL else { throw HostedPlaygroundError.bundledServiceHasNoHealthEndpoint }
        let endpointURL = listEndpointURL(for: serviceURL, limit: limit, offset: offset)
        var request = URLRequest(url: endpointURL)
        request.setValue("application/json", forHTTPHeaderField: "accept")
        let (responseBody, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try jsonDecoder.decode(HostedPlaygroundList.self, from: responseBody)
    }

    static func contentDigest(for playground: Playground) -> String {
        contentDigest(
            title: playground.title,
            kindRawValue: playground.kindRawValue,
            annotation: annotation(for: playground),
            content: playground.content
        )
    }

    static func contentDigest(for payload: HostedPlaygroundPayload) -> String {
        contentDigest(
            title: payload.title,
            kindRawValue: payload.kind.rawValue,
            annotation: payload.annotation,
            content: payload.content
        )
    }

    private static func contentDigest(title: String, kindRawValue: String, annotation: String?, content: String) -> String {
        var digestParts = [
            title,
            kindRawValue,
            content
        ]
        if let annotation {
            let trimmedAnnotation = annotation.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedAnnotation.isEmpty {
                digestParts.append(trimmedAnnotation)
            }
        }
        let digestInput = digestParts.joined(separator: "\n")
        let digest = SHA256.hash(data: Data(digestInput.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static var apiEndpointURL: URL? {
        guard !serviceURL.isFileURL else { return nil }
        return playgroundsEndpointURL(for: serviceURL)
    }

    private static var publishToken: String? {
        let token = UserDefaults.standard.string(forKey: publishTokenKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return token.isEmpty ? nil : token
    }

    private static func configuredURL(from urlString: String?) -> URL? {
        guard let trimmedURLString = urlString?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmedURLString.isEmpty,
              let configuredURL = URL(string: trimmedURLString) else {
            return nil
        }
        return configuredURL
    }

    private static func absoluteURL(_ urlString: String?, relativeTo baseURL: URL) -> URL? {
        guard let urlString, !urlString.isEmpty else { return nil }
        return URL(string: urlString, relativeTo: baseURL)?.absoluteURL
    }

    private static func recordEndpointURL(for hostedURL: URL, playgroundID: String) -> URL {
        let pathComponents = hostedURL.deletingQueryAndFragment().pathComponents.filter { $0 != "/" }
        if let apiIndex = pathComponents.lastIndex(of: "api"),
           pathComponents.indices.contains(pathComponents.index(after: apiIndex)),
           pathComponents[pathComponents.index(after: apiIndex)] == "playgrounds" {
            let prefixComponents = Array(pathComponents[..<apiIndex])
            return hostedURL.withPathComponents(prefixComponents + ["api", "playgrounds", playgroundID])
        }
        if let pIndex = pathComponents.lastIndex(of: "p") {
            let prefixComponents = Array(pathComponents[..<pIndex])
            return hostedURL.withPathComponents(prefixComponents + ["api", "playgrounds", playgroundID])
        }
        var baseURL = hostedURL.deletingQueryAndFragment()
        if !baseURL.pathExtension.isEmpty {
            baseURL.deleteLastPathComponent()
        }
        return baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("playgrounds")
            .appendingPathComponent(playgroundID)
    }

    private static func viewURL(for hostedURL: URL, playgroundID: String) -> URL {
        let pathComponents = hostedURL.deletingQueryAndFragment().pathComponents.filter { $0 != "/" }
        if let apiIndex = pathComponents.lastIndex(of: "api") {
            let prefixComponents = Array(pathComponents[..<apiIndex])
            return hostedURL.withPathComponents(prefixComponents + ["p", playgroundID])
        }
        if let pIndex = pathComponents.lastIndex(of: "p") {
            let prefixComponents = Array(pathComponents[..<pIndex])
            return hostedURL.withPathComponents(prefixComponents + ["p", playgroundID])
        }
        var baseURL = hostedURL.deletingQueryAndFragment()
        if !baseURL.pathExtension.isEmpty {
            baseURL.deleteLastPathComponent()
        }
        return baseURL
            .appendingPathComponent("p")
            .appendingPathComponent(playgroundID)
    }

    private static func healthEndpointURL(for serviceURL: URL) -> URL {
        var baseURL = serviceURL.deletingQueryAndFragment()
        if !baseURL.pathExtension.isEmpty {
            baseURL.deleteLastPathComponent()
        }
        return baseURL.appendingPathComponent("api").appendingPathComponent("health")
    }

    private static func listEndpointURL(for serviceURL: URL, limit: Int, offset: Int) -> URL {
        let endpointURL = playgroundsEndpointURL(for: serviceURL)
        guard var components = URLComponents(url: endpointURL, resolvingAgainstBaseURL: false) else { return endpointURL }
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 100)))),
            URLQueryItem(name: "offset", value: String(max(0, offset)))
        ]
        return components.url ?? endpointURL
    }

    private static func playgroundsEndpointURL(for serviceURL: URL) -> URL {
        var baseURL = serviceURL.deletingQueryAndFragment()
        if !baseURL.pathExtension.isEmpty {
            baseURL.deleteLastPathComponent()
        }
        return baseURL.appendingPathComponent("api").appendingPathComponent("playgrounds")
    }

    private static func payload(for playground: Playground, publishedAt: Date) -> HostedPlaygroundPayload {
        HostedPlaygroundPayload(
            version: 1,
            id: playground.hostedID ?? UUID().uuidString,
            title: playground.title,
            kind: playground.kind,
            annotation: annotation(for: playground),
            content: playground.content,
            publishedAt: publishedAt
        )
    }

    private static func annotation(for playground: Playground) -> String? {
        let trimmedAnnotation = playground.annotation.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedAnnotation.isEmpty ? nil : trimmedAnnotation
    }

    private static func encodedSnapshotLink(for payload: HostedPlaygroundPayload) -> URL {
        let encodedPayload = encode(payload)
        var components = URLComponents(url: serviceURL, resolvingAgainstBaseURL: false)
        components?.fragment = "playground=\(encodedPayload)"
        return components?.url ?? serviceURL
    }

    private static func publishTarget(for playground: Playground, playgroundID: String) -> HostedPublishTarget? {
        if playground.hostedID != nil,
           let hostedURL = playground.hostedURL,
           !hostedURL.isFileURL,
           encodedPayload(in: hostedURL) == nil {
            return HostedPublishTarget(url: recordEndpointURL(for: hostedURL, playgroundID: playgroundID), method: "PUT")
        }
        guard let apiEndpointURL else { return nil }
        return HostedPublishTarget(url: apiEndpointURL, method: "POST")
    }

    private static func send(_ payload: HostedPlaygroundPayload, to endpointURL: URL, method: String) async throws -> HostedPublishResponse {
        var request = URLRequest(url: endpointURL)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let publishToken {
            request.setValue("Bearer \(publishToken)", forHTTPHeaderField: "authorization")
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw HostedAPIRejection(statusCode: httpResponse.statusCode, body: data)
        }
        return try jsonDecoder.decode(HostedPublishResponse.self, from: data)
    }

    private static func getPayload(from endpointURL: URL) async throws -> HostedPlaygroundPayload {
        var request = URLRequest(url: endpointURL)
        request.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        let payload = try jsonDecoder.decode(HostedPlaygroundPayload.self, from: data)
        guard payload.version == 1 else { throw HostedPlaygroundError.invalidServerResponse }
        return payload
    }

    private static func encode(_ payload: HostedPlaygroundPayload) -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = (try? encoder.encode(payload)) ?? Data()
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func decode(_ encodedPayload: String) throws -> HostedPlaygroundPayload {
        var base64 = encodedPayload
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = (4 - base64.count % 4) % 4
        base64 += String(repeating: "=", count: padding)
        guard let data = Data(base64Encoded: base64) else { throw HostedPlaygroundError.invalidLink }
        let payload = try jsonDecoder.decode(HostedPlaygroundPayload.self, from: data)
        guard payload.version == 1 else { throw HostedPlaygroundError.invalidLink }
        return payload
    }

    private static func encodedPayload(in hostedURL: URL) -> String? {
        if let fragment = hostedURL.fragment,
           let components = URLComponents(string: "playpen://fragment?\(fragment)"),
           let encodedPayload = components.queryItems?.first(where: { $0.name == "playground" || $0.name == "p" })?.value {
            return encodedPayload
        }
        guard let components = URLComponents(url: hostedURL, resolvingAgainstBaseURL: false) else { return nil }
        return components.queryItems?.first(where: { $0.name == "playground" || $0.name == "p" })?.value
    }

    private static func playgroundID(in hostedURL: URL) throws -> String {
        let pathComponents = hostedURL.pathComponents.filter { $0 != "/" }
        if let pIndex = pathComponents.lastIndex(of: "p"),
           pathComponents.indices.contains(pathComponents.index(after: pIndex)) {
            let playgroundID = pathComponents[pathComponents.index(after: pIndex)]
            guard !playgroundID.isEmpty else { throw HostedPlaygroundError.missingHostedRecordID }
            return playgroundID
        }
        guard let apiIndex = pathComponents.lastIndex(of: "api") else {
            throw HostedPlaygroundError.missingHostedRecordID
        }
        let playgroundsIndex = pathComponents.index(after: apiIndex)
        guard pathComponents.indices.contains(playgroundsIndex),
              pathComponents[playgroundsIndex] == "playgrounds" else {
            throw HostedPlaygroundError.missingHostedRecordID
        }
        let playgroundIDIndex = pathComponents.index(after: playgroundsIndex)
        guard pathComponents.indices.contains(playgroundIDIndex) else {
            throw HostedPlaygroundError.missingHostedRecordID
        }
        let playgroundID = pathComponents[playgroundIDIndex]
        guard !playgroundID.isEmpty else { throw HostedPlaygroundError.missingHostedRecordID }
        return playgroundID
    }

    private static var jsonDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractionalFormatter = ISO8601DateFormatter()
            fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let standardFormatter = ISO8601DateFormatter()
            standardFormatter.formatOptions = [.withInternetDateTime]
            if let date = fractionalFormatter.date(from: value) ?? standardFormatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date.")
        }
        return decoder
    }
}

private struct HostedPublishResponse: Decodable {
    let id: String
    let url: String
    let manifestURL: String?
    let publishedAt: Date?
    let contentDigest: String?
    let annotation: String?
}

private struct HostedPublishTarget {
    let url: URL
    let method: String
}

nonisolated private struct HostedAPIErrorBody: Decodable {
    let error: String?
    let code: String?
}

private struct HostedAPIRejection: LocalizedError {
    let statusCode: Int
    let code: String?
    let message: String

    init(statusCode: Int, body: Data) {
        self.statusCode = statusCode
        if let payload = try? JSONDecoder().decode(HostedAPIErrorBody.self, from: body) {
            code = payload.code
            message = payload.error ?? HTTPURLResponse.localizedString(forStatusCode: statusCode)
            return
        }
        code = nil
        message = HTTPURLResponse.localizedString(forStatusCode: statusCode)
    }

    var shouldUseStaticFallback: Bool {
        statusCode == 404 || statusCode == 405 || statusCode == 501
    }

    var errorDescription: String? {
        if let code {
            return "Hosted service rejected the publish (\(statusCode) \(code)): \(message)"
        }
        return "Hosted service rejected the publish (\(statusCode)): \(message)"
    }
}

private extension URL {
    func deletingQueryAndFragment() -> URL {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else { return self }
        components.query = nil
        components.fragment = nil
        return components.url ?? self
    }

    func withPathComponents(_ pathComponents: [String]) -> URL {
        guard var components = URLComponents(url: deletingQueryAndFragment(), resolvingAgainstBaseURL: false) else { return self }
        components.path = "/" + pathComponents.map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? $0 }.joined(separator: "/")
        return components.url ?? self
    }
}
