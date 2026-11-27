import Foundation

/// Where «Open at Login» may be turned on: only with the app installed in ~/Applications or
/// /Applications (as app.sh install does). A login item registered from a build folder would
/// point at a copy that the next build replaces or that is not there at the next login.
public enum LoginPlacement {
    public static func allowed(bundlePath: String, home: String) -> Bool {
        let parent = ((bundlePath as NSString).standardizingPath as NSString).deletingLastPathComponent
        let homeApps = ((home as NSString).standardizingPath as NSString).appendingPathComponent("Applications")
        return parent == "/Applications" || parent == homeApps
    }
}
