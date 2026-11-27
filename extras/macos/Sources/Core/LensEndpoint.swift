import Foundation

/// Where the app finds the lens: the LaunchAgent's EnvironmentVariables, with LENS_PORT and
/// LENS_TOKEN of the app's own environment on top (the same overrides as src/mcp/config.js).
public struct LensEndpoint: Equatable, Sendable {
    public enum Problem: Equatable, Sendable {
        /// LENS_HOST binds an address the app does not connect to (::1, a network address, a name).
        case unsupportedHost(String)
    }

    public static let defaultPort = 4777
    /// The LaunchAgent's label (src/service.js), which names its plist.
    public static let serviceLabel = "local.opencode-lens"

    /// "127.0.0.1" or "localhost": the only hosts the app loads.
    public let host: String
    public let port: Int
    public let token: String?
    /// LENS_LANG of the plist, lowercased (nil when unset).
    public let lang: String?
    public let problem: Problem?

    public init(host: String, port: Int, token: String?, lang: String?, problem: Problem?) {
        self.host = host
        self.port = port
        self.token = token
        self.lang = lang
        self.problem = problem
    }

    /// http://host:port, the dashboard's origin.
    public var origin: URL {
        var c = URLComponents()
        c.scheme = "http"
        c.host = host
        c.port = port
        return c.url!
    }

    /// The dashboard for the system browser, at `page` (a hash such as "impostazioni"). The browser
    /// has no cookie of its own: with a token the URL carries it in the query, which the lens trades for
    /// its cookie and drops from the address with a redirect (src/server.js). The web view never
    /// gets it this way: it receives the cookie in code (TokenCookie).
    public func browserURL(page: String?) -> URL {
        var c = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        c.path = "/"
        if let token, !token.isEmpty { c.percentEncodedQuery = "token=\(TokenCookie.value(token))" }
        c.fragment = page
        return c.url!
    }

    /// "host:port", as the window's subtitle and the error pages show it.
    public var address: String { "\(host):\(port)" }

    /// `plistEnv`: EnvironmentVariables of the plist (nil when missing or unreadable);
    /// `env`: the app's environment. The plist's token goes only to the plist's own port, so a
    /// LENS_PORT of the environment pointing at a development lens never receives it.
    public static func resolve(plistEnv: [String: String]?, env: [String: String]) -> LensEndpoint {
        let plist = plistEnv ?? [:]
        let plistPort = port(value("LENS_PORT", in: plist)) ?? defaultPort
        let chosen = port(value("LENS_PORT", in: env)) ?? plistPort
        let token = nonEmpty(env["LENS_TOKEN"]) ?? (chosen == plistPort ? nonEmpty(plist["LENS_TOKEN"]) : nil)
        let rawHost = (value("LENS_HOST", in: plist) ?? "127.0.0.1").lowercased()
        var host = "127.0.0.1"
        var problem: Problem?
        switch rawHost {
        case "127.0.0.1", "0.0.0.0", "::", "[::]": host = "127.0.0.1"
        case "localhost": host = "localhost"
        default: problem = .unsupportedHost(rawHost)
        }
        let lang = value("LENS_LANG", in: plist)?.lowercased()
        return LensEndpoint(host: host, port: chosen, token: token, lang: lang, problem: problem)
    }

    /// The EnvironmentVariables of the plist at `url` (XML or binary), every value as a string:
    /// nil when the file is missing or unreadable, [:] when it has no EnvironmentVariables.
    public static func plistEnvironment(at url: URL) -> [String: String]? {
        guard let data = try? Data(contentsOf: url),
              let root = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else { return nil }
        guard let vars = root["EnvironmentVariables"] as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in vars {
            switch value {
            case let s as String: out[key] = s
            case let n as NSNumber: out[key] = n.stringValue
            default: continue
            }
        }
        return out
    }

    /// LENS_APP_PLIST (development only, e.g. dev/data/dev.plist) or the LaunchAgent's plist.
    public static func plistURL(env: [String: String], home: URL) -> URL {
        if let path = nonEmpty(env["LENS_APP_PLIST"]) {
            return URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        }
        return home.appendingPathComponent("Library/LaunchAgents/\(serviceLabel).plist")
    }

    // MARK: parsing, as src/config.js (values trimmed, empty = unset)

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s
    }

    private static func value(_ key: String, in vars: [String: String]) -> String? {
        nonEmpty(vars[key]?.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// 1–65535 in ASCII digits; 0 (which the lens accepts: any free port) and the rest give nil.
    private static func port(_ raw: String?) -> Int? {
        guard let raw, !raw.isEmpty, raw.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
              raw.utf8.count <= 5, let n = Int(raw), (1...65535).contains(n)
        else { return nil }
        return n
    }
}
