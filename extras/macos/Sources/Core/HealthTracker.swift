import Foundation

/// Whether the lens answers, from the app's checks (GET /healthz once a minute): «not
/// responding» only after `failuresBeforeDown` failed checks in a row, and only when the lens
/// had answered at least once since the app started; «responding again» when it comes back.
public struct HealthTracker: Sendable {
    public enum Event: Equatable, Sendable { case wentDown, cameBack }

    public static let failuresBeforeDown = 2

    /// nil until known; false after `failuresBeforeDown` failures in a row (also when the
    /// lens never answered: the Dock badge shows it, the notification does not).
    public private(set) var reachable: Bool?
    private var everUp = false
    private var failures = 0
    private var down = false

    public init() {}

    /// One check: true when /healthz answered 200 (a 503 of the diagnostic mode is a failure).
    public mutating func record(ok: Bool) -> Event? {
        if ok {
            failures = 0
            reachable = true
            everUp = true
            if down {
                down = false
                return .cameBack
            }
            return nil
        }
        failures += 1
        guard failures >= Self.failuresBeforeDown else { return nil }
        reachable = false
        guard everUp, !down else { return nil }
        down = true
        return .wentDown
    }

    /// After sleep: the failures before it do not count (the network may have been off).
    public mutating func wake() {
        failures = 0
    }
}

/// The Dock badge: «!» when the lens does not answer, else how many budgets are exceeded.
public func dockBadge(reachable: Bool?, exceeded: Int) -> String? {
    if reachable == false { return "!" }
    return exceeded > 0 ? String(exceeded) : nil
}
