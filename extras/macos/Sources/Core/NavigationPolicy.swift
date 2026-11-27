import Foundation

/// What the web view does with a navigation.
public enum NavigationDecision: Equatable, Sendable {
    case allow, download, openExternally, cancel
}

/// Only the lens's own origin stays inside the app; links elsewhere go to the system browser,
/// and only when a person clicked them. Everything else is cancelled.
public struct NavigationPolicy: Sendable {
    public let origin: URL

    public init(origin: URL) { self.origin = origin }

    /// Same scheme (http), host and port as the lens, compared case-insensitively, with no
    /// user or password in the URL.
    public func isLens(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "http", url.user == nil, url.password == nil,
              let host = url.host?.lowercased(), host == origin.host?.lowercased()
        else { return false }
        return (url.port ?? 80) == (origin.port ?? 80)
    }

    /// `mainFrame`: the navigation replaces the page (false for iframes); `userLink`: a click on
    /// a link (WKNavigationType.linkActivated or a target=_blank); `wantsDownload`: an <a download>.
    public func decide(_ url: URL?, mainFrame: Bool, userLink: Bool, wantsDownload: Bool) -> NavigationDecision {
        guard let url, let scheme = url.scheme?.lowercased() else { return .cancel }
        if isLens(url) { return wantsDownload ? .download : .allow }
        if scheme == "about" { return url.absoluteString.lowercased() == "about:blank" ? .allow : .cancel }
        if scheme == "blob" {
            // blob:http://127.0.0.1:4777/<uuid>, created by the dashboard for a file to save
            let inner = URL(string: String(url.absoluteString.dropFirst("blob:".count)))
            return wantsDownload && inner.map(isLens) == true ? .download : .cancel
        }
        if mainFrame, userLink, ["http", "https", "mailto"].contains(scheme) { return .openExternally }
        return .cancel
    }
}
