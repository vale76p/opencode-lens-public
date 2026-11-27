import Foundation

/// The session cookie that carries LENS_TOKEN to the web view, as the lens itself writes it
/// when the token comes in the query string (src/server.js): the app sets it in code, and the web
/// view never loads the token in a URL (only «Open in Browser» does, see LensEndpoint.browserURL).
public enum TokenCookie {
    public static let name = "lens_token"

    /// The bytes encodeURIComponent leaves as they are: an explicit ASCII set, because
    /// CharacterSet.alphanumerics also holds letters such as «é».
    private static let unreserved = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()".utf8)
    private static let hex = Array("0123456789ABCDEF".utf8)

    /// The token encoded exactly as encodeURIComponent does (the server decodes it the same way).
    public static func value(_ token: String) -> String {
        var out: [UInt8] = []
        out.reserveCapacity(token.utf8.count)
        for byte in token.utf8 {
            if unreserved.contains(byte) {
                out.append(byte)
            } else {
                out.append(UInt8(ascii: "%"))
                out.append(hex[Int(byte >> 4)])
                out.append(hex[Int(byte & 0x0f)])
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// HttpOnly, SameSite=Strict, path /, no expiry (a session cookie: it never goes to disk).
    public static func properties(token: String, host: String) -> [HTTPCookiePropertyKey: Any] {
        [
            .name: name,
            .value: value(token),
            .domain: host,
            .path: "/",
            HTTPCookiePropertyKey("HttpOnly"): "TRUE",
            .sameSitePolicy: HTTPCookieStringPolicy.sameSiteStrict.rawValue,
        ]
    }
}
