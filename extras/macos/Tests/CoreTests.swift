import Foundation

// Tests of the pure part of the app (Sources/Core), without XCTest: bash app.sh test compiles
// them with Core into one executable that prints OK or the failures and exits 0 or 1.

@MainActor var failures = 0
@MainActor var checks = 0

@MainActor func check(_ ok: Bool, _ what: @autoclosure () -> String, line: UInt = #line) {
    checks += 1
    if !ok {
        failures += 1
        print("FAIL CoreTests.swift:\(line) \(what())")
    }
}

func url(_ s: String) -> URL? { URL(string: s) }

@MainActor func endpointTests() {
    let none = LensEndpoint.resolve(plistEnv: nil, env: [:])
    check(none.host == "127.0.0.1" && none.port == 4777 && none.token == nil && none.problem == nil, "no plist: 127.0.0.1:4777, no token")
    check(none.origin.absoluteString == "http://127.0.0.1:4777" && none.address == "127.0.0.1:4777", "origin and address: \(none.origin)")

    let plist = ["LENS_PORT": "4800", "LENS_TOKEN": "secret-token-123456"]
    let p = LensEndpoint.resolve(plistEnv: plist, env: [:])
    check(p.port == 4800 && p.token == "secret-token-123456", "port and token from the plist")
    let other = LensEndpoint.resolve(plistEnv: plist, env: ["LENS_PORT": "4799"])
    check(other.port == 4799 && other.token == nil, "LENS_PORT of the environment on another port: no plist token")
    let same = LensEndpoint.resolve(plistEnv: plist, env: ["LENS_PORT": "4800"])
    check(same.port == 4800 && same.token == "secret-token-123456", "LENS_PORT of the environment on the plist's port keeps its token")
    let envToken = LensEndpoint.resolve(plistEnv: plist, env: ["LENS_PORT": "4799", "LENS_TOKEN": "from-env"])
    check(envToken.port == 4799 && envToken.token == "from-env", "LENS_TOKEN of the environment")
    let emptyEnv = LensEndpoint.resolve(plistEnv: plist, env: ["LENS_PORT": "", "LENS_TOKEN": ""])
    check(emptyEnv.port == 4800 && emptyEnv.token == "secret-token-123456", "empty variables of the environment are unset")

    for (raw, want) in [("0", 4777), ("abc", 4777), ("70000", 4777), (" 4800 ", 4800), ("-1", 4777), ("4800x", 4777), ("٤٨٠٠", 4777), ("65535", 65535)] {
        let e = LensEndpoint.resolve(plistEnv: ["LENS_PORT": raw], env: [:])
        check(e.port == want, "LENS_PORT \"\(raw)\" → \(want), got \(e.port)")
    }
    let badEnvPort = LensEndpoint.resolve(plistEnv: ["LENS_PORT": "4800"], env: ["LENS_PORT": "0"])
    check(badEnvPort.port == 4800, "an invalid LENS_PORT of the environment falls back to the plist's")

    for (raw, host) in [("0.0.0.0", "127.0.0.1"), ("::", "127.0.0.1"), ("[::]", "127.0.0.1"), ("127.0.0.1", "127.0.0.1"), ("localhost", "localhost"), ("LocalHost", "localhost")] {
        let e = LensEndpoint.resolve(plistEnv: ["LENS_HOST": raw], env: [:])
        check(e.host == host && e.problem == nil, "LENS_HOST \(raw) → \(host)")
    }
    for raw in ["::1", "192.168.1.2", "Mac.local"] {
        let e = LensEndpoint.resolve(plistEnv: ["LENS_HOST": raw], env: [:])
        check(e.problem == .unsupportedHost(raw.lowercased()) && e.host == "127.0.0.1", "LENS_HOST \(raw) is not supported")
    }
    let local = LensEndpoint.resolve(plistEnv: ["LENS_HOST": "localhost", "LENS_PORT": "4801"], env: [:])
    check(local.origin.absoluteString == "http://localhost:4801", "localhost origin: \(local.origin)")

    check(LensEndpoint.resolve(plistEnv: ["LENS_LANG": "FR"], env: [:]).lang == "fr", "LENS_LANG lowercased")
    check(LensEndpoint.resolve(plistEnv: [:], env: ["LENS_LANG": "fr"]).lang == nil, "LENS_LANG only from the plist")

    // «Open in Browser»: the token in the query (encoded as encodeURIComponent), the page as the hash
    let withToken = LensEndpoint.resolve(plistEnv: ["LENS_PORT": "4800", "LENS_TOKEN": "a+b/c=d é"], env: [:])
    let page = withToken.browserURL(page: "impostazioni").absoluteString
    check(page == "http://127.0.0.1:4800/?token=a%2Bb%2Fc%3Dd%20%C3%A9#impostazioni", "browser URL with token and page: \(page)")
    let bare = withToken.browserURL(page: nil).absoluteString
    check(bare == "http://127.0.0.1:4800/?token=a%2Bb%2Fc%3Dd%20%C3%A9", "browser URL with token, no page: \(bare)")
    let noToken = LensEndpoint.resolve(plistEnv: ["LENS_PORT": "4800"], env: [:]).browserURL(page: "sessioni").absoluteString
    check(noToken == "http://127.0.0.1:4800/#sessioni", "browser URL without token: \(noToken)")
    let devLens = LensEndpoint.resolve(plistEnv: ["LENS_TOKEN": "prod-token"], env: ["LENS_PORT": "4790"]).browserURL(page: nil).absoluteString
    check(devLens == "http://127.0.0.1:4790/", "another port never gets the plist token: \(devLens)")
}

