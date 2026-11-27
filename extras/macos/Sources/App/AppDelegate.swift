import AppKit

/// The app: the dashboard's window and the menus. It never opens the lens's database: all it
/// knows comes from the LaunchAgent's plist and the lens's HTTP server.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    static let helpURL = "https://github.com/vale76p/opencode-lens-public/blob/main/docs/"

    private let env = ProcessInfo.processInfo.environment
    private var lang: Lang = .en
    private var dashboard: DashboardWindow?
    private let notifier = Notifier()
    private var poller: Poller?
    private var health = HealthTracker()
    /// Budgets exceeded at the last answer of /api/budget, for the badge and the Dock menu.
    private var exceeded = 0

    /// The plist is read again every time: the lens's port or token may change while the app runs.
    func endpoint() -> LensEndpoint {
        let url = LensEndpoint.plistURL(env: env, home: FileManager.default.homeDirectoryForCurrentUser)
        return LensEndpoint.resolve(plistEnv: LensEndpoint.plistEnvironment(at: url), env: env)
    }

    func t(_ key: Key, _ args: [String: String] = [:]) -> String { Strings.t(key, lang, args) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        lang = resolveLang(endpoint().lang, preferred: Locale.preferredLanguages)
        MainMenu.install(text: { [unowned self] in t($0) }, target: self)
        dashboard = DashboardWindow(endpoint: { [unowned self] in endpoint() }, text: { [unowned self] in t($0, $1) })
        dashboard?.show()
        activate()

        notifier.onOpen = { [unowned self] page in
            dashboard?.show(page: page)
            activate()
        }
        notifier.start()
        let poller = Poller(endpoint: { [unowned self] in endpoint() })
        poller.onResult = { [unowned self] ok, report in checked(ok: ok, report: report) }
        poller.onWake = { [unowned self] in health.wake() }
        poller.start()
        self.poller = poller
    }

    /// The app stays in the Dock with the window closed (for the notifications).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// A click on the Dock icon opens the dashboard again.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { dashboard?.show() }
        return true
    }

    /// The Dock icon's menu: how the lens is doing, Reload, Open in Browser.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        let address = endpoint().address
        let status: String
        switch health.reachable {
        case true?: status = t(.statusUp, ["address": address])
        case false?: status = t(.statusDown, ["address": address])
        case nil: status = t(.statusChecking)
        }
        menu.addItem(NSMenuItem(title: status, action: nil, keyEquivalent: ""))
        if exceeded > 0, health.reachable != false {
            menu.addItem(NSMenuItem(title: t(.statusExceeded, ["count": String(exceeded)]), action: nil, keyEquivalent: ""))
        }
        menu.addItem(.separator())
        for (key, action) in [(Key.reload, #selector(reloadPage(_:))), (.openInBrowser, #selector(openInBrowser(_:)))] {
            let item = NSMenuItem(title: t(key), action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        return menu
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    private func activate() {
        if #available(macOS 14, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    // MARK: checks and notifications

    /// One answer of the Poller: notifications for the lens going away or coming back and for
    /// budgets newly exceeded (once per budget and period, remembered per port), and the badge.
    private func checked(ok: Bool, report: BudgetReport?) {
        let e = endpoint()
        switch health.record(ok: ok) {
        case .wentDown?:
            Task { await notifier.post(id: "lens.down", title: t(.lensDownTitle), body: t(.lensDownBody, ["address": e.address])) }
        case .cameBack?:
            notifier.remove(id: "lens.down")
            Task { await notifier.post(id: "lens.back", title: t(.lensBackTitle), body: t(.lensBackBody, ["address": e.address])) }
        case nil: break
        }
        if let report {
            exceeded = BudgetAlerts.exceeded(report).count
            notifyBudgets(report, port: e.port)
        }
        NSApp.dockTile.badgeLabel = dockBadge(reachable: health.reachable, exceeded: exceeded)
    }

    private func notifyBudgets(_ report: BudgetReport, port: Int) {
        let key = "notified.\(port)"
        let defaults = UserDefaults.standard
        let notified = Set(defaults.stringArray(forKey: key) ?? [])
        let (send, remember) = BudgetAlerts.plan(report, notified: notified)
        guard !send.isEmpty else {
            if remember != notified { defaults.set(remember.sorted(), forKey: key) }
            return
        }
        Task {
            // only what was delivered is remembered: a failed post is tried again at the next check
            var delivered = Set<String>()
            if send.count > BudgetAlerts.maxSingle {
                let s = BudgetAlerts.summary(send, lang)
                if await notifier.post(id: "budget.summary", title: s.title, body: s.body) == nil {
                    delivered = Set(send.map(\.key))
                }
            } else {
                for alert in send {
                    if await notifier.post(id: alert.key, title: t(.budgetTitle), body: BudgetAlerts.text(alert, lang)) == nil {
                        delivered.insert(alert.key)
                    }
                }
            }
            defaults.set(BudgetAlerts.remembered(remember, sent: send, delivered: delivered).sorted(), forKey: key)
        }
    }

    /// Help › Send a Test Notification: says why when it cannot appear.
    @objc func sendTestNotification(_ sender: Any?) {
        Task {
            var problem: String?
            if await notifier.denied() {
                problem = t(.notificationsOff)
            } else if let error = await notifier.post(id: "test", title: t(.testTitle), body: t(.testBody)) {
                problem = t(.testFailed, ["error": error.localizedDescription])
            }
            guard let problem else { return }
            let alert = NSAlert()
            alert.messageText = t(.testTitle)
            alert.informativeText = problem
            alert.addButton(withTitle: t(.ok))
            activate()
            alert.runModal()
        }
    }

    // MARK: menu actions

    @objc func showAbout(_ sender: Any?) {
        activate()
        NSApp.orderFrontStandardAboutPanel(nil)
    }

    @objc func showDashboard(_ sender: Any?) {
        dashboard?.show()
        activate()
    }

    /// ⌘, loads #impostazioni with a navigation, no script.
    @objc func openSettingsPage(_ sender: Any?) {
        dashboard?.show(page: "impostazioni")
        activate()
    }

    @objc func reloadPage(_ sender: Any?) {
        if dashboard?.window == nil { dashboard?.show() } else { dashboard?.reload() }
    }

    @objc func goBack(_ sender: Any?) { dashboard?.goBack() }
    @objc func goForward(_ sender: Any?) { dashboard?.goForward() }
    @objc func zoomIn(_ sender: Any?) { dashboard?.zoom(by: 0.1) }
    @objc func zoomOut(_ sender: Any?) { dashboard?.zoom(by: -0.1) }
    @objc func actualSize(_ sender: Any?) { dashboard?.zoom(by: nil) }

    @objc func openInBrowser(_ sender: Any?) {
        NSWorkspace.shared.open(dashboard?.browserURL ?? endpoint().browserURL(page: nil))
    }

    @objc func openHelp(_ sender: Any?) {
        let page = lang == .it ? "app-macos.md" : "\(lang.rawValue)/app-macos.md"
        if let url = URL(string: Self.helpURL + page) { NSWorkspace.shared.open(url) }
    }

    /// Open at Login: only from ~/Applications or /Applications; «to approve» opens System Settings.
    @objc func toggleLoginItem(_ sender: Any?) {
        if LoginItem.needsApproval {
            LoginItem.openSettings()
            return
        }
        do {
            try LoginItem.set(!LoginItem.isOn)
            if LoginItem.needsApproval { LoginItem.openSettings() }
        } catch {
            let alert = NSAlert()
            alert.messageText = t(.openAtLogin)
            alert.informativeText = t(.loginFailed, ["error": error.localizedDescription])
            alert.addButton(withTitle: t(.ok))
            alert.runModal()
        }
    }

    private var loginItemAllowed: Bool {
        LoginItem.canRegister(bundleURL: Bundle.main.bundleURL, home: FileManager.default.homeDirectoryForCurrentUser)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        let zoom = dashboard?.zoom ?? 1
        switch item.action {
        case #selector(toggleLoginItem(_:)):
            let on = LoginItem.isOn
            let allowed = loginItemAllowed
            item.state = on ? .on : .off
            item.title = LoginItem.needsApproval ? t(.loginNeedsApproval) : t(.openAtLogin)
            item.toolTip = allowed ? nil : t(.loginOnlyInApplications)
            // turning it off stays possible from anywhere
            return allowed || on
        case #selector(goBack(_:)): return dashboard?.canGoBack == true
        case #selector(goForward(_:)): return dashboard?.canGoForward == true
        case #selector(zoomIn(_:)): return dashboard?.window != nil && zoom < DashboardWindow.zoomRange.upperBound
        case #selector(zoomOut(_:)): return dashboard?.window != nil && zoom > DashboardWindow.zoomRange.lowerBound
        case #selector(actualSize(_:)): return dashboard?.window != nil && zoom != 1
        default: return true
        }
    }
}
