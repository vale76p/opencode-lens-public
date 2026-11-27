import Foundation
import ServiceManagement

/// «Open at Login» with SMAppService.mainApp (macOS 13): the app itself as a login item.
@MainActor
enum LoginItem {
    static var isOn: Bool { [.enabled, .requiresApproval].contains(SMAppService.mainApp.status) }

    /// Registered, but waiting for the person in System Settings › General › Login Items.
    static var needsApproval: Bool { SMAppService.mainApp.status == .requiresApproval }

    static func canRegister(bundleURL: URL, home: URL) -> Bool {
        LoginPlacement.allowed(bundlePath: bundleURL.path, home: home.path)
    }

    static func set(_ on: Bool) throws {
        if on {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }

    static func openSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }

    /// For app.sh uninstall (OpenCodeLens --unregister-login-item): true when it is no longer a
    /// login item, also when it never was (unregister() throws then, and the status is
    /// .notRegistered or .notFound).
    nonisolated static func unregisterForUninstall() -> Bool {
        _ = try? SMAppService.mainApp.unregister()
        let status = SMAppService.mainApp.status
        return status != .enabled && status != .requiresApproval
    }
}