@MainActor func plistTests() {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("lens-app-tests-\(ProcessInfo.processInfo.processIdentifier)")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let xml = dir.appendingPathComponent("xml.plist")
    let body = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict><key>Label</key><string>local.opencode-lens</string>
    <key>EnvironmentVariables</key><dict><key>LENS_PORT</key><integer>4800</integer>
    <key>LENS_TOKEN</key><string>abc</string><key>LENS_BOB</key><true/></dict></dict></plist>
    """
    try? Data(body.utf8).write(to: xml)
    let vars = LensEndpoint.plistEnvironment(at: xml)
    check(vars?["LENS_PORT"] == "4800" && vars?["LENS_TOKEN"] == "abc", "XML plist with <integer>: \(String(describing: vars))")
    check(LensEndpoint.resolve(plistEnv: vars, env: [:]).port == 4800, "port of an <integer>")

    let binary = dir.appendingPathComponent("binary.plist")
    let data = try? PropertyListSerialization.data(fromPropertyList: ["EnvironmentVariables": ["LENS_PORT": "4802"]], format: .binary, options: 0)
    try? data?.write(to: binary)
    check(LensEndpoint.plistEnvironment(at: binary)?["LENS_PORT"] == "4802", "binary plist")

    check(LensEndpoint.plistEnvironment(at: dir.appendingPathComponent("missing.plist")) == nil, "missing file → nil")
    let garbage = dir.appendingPathComponent("garbage.plist")
    try? Data("not a plist".utf8).write(to: garbage)
    check(LensEndpoint.plistEnvironment(at: garbage) == nil, "unreadable file → nil")
    let bare = dir.appendingPathComponent("bare.plist")
    let bareData = try? PropertyListSerialization.data(fromPropertyList: ["Label": "x"], format: .xml, options: 0)
    try? bareData?.write(to: bare)
    check(LensEndpoint.plistEnvironment(at: bare) == [:], "no EnvironmentVariables → [:]")

    let home = URL(fileURLWithPath: "/Users/someone")
    check(LensEndpoint.plistURL(env: [:], home: home).path == "/Users/someone/Library/LaunchAgents/local.opencode-lens.plist", "default plist")
    check(LensEndpoint.plistURL(env: ["LENS_APP_PLIST": "/tmp/dev.plist"], home: home).path == "/tmp/dev.plist", "LENS_APP_PLIST")
    check(LensEndpoint.plistURL(env: ["LENS_APP_PLIST": ""], home: home).path.hasSuffix("local.opencode-lens.plist"), "empty LENS_APP_PLIST")
}

@MainActor func navigationTests() {
    let policy = NavigationPolicy(origin: URL(string: "http://127.0.0.1:4777")!)
    func decide(_ s: String, main: Bool = true, link: Bool = false, download: Bool = false) -> NavigationDecision {
        policy.decide(url(s), mainFrame: main, userLink: link, wantsDownload: download)
    }
    check(decide("http://127.0.0.1:4777/") == .allow, "lens")
    check(decide("http://127.0.0.1:4777/?x=1#adesso") == .allow, "lens with query and hash")
    check(decide("HTTP://127.0.0.1:4777/#impostazioni") == .allow, "scheme in capitals")
    check(decide("http://127.0.0.1:4777/api/live", main: false) == .allow, "lens in a subframe")
    check(!policy.isLens(url("http://user@127.0.0.1:4777/")!), "credentials in the URL: not the lens")
    check(!policy.isLens(url("http://user:pw@127.0.0.1:4777/")!), "user and password: not the lens")
    check(!policy.isLens(url("https://127.0.0.1:4777/")!), "https is not the lens")
    check(decide("http://127.0.0.1/") == .cancel && decide("http://127.0.0.1/", link: true) == .openExternally, "port 80: outside, only from a link")
    check(decide("http://localhost:4777/") == .cancel && decide("http://localhost:4777/", link: true) == .openExternally, "localhost with a 127.0.0.1 origin: outside")
    check(decide("http://127.0.0.1.evil.com:4777/") == .cancel, "lookalike host without a click")
    check(decide("http://127.0.0.1.evil.com:4777/", link: true) == .openExternally, "lookalike host from a link: browser")
    check(decide("https://github.com/vale76p/opencode-lens-public", link: true) == .openExternally, "https from a link")
    check(decide("https://github.com/vale76p/opencode-lens-public") == .cancel, "https without a click")
    check(decide("mailto:someone@example.com", link: true) == .openExternally, "mailto from a link")
    check(decide("https://example.com/frame", main: false, link: true) == .cancel, "external subframe")
    check(decide("javascript:alert(1)", link: true) == .cancel, "javascript:")
    check(decide("data:text/html,<b>x</b>", link: true) == .cancel, "data: as a page")
    check(decide("file:///etc/passwd", link: true) == .cancel, "file:")
    check(decide("ftp://example.com/x", link: true) == .cancel, "ftp:")
    check(decide("about:blank") == .allow, "about:blank")
    check(decide("about:srcdoc") == .cancel, "other about: pages")
    check(decide("blob:http://127.0.0.1:4777/0b2f-11", download: true) == .download, "lens blob as a download")
    check(decide("blob:http://127.0.0.1:4777/0b2f-11") == .cancel, "lens blob as a page")
    check(decide("blob:https://evil.example/0b2f-11", download: true) == .cancel, "foreign blob")
    check(decide("http://127.0.0.1:4777/api/export", download: true) == .download, "lens URL with download")
    check(policy.decide(nil, mainFrame: true, userLink: true, wantsDownload: false) == .cancel, "no URL")

    let local = NavigationPolicy(origin: URL(string: "http://localhost:4801")!)
    check(local.isLens(url("http://LOCALHOST:4801/#adesso")!), "host compared case-insensitively")
    check(!local.isLens(url("http://127.0.0.1:4801/")!), "127.0.0.1 is not a localhost origin")
}

@MainActor func cookieTests() {
    check(TokenCookie.value("a+b/c=d é") == "a%2Bb%2Fc%3Dd%20%C3%A9", "encodeURIComponent: \(TokenCookie.value("a+b/c=d é"))")
    check(TokenCookie.value("AZaz09-_.!~*'()") == "AZaz09-_.!~*'()", "unreserved characters stay")
    check(TokenCookie.value("%;,\"") == "%25%3B%2C%22", "cookie separators are encoded")
    for host in ["127.0.0.1", "localhost"] {
        let c = HTTPCookie(properties: TokenCookie.properties(token: "a+b/c=d é", host: host))
        check(c != nil, "HTTPCookie for \(host)")
        guard let c else { continue }
        check(c.name == "lens_token" && c.value == "a%2Bb%2Fc%3Dd%20%C3%A9" && c.path == "/", "name, value, path for \(host)")
        check(c.isHTTPOnly, "HttpOnly for \(host)")
        check(c.isSessionOnly && c.expiresDate == nil, "session cookie for \(host)")
        check(c.sameSitePolicy == .sameSiteStrict, "SameSite strict for \(host)")
        check(!c.isSecure, "not Secure: the lens is plain http on loopback (\(host))")
    }
}

@MainActor func loadFailureTests() {
    check(LoadFailure.fromError(domain: NSURLErrorDomain, code: -1004, address: "127.0.0.1:4777") == .unreachable("127.0.0.1:4777"), "-1004 cannot connect")
    check(LoadFailure.fromError(domain: NSURLErrorDomain, code: -1001, address: "a") == .unreachable("a"), "-1001 timeout")
    check(LoadFailure.fromError(domain: NSURLErrorDomain, code: -1005, address: "a") == .unreachable("a"), "-1005 connection lost")
    check(LoadFailure.fromError(domain: NSURLErrorDomain, code: -999, address: "a") == nil, "-999 cancelled")
    check(LoadFailure.fromError(domain: "WebKitErrorDomain", code: 102, address: "a") == nil, "WebKit 102 policy change")
    let delays = (0..<7).map { LoadFailure.retryDelay(attempt: $0) }
    check(delays == [2, 4, 8, 16, 30, 30, 30], "retry delays: \(delays)")
    check(LoadFailure.retryDelay(attempt: -1) == 2, "negative attempt")
}

@MainActor func stringsTests() {
    for key in Key.allCases {
        let texts = Lang.allCases.map { Strings.table[key]?[$0] ?? "" }
        check(texts.allSatisfy { !$0.trimmingCharacters(in: .whitespaces).isEmpty }, "\(key) in it/en/fr")
        let marks = Set(texts.map(Strings.placeholders))
        check(marks.count == 1, "\(key): same placeholders in it/en/fr (\(marks))")
    }
    check(Strings.t(.retryIn, .it, ["seconds": "8"]) == "Nuovo tentativo tra 8 s", "placeholder replaced")
    check(Strings.t(.unsupportedHostDetail, .en, ["host": "::1"]).hasPrefix("LENS_HOST=::1:"), "host placeholder")
    check(Strings.placeholders("{a} and {b}{c}") == ["a", "b", "c"], "placeholders()")

    check(resolveLang("fr", preferred: ["it-IT"]) == .fr, "forced language")
    check(resolveLang("auto", preferred: ["it-IT", "en"]) == .it, "auto: first supported")
    check(resolveLang(nil, preferred: ["pt-BR", "fr"]) == .fr, "pt-BR then fr → fr")
    check(resolveLang(nil, preferred: ["de-DE", "ja"]) == .en, "none supported → en")
    check(resolveLang(nil, preferred: []) == .en, "no languages → en")
    check(resolveLang(nil, preferred: ["EN-gb"]) == .en, "EN-gb → en")
    check(resolveLang("xx", preferred: ["it"]) == .it, "unknown forced value counts as auto")
}

/// A period as src/queries.js period() writes it, extra fields included.
func periodJSON(from: Int, tokens: String = "under", cost: String = "none", steps: String = "none", extra: String = "") -> String {
    func m(_ pace: String) -> String {
        let limited = pace != "none"
        let ratio = pace == "exceeded" ? "1.2" : pace == "none" ? "null" : "0.5"
        return #"{"used":120,"limit":\#(limited ? "100" : "null"),"ratio":\#(ratio),"projected":null,"projectedRatio":null,"pace":"\#(pace)"}"#
    }
    return #"{"from":\#(from),"to":\#(from + 86_400_000),"elapsed":0.5,"tokens":\#(m(tokens)),"cost":\#(m(cost)),"steps":\#(m(steps))\#(extra)}"#
}

func budgetJSON(day: Int = 1_792_800_000_000, week: Int = 1_792_540_800_000, month: Int = 1_790_812_800_000, dayPaces: (String, String, String) = ("exceeded", "none", "under"), weekTokens: String = "under", monthTokens: String = "exceeded", models: String) -> Data {
    let d = periodJSON(from: day, tokens: dayPaces.0, cost: dayPaces.1, steps: dayPaces.2, extra: #","models":\#(models)"#)
    let w = periodJSON(from: week, tokens: weekTokens, extra: #","days":[{"date":"2026-10-19","tokens":1,"cost":0,"steps":1}]"#)
    let mo = periodJSON(from: month, tokens: monthTokens)
    return Data(#"{"now":1792830000000,"periods":{"day":\#(d),"week":\#(w),"month":\#(mo)}}"#.utf8)
}

let twoModels = #"[{"model":"openai/gpt-5.5","used":104,"limit":100,"ratio":1.04,"projected":200,"projectedRatio":2,"pace":"exceeded","seen":true},{"model":"a/b","used":1,"limit":100,"ratio":0.01,"projected":null,"projectedRatio":null,"pace":"under","seen":false}]"#

@MainActor func budgetTests() {
    guard let r = try? JSONDecoder().decode(BudgetReport.self, from: budgetJSON(models: twoModels)) else {
        check(false, "decode the shape of queries.budget()")
        return
    }
    check(r.periods.day.models?.count == 2 && r.periods.day.tokens.limit == 100 && r.periods.day.cost.limit == nil, "decoded fields")
    let now = BudgetAlerts.exceeded(r)
    check(now.map(\.key) == ["day.tokens.1792800000000", "month.tokens.1790812800000", "model.openai/gpt-5.5.1792800000000"], "exceeded: \(now.map(\.key))")
    check(now.first?.subject == .total(period: "day", metric: "tokens") && now.last?.subject == .model("openai/gpt-5.5"), "subjects")

    let first = BudgetAlerts.plan(r, notified: ["day.tokens.1792713600000", "model.x/y.1700000000000", "week.cost.1792540800000", "garbage"])
    check(first.send.count == 3, "three new alerts")
    check(first.remember == ["week.cost.1792540800000", "day.tokens.1792800000000", "month.tokens.1790812800000", "model.openai/gpt-5.5.1792800000000"], "past periods drop out: \(first.remember.sorted())")
    let second = BudgetAlerts.plan(r, notified: first.remember)
    check(second.send.isEmpty && second.remember == first.remember, "once per key and period")

    // a notification not delivered is not remembered: the next check sends it again
    let partly = BudgetAlerts.remembered(first.remember, sent: first.send, delivered: ["day.tokens.1792800000000"])
    check(partly == ["week.cost.1792540800000", "day.tokens.1792800000000"], "only delivered keys: \(partly.sorted())")
    let retry = BudgetAlerts.plan(r, notified: partly)
    check(retry.send.map(\.key) == ["month.tokens.1790812800000", "model.openai/gpt-5.5.1792800000000"], "undelivered ones again: \(retry.send.map(\.key))")
    check(BudgetAlerts.remembered(first.remember, sent: first.send, delivered: []) == ["week.cost.1792540800000"], "nothing delivered: only the old valid keys")
    check(BudgetAlerts.remembered(first.remember, sent: first.send, delivered: Set(first.send.map(\.key))) == first.remember, "all delivered")

    // a new day: the day's keys come back, the month's stays notified
    if let next = try? JSONDecoder().decode(BudgetReport.self, from: budgetJSON(day: 1_792_886_400_000, models: twoModels)) {
        let third = BudgetAlerts.plan(next, notified: first.remember)
        check(third.send.map(\.key) == ["day.tokens.1792886400000", "model.openai/gpt-5.5.1792886400000"], "new day: \(third.send.map(\.key))")
        check(!third.remember.contains("day.tokens.1792800000000"), "yesterday's key forgotten")
    } else {
        check(false, "decode next day")
    }

    let none = try? JSONDecoder().decode(BudgetReport.self, from: Data(#"{"now":1,"periods":{"day":\#(periodJSON(from: 1)),"week":\#(periodJSON(from: 1)),"month":\#(periodJSON(from: 1))}}"#.utf8))
    check(none.map { BudgetAlerts.exceeded($0).isEmpty } == true, "no models field, nothing exceeded")

    let day = BudgetAlert(key: "k", subject: .total(period: "day", metric: "tokens"), ratio: 1.2)
    check(BudgetAlerts.text(day, .it) == "Oggi, token: 120% del budget", BudgetAlerts.text(day, .it))
    check(BudgetAlerts.text(day, .en) == "Today, tokens: 120% of the budget", BudgetAlerts.text(day, .en))
    check(BudgetAlerts.text(day, .fr) == "Aujourd'hui, tokens : 120 % du budget", BudgetAlerts.text(day, .fr))
    let week = BudgetAlert(key: "k", subject: .total(period: "week", metric: "cost"), ratio: 1)
    check(BudgetAlerts.text(week, .it) == "Questa settimana, costo: 100% del budget", BudgetAlerts.text(week, .it))
    let month = BudgetAlert(key: "k", subject: .total(period: "month", metric: "steps"), ratio: 3.456)
    check(BudgetAlerts.text(month, .en) == "This month, steps: 345% of the budget", BudgetAlerts.text(month, .en))
    let model = BudgetAlert(key: "k", subject: .model("openai/gpt-5.5"), ratio: 1.04)
    check(BudgetAlerts.text(model, .it) == "openai/gpt-5.5: 104% del budget di oggi", BudgetAlerts.text(model, .it))
    check(BudgetAlerts.text(model, .fr) == "openai/gpt-5.5 : 104 % du budget du jour", BudgetAlerts.text(model, .fr))

    let many = Array(repeating: day, count: 5)
    let s = BudgetAlerts.summary(many, .it)
    check(s.title == "Budget superati: 5", s.title)
    check(s.body.split(separator: "\n").count == 4 && s.body.hasSuffix("e altri 2"), s.body)
}

@MainActor func healthTests() {
    var never = HealthTracker()
    check(never.reachable == nil, "unknown at start")
    check([false, false, false].map { never.record(ok: $0) } == [nil, nil, nil], "never reached: no event")
    check(never.reachable == false, "but the badge knows")

    var h = HealthTracker()
    check(h.record(ok: true) == nil && h.reachable == true, "ok")
    check(h.record(ok: false) == nil && h.reachable == true, "one failure is not down")
    check(h.record(ok: false) == .wentDown && h.reachable == false, "two failures: wentDown")
    check(h.record(ok: false) == nil, "only once")
    check(h.record(ok: true) == .cameBack && h.reachable == true, "cameBack")
    check(h.record(ok: true) == nil, "nothing more")

    var w = HealthTracker()
    _ = w.record(ok: true)
    _ = w.record(ok: false)
    w.wake()
    check(w.record(ok: false) == nil, "wake resets the failures")
    check(w.record(ok: false) == .wentDown, "then two failures again")

    check(dockBadge(reachable: false, exceeded: 3) == "!", "badge !")
    check(dockBadge(reachable: true, exceeded: 3) == "3", "badge count")
    check(dockBadge(reachable: nil, exceeded: 2) == "2", "badge count while unknown")
    check(dockBadge(reachable: true, exceeded: 0) == nil && dockBadge(reachable: nil, exceeded: 0) == nil, "no badge")
}

@MainActor func loginPlacementTests() {
    let home = "/Users/someone"
    check(LoginPlacement.allowed(bundlePath: "/Users/someone/Applications/OpenCode Lens.app", home: home), "~/Applications")
    check(LoginPlacement.allowed(bundlePath: "/Applications/OpenCode Lens.app", home: home), "/Applications")
    check(LoginPlacement.allowed(bundlePath: "/Users/someone/Applications/OpenCode Lens.app/", home: home + "/"), "trailing slashes")
    check(!LoginPlacement.allowed(bundlePath: "/Users/someone/Library/Caches/opencode-lens-app/OpenCode Lens.app", home: home), "build cache")
    check(!LoginPlacement.allowed(bundlePath: "/private/tmp/x/OpenCode Lens.app", home: home), "scratch folder")
    check(!LoginPlacement.allowed(bundlePath: "/Users/someone/Applications/opencode-lens/OpenCode Lens.app", home: home), "inside the lens's folder (replaced by every update)")
    check(!LoginPlacement.allowed(bundlePath: "/Users/other/Applications/OpenCode Lens.app", home: home), "another user's Applications")
    check(!LoginPlacement.allowed(bundlePath: "/Users/someone/Applications/../Desktop/OpenCode Lens.app", home: home), ".. is resolved")
}

@main
enum CoreTests {
    @MainActor static func main() {
        endpointTests()
        plistTests()
        navigationTests()
        cookieTests()
        loadFailureTests()
        stringsTests()
        budgetTests()
        healthTests()
        loginPlacementTests()
        if failures == 0 {
            print("OK \(checks) checks")
            exit(0)
        }
        print("\(failures) of \(checks) checks failed")
        exit(1)
    }
}
