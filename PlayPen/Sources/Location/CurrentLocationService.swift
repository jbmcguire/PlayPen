import CoreLocation
import MapKit

enum CurrentLocationError: LocalizedError {
    case accessDenied
    case accessRestricted
    case fixUnavailable

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            "PlayPen doesn't have permission to use your location. Allow location access for PlayPen under Privacy & Security in Settings, then try again."
        case .accessRestricted:
            "Location access is restricted on this device, so PlayPen can't determine where you are."
        case .fixUnavailable:
            "Your current location couldn't be determined. Check that Location Services are turned on and try again."
        }
    }
}

struct CurrentLocationFix {
    let latitude: Double
    let longitude: Double
    let placeName: String?
}

enum CurrentLocationService {
    static func acquireFix() async throws -> CurrentLocationFix {
        let acquisitionTask = Task { try await firstQualifyingLocation() }
        let timeoutTask = Task {
            try? await Task.sleep(for: .seconds(30))
            acquisitionTask.cancel()
        }
        defer { timeoutTask.cancel() }

        let fixLocation: CLLocation
        do {
            fixLocation = try await acquisitionTask.value
        } catch let acquisitionError as CurrentLocationError {
            throw acquisitionError
        } catch let coreLocationError as CLError where coreLocationError.code == .denied {
            throw CurrentLocationError.accessDenied
        } catch {
            throw CurrentLocationError.fixUnavailable
        }

        let resolvedPlaceName = await reverseGeocodedPlaceName(for: fixLocation)
        return CurrentLocationFix(
            latitude: fixLocation.coordinate.latitude,
            longitude: fixLocation.coordinate.longitude,
            placeName: resolvedPlaceName
        )
    }

    private static func firstQualifyingLocation() async throws -> CLLocation {
        for try await update in CLLocationUpdate.liveUpdates() {
            if update.authorizationDenied || update.authorizationDeniedGlobally {
                throw CurrentLocationError.accessDenied
            }
            if update.authorizationRestricted {
                throw CurrentLocationError.accessRestricted
            }
            if let fixLocation = update.location {
                return fixLocation
            }
        }
        throw CurrentLocationError.fixUnavailable
    }

    private static func reverseGeocodedPlaceName(for fixLocation: CLLocation) async -> String? {
        guard let geocodingRequest = MKReverseGeocodingRequest(location: fixLocation) else { return nil }
        guard let geocodedMapItems = try? await geocodingRequest.mapItems else { return nil }
        guard let nearestMapItem = geocodedMapItems.first else { return nil }
        return nearestMapItem.name
            ?? nearestMapItem.addressRepresentations?.cityWithContext
            ?? nearestMapItem.address?.shortAddress
    }
}
