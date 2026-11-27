import AppKit
import WebKit

/// The window with the dashboard: a WKWebView on the lens's origin, the native error page when
/// it cannot be loaded, and the browser features a bare web view lacks (dialogs, file panels,
/// downloads, links to the system browser). No JavaScript is ever injected into the page.
@MainActor
final class DashboardWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    static let frameName = "LensDashboard"
    static let zoomKey = "pageZoom"
    static let zoomRange = 0.5...2.0

    private let endpoint: () -> LensEndpoint
    private let text: (Key, [String: String]) -> String

    private(set) var window: NSWindow?
    private var webView: WKWebView?
    private var errorView: ErrorView?
    /// The endpoint and policy of the last load, rebuilt every time (the plist may have changed).
    private var current: LensEndpoint?
    private var policy: NavigationPolicy?
    /// The page (hash) of the last load, which the automatic retries go back to.
    private var lastPage: String?
    private var failure: LoadFailure?
    private var retriedAuth = false
    private var attempt = 0
    private var retryAt: Date?
    private var ticker: Timer?

    init(endpoint: @escaping () -> LensEndpoint, text: @escaping (Key, [String: String]) -> String) {
        self.endpoint = endpoint
        self.text = text
    }

    var canGoBack: Bool { failure == nil && webView?.canGoBack == true }
    var canGoForward: Bool { failure == nil && webView?.canGoForward == true }
    var zoom: Double { Self.storedZoom }

    /// The dashboard at the current endpoint and page, for «Open in Browser», with the token:
    /// since 0.38 the lens always has one, and the browser would get a 401 without it.
    var browserURL: URL { (current ?? endpoint()).browserURL(page: currentPage) }

    /// The window in front, created (with a new web view) when it was closed; `page` is a hash
    /// of the dashboard such as "impostazioni".
    func show(page: String? = nil) {
        if let window {
            window.makeKeyAndOrderFront(nil)
            if let page { go(page: page) }
            return
        }
        makeWindow()
        load(page: page)
    }

    /// ⌘R: reload the page, or retry at once while the error page is shown. A changed endpoint
    /// (port or token saved in the plist) is loaded from scratch.
    func reload() {
        guard let web = webView else { return }
        if failure != nil || web.url == nil || endpoint() != current {
            load(page: currentPage)
        } else {
            web.reload()
        }
    }

    /// Another page of the dashboard: a navigation to its hash, no script.
    func go(page: String) {
        guard let web = webView, let current, failure == nil, let url = web.url, policy?.isLens(url) == true else {
            load(page: page)
            return
        }
        web.load(URLRequest(url: Self.url(current.origin, page: page)))
    }

    func goBack() { webView?.goBack() }
    func goForward() { webView?.goForward() }

    /// `step` added to the page zoom (kept between 0.5 and 2 in UserDefaults), nil = actual size.
    func zoom(by step: Double?) {
        let next = step.map { Self.clampZoom(((zoom + $0) * 100).rounded() / 100) } ?? 1
        UserDefaults.standard.set(next, forKey: Self.zoomKey)
        webView?.pageZoom = next
    }

    // MARK: window and web view

    private static var storedZoom: Double {
        let v = UserDefaults.standard.double(forKey: zoomKey)
        return v == 0 ? 1 : clampZoom(v)
    }

    private static func clampZoom(_ v: Double) -> Double {
        min(max(v, zoomRange.lowerBound), zoomRange.upperBound)
    }

    private func makeWindow() {
        let config = WKWebViewConfiguration()
        // persistent: the dashboard's lens:* preferences live in localStorage; the token's cookie
        // is a session cookie and never reaches the disk
        config.websiteDataStore = .default()
        config.preferences.isElementFullscreenEnabled = true
        // window.open without a click never reaches createWebViewWith (true by default on macOS)
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 840), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.pageZoom = Self.storedZoom
        if #available(macOS 13.3, *) {
            web.isInspectable = ProcessInfo.processInfo.environment["LENS_APP_INSPECTABLE"] == "1"
        }

        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        w.title = "OpenCode Lens"
        w.isReleasedWhenClosed = false
        w.isRestorable = false
        w.tabbingMode = .disallowed
        w.collectionBehavior.insert(.fullScreenPrimary)
        w.contentMinSize = NSSize(width: 760, height: 520)
        w.delegate = self
        w.contentView = web
        if !w.setFrameUsingName(Self.frameName) { w.center() }
        w.setFrameAutosaveName(Self.frameName)
        window = w
        webView = web
        w.makeKeyAndOrderFront(nil)
    }

    /// ⌘W: the web view goes away with its web process and the dashboard's SSE connection.
    func windowWillClose(_ notification: Notification) {
        stopRetrying()
        if let web = webView {
            web.stopLoading()
            web.navigationDelegate = nil
            web.uiDelegate = nil
        }
        if let w = window {
            w.saveFrame(usingName: Self.frameName)
            // a new window takes the name when the dashboard is opened again
            w.setFrameAutosaveName("")
            w.delegate = nil
            w.contentView = nil
        }
        webView = nil
        errorView = nil
        window = nil
        failure = nil
        current = nil
        policy = nil
        attempt = 0
        retriedAuth = false
    }

    // MARK: loading

    private static func url(_ origin: URL, page: String?) -> URL {
        var c = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        c.path = "/"
        c.fragment = page
        return c.url!
    }

    /// The hash of the page shown, when it is the lens's.
    private var currentPage: String? {
        if let url = webView?.url, policy?.isLens(url) == true { return url.fragment }
        return lastPage
    }

    /// Reads the plist again, sets (or removes) the token's cookie and loads the dashboard.
    private func load(page: String?) {
        stopRetrying()
        let e = endpoint()
        current = e
        policy = NavigationPolicy(origin: e.origin)
        lastPage = page
        window?.subtitle = e.address == "127.0.0.1:\(LensEndpoint.defaultPort)" ? "" : e.address
        if case .unsupportedHost(let host)? = e.problem {
            fail(.unsupportedHost(host))
            return
        }
        guard let web = webView else { return }
        var request = URLRequest(url: Self.url(e.origin, page: page))
        request.timeoutInterval = 20
        Task { [weak self] in
            let store = web.configuration.websiteDataStore.httpCookieStore
            if let token = e.token, let cookie = HTTPCookie(properties: TokenCookie.properties(token: token, host: e.host)) {
                await store.setCookie(cookie)
            } else {
                for cookie in await store.allCookies() where cookie.name == TokenCookie.name {
                    await store.deleteCookie(cookie)
                }
            }
            guard let self, self.webView === web, self.current == e else { return }
            web.load(request)
        }
    }

    /// The lens moved (a new LENS_PORT saved from Settings, whose page then goes to the new
    /// address): the URL is the origin of the endpoint read again from the plist.
    private func movedLens(_ url: URL) -> Bool {
        let fresh = endpoint()
        return fresh.problem == nil && fresh.origin != current?.origin && NavigationPolicy(origin: fresh.origin).isLens(url)
    }

    // MARK: error page

    private func fail(_ f: LoadFailure) {
        failure = f
        let view = errorView ?? ErrorView(retryTitle: text(.retry, [:]), target: self, action: #selector(retryNow(_:)))
        errorView = view
        switch f {
        case .unreachable(let address):
            view.show(title: text(.unreachableTitle, [:]), detail: text(.unreachableDetail, ["address": address]))
        case .unauthorized:
            view.show(title: text(.unauthorizedTitle, [:]), detail: text(.unauthorizedDetail, ["address": current?.address ?? ""]))
        case .unsupportedHost(let host):
            view.show(title: text(.unsupportedHostTitle, [:]), detail: text(.unsupportedHostDetail, ["host": host]))
        }
        if window?.contentView !== view { window?.contentView = view }
        // every attempt reads the plist again: the lens may come back on another port or token
        retryAt = Date().addingTimeInterval(LoadFailure.retryDelay(attempt: attempt))
        attempt += 1
        updateCountdown()
        if ticker == nil {
            let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
            t.tolerance = 0.2
            RunLoop.main.add(t, forMode: .common)
            ticker = t
        }
    }

    @objc private func retryNow(_ sender: Any?) {
        errorView?.setCountdown(text(.retrying, [:]))
        load(page: lastPage)
    }

    private func tick() {
        guard let retryAt else { return }
        if Date() >= retryAt {
            retryNow(nil)
        } else {
            updateCountdown()
        }
    }

    private func updateCountdown() {
        guard let retryAt else { return }
        let seconds = max(1, Int(retryAt.timeIntervalSinceNow.rounded(.up)))
        errorView?.setCountdown(text(.retryIn, ["seconds": String(seconds)]))
    }

    private func stopRetrying() {
        ticker?.invalidate()
        ticker = nil
        retryAt = nil
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        let url = action.request.url
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        let decision = policy?.decide(url, mainFrame: mainFrame, userLink: action.navigationType == .linkActivated, wantsDownload: action.shouldPerformDownload) ?? .cancel
        switch decision {
        case .allow: return (.allow, preferences)
        case .download: return (.download, preferences)
        case .openExternally, .cancel:
            if mainFrame, let url, movedLens(url) {
                load(page: url.fragment)
            } else if decision == .openExternally, let url {
                NSWorkspace.shared.open(url)
            }
            return (.cancel, preferences)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if response.isForMainFrame, (response.response as? HTTPURLResponse)?.statusCode == 401 {
            // once: read the plist again and set the cookie anew; a second 401 is the token page
            if retriedAuth {
                fail(.unauthorized)
            } else {
                retriedAuth = true
                load(page: lastPage)
            }
            return .cancel
        }
        return response.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        retriedAuth = false
        attempt = 0
        guard failure != nil else { return }
        failure = nil
        stopRetrying()
        window?.contentView = webView
        errorView = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        failed(webView, error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        failed(webView, error)
    }

    private func failed(_ webView: WKWebView, _ error: any Error) {
        let ns = error as NSError
        guard webView === self.webView, let current,
              let f = LoadFailure.fromError(domain: ns.domain, code: ns.code, address: current.address)
        else { return }
        fail(f)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        load(page: currentPage)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: WKDownloadDelegate

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        guard let window else { return nil }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return nil }
        // the panel has already asked before replacing it; WKDownload refuses an existing file
        try? FileManager.default.removeItem(at: url)
        return url
    }

    // MARK: WKUIDelegate

    /// target=_blank and window.open: never a second web view. The same policy decides: only a
    /// click on a link (linkActivated) goes to the browser, a script's window.open never does.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url, let policy else { return nil }
        switch policy.decide(url, mainFrame: true, userLink: action.navigationType == .linkActivated, wantsDownload: false) {
        case .allow where policy.isLens(url): webView.load(action.request)
        case .openExternally: NSWorkspace.shared.open(url)
        default: break
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        guard let window else { return }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: text(.ok, [:]))
        _ = await alert.beginSheetModal(for: window)
    }

    /// confirm() before the dashboard's destructive actions: without it WebKit answers false.
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        guard let window else { return false }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: text(.ok, [:]))
        alert.addButton(withTitle: text(.cancel, [:]))
        return await alert.beginSheetModal(for: window) == .alertFirstButtonReturn
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
        nil
    }

    /// <input type=file>, also with webkitdirectory (Skill › Import).
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo) async -> [URL]? {
        guard let window else { return nil }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        guard await panel.beginSheetModal(for: window) == .OK else { return nil }
        return panel.urls
    }
}
