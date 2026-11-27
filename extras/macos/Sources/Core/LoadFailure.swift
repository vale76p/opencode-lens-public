import Foundation

/// Why the dashboard is not shown: the native error page says which, and retries by itself.
public enum LoadFailure: Equatable, Sendable {
    /// No answer from the lens at this address ("host:port").
    case unreachable(String)
    /// HTTP 401 even after reading the plist again: the token is missing or wrong.
    case unauthorized
    /// LENS_HOST names an address the app does not connect to.
    case unsupportedHost(String)

    /// A failed main-frame load as a LoadFailure, or nil when it is not a failure to show:
    /// a cancelled load (-999, e.g. a new load started) or WebKit's "interrupted by a policy
    /// change" (102, a download or a link sent to the browser). Other WebKit errors are not
    /// connection problems either.
    public static func fromError(domain: String, code: Int, address: String) -> LoadFailure? {
        guard domain == NSURLErrorDomain else { return nil }
        return code == NSURLErrorCancelled ? nil : .unreachable(address)
    }

    /// Seconds before the next automatic attempt: 2, 4, 8, 16, then every 30 (attempt from 0).
    public static func retryDelay(attempt: Int) -> TimeInterval {
        let steps: [TimeInterval] = [2, 4, 8, 16]
        return attempt >= 0 && attempt < steps.count ? steps[attempt] : (attempt < 0 ? steps[0] : 30)
    }
}
