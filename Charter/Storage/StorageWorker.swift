import Foundation

/// File coordination, decoding and copying run on one queue, away from SwiftUI.
/// Serial execution also prevents two imports from choosing the same target name.
enum StorageWorker {
    private static let queue = DispatchQueue(label: "app.charter.storage", qos: .userInitiated)

    static func perform<T>(_ operation: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Result { try operation() }) }
        }
    }
}
