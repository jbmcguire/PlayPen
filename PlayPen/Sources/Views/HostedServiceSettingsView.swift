import SwiftUI

struct HostedServiceSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(HostedPlaygroundService.serviceURLOverrideKey) private var hostedServiceURLString = ""
    @AppStorage(HostedPlaygroundService.publishTokenKey) private var publishToken = ""
    @State private var draftURLString = ""
    @State private var draftPublishToken = ""
    @State private var validationMessage: String?
    @State private var healthMessage: String?
    @State private var isCheckingHealth = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Hosted Service") {
                    TextField("https://playpen.example", text: $draftURLString)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("Publish uses /api/playgrounds when this points at a PlayPen host. Empty uses the bundled local mirror fallback.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let validationMessage {
                        Text(validationMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    Button {
                        checkService()
                    } label: {
                        if isCheckingHealth {
                            ProgressView()
                        } else {
                            Label("Check Service", systemImage: "waveform.path.ecg")
                        }
                    }
                    if let healthMessage {
                        Text(healthMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Publish Access") {
                    SecureField("Optional publish token", text: $draftPublishToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("Sent only when publishing to /api/playgrounds. Viewing hosted links remains public.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Current Mirror") {
                    LabeledContent("Service", value: HostedPlaygroundService.serviceName)
                    Text(HostedPlaygroundService.serviceURL.absoluteString)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    if HostedPlaygroundService.isUsingBundledService {
                        Text("Using bundled fallback. Links are encoded snapshots until a hosted service URL is set.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Hosted Service")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                }
            }
            .onAppear {
                draftURLString = hostedServiceURLString
                draftPublishToken = publishToken
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        let trimmedURLString = draftURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedURLString.isEmpty else {
            hostedServiceURLString = ""
            publishToken = ""
            dismiss()
            return
        }
        guard let url = URL(string: trimmedURLString), url.scheme == "http" || url.scheme == "https" else {
            validationMessage = "Use an http or https service URL."
            return
        }
        hostedServiceURLString = url.absoluteString
        publishToken = draftPublishToken.trimmingCharacters(in: .whitespacesAndNewlines)
        dismiss()
    }

    private func checkService() {
        validationMessage = nil
        healthMessage = nil
        let trimmedURLString = draftURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmedURLString), url.scheme == "http" || url.scheme == "https" else {
            validationMessage = "Use an http or https service URL."
            return
        }
        guard !isCheckingHealth else { return }
        isCheckingHealth = true
        Task {
            defer { isCheckingHealth = false }
            do {
                let health = try await HostedPlaygroundService.checkHealth(at: url)
                let hostedPlaygrounds = try await HostedPlaygroundService.listHostedPlaygrounds(limit: 1, offset: 0, at: url)
                let authStatus = health.publishAuthRequired == true ? "publish token required" : "open publish"
                let recordLabel = hostedPlaygrounds.total == 1 ? "record" : "records"
                healthMessage = "OK: \(health.storage) storage at \(health.publicBaseURL) (\(authStatus), \(hostedPlaygrounds.total) hosted \(recordLabel))"
            } catch {
                validationMessage = error.localizedDescription
            }
        }
    }
}
