import AppKit

/// Asks the lens once a minute whether it answers (GET /healthz) and how the budgets stand
/// (GET /api/budget), with its own ephemeral session: never through the web view, no SSE.
@MainActor
final class Poller {
    static let firstDelay: TimeInterval = 5
    static let interval: TimeInterval = 60
    static let wakeDelay: TimeInterval = 10
    static let maxBody = 1 << 20

    /// ok: /healthz answered 200; report: the budgets, when /api/budget answered too.
    var onResult: ((_ ok: Bool, _ report: BudgetReport?) -> Void)?
    /// The Mac woke up: the failures before sleep do not count.
    var onWake: (() -> Void)?

    private let endpoint: () -> LensEndpoint
    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 5
        c.timeoutIntervalForResource = 15
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()
    private var timer: Timer?
    private var running = false
    private var wakeObserver: NSObjectProtocol?

    init(endpoint: @escaping () -> LensEndpoint) {
        self.endpoint = endpoint
    }

    func start() {
        schedule(after: Self.firstDelay)
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.onWake?()
                self?.schedule(after: Self.wakeDelay)
            }
        }
    }

    /// The next check after `delay`, then every minute (with tolerance: App Nap may delay it).
    private func schedule(after delay: TimeInterval) {
        timer?.invalidate()
        let t = Timer(fire: Date().addingTimeInterval(delay), interval: Self.interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                Task { await self.tick() }
            }
        }
        t.tolerance = 15
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func tick() async {
        guard !running else { return }
        running = true
        defer { running = false }
        let e = endpoint()
        guard e.problem == nil, let health = await get(e, "/healthz"), health.status == 200 else {
            onResult?(false, nil)
            return
        }
        var report: BudgetReport?
        if let budget = await get(e, "/api/budget"), budget.status == 200 {
            report = try? JSONDecoder().decode(BudgetReport.self, from: budget.body)
        }
        onResult?(true, report)
    }

    /// Status and body, nil when there is no answer or the body is over 1 MiB.
    private func get(_ e: LensEndpoint, _ path: String) async -> (status: Int, body: Data)? {
        var request = URLRequest(url: e.origin.appendingPathComponent(String(path.dropFirst())))
        if let token = e.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        guard let (data, response) = try? await session.data(for: request), data.count <= Self.maxBody,
              let http = response as? HTTPURLResponse
        else { return nil }
        return (http.statusCode, data)
    }
}
