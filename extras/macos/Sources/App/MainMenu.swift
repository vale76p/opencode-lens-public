import AppKit

/// The menu bar: App, Edit (without it ⌘C/⌘V do nothing in a WKWebView), View, Window, Help.
@MainActor
enum MainMenu {
    static func install(text: (Key) -> String, target: AppDelegate) {
        let bar = NSMenu()

        func item(_ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command, to: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = modifiers
            i.target = to
            return i
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            for i in items { menu.addItem(i) }
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            bar.addItem(holder)
            return menu
        }

        _ = submenu("OpenCode Lens", [
            item(text(.about), #selector(AppDelegate.showAbout(_:)), to: target),
            .separator(),
            item(text(.settings), #selector(AppDelegate.openSettingsPage(_:)), ",", to: target),
            item(text(.openAtLogin), #selector(AppDelegate.toggleLoginItem(_:)), to: target),
            .separator(),
            item(text(.hide), #selector(NSApplication.hide(_:)), "h"),
            item(text(.hideOthers), #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item(text(.showAll), #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item(text(.quit), #selector(NSApplication.terminate(_:)), "q"),
        ])

        // nil target: the first responder (the web view or a text field of the error page)
        _ = submenu(text(.editMenu), [
            item(text(.undo), Selector(("undo:")), "z"),
            item(text(.redo), Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item(text(.cut), #selector(NSText.cut(_:)), "x"),
            item(text(.copy), #selector(NSText.copy(_:)), "c"),
            item(text(.paste), #selector(NSText.paste(_:)), "v"),
            item(text(.selectAll), #selector(NSText.selectAll(_:)), "a"),
        ])

        // ⌘= as a hidden alternative of ⌘+ (on many keyboards + needs Shift)
        let zoomInAlt = item(text(.zoomIn), #selector(AppDelegate.zoomIn(_:)), "=", to: target)
        zoomInAlt.isHidden = true
        zoomInAlt.allowsKeyEquivalentWhenHidden = true
        _ = submenu(text(.viewMenu), [
            item(text(.reload), #selector(AppDelegate.reloadPage(_:)), "r", to: target),
            .separator(),
            item(text(.back), #selector(AppDelegate.goBack(_:)), "[", to: target),
            item(text(.forward), #selector(AppDelegate.goForward(_:)), "]", to: target),
            .separator(),
            item(text(.actualSize), #selector(AppDelegate.actualSize(_:)), "0", to: target),
            item(text(.zoomIn), #selector(AppDelegate.zoomIn(_:)), "+", to: target),
            zoomInAlt,
            item(text(.zoomOut), #selector(AppDelegate.zoomOut(_:)), "-", to: target),
            .separator(),
            item(text(.openInBrowser), #selector(AppDelegate.openInBrowser(_:)), to: target),
        ])

        let windowMenu = submenu(text(.windowMenu), [
            item(text(.minimize), #selector(NSWindow.performMiniaturize(_:)), "m"),
            item(text(.zoom), #selector(NSWindow.performZoom(_:))),
            .separator(),
            item(text(.dashboard), #selector(AppDelegate.showDashboard(_:)), "1", to: target),
            item(text(.close), #selector(NSWindow.performClose(_:)), "w"),
        ])

        let helpMenu = submenu(text(.helpMenu), [
            item(text(.guide), #selector(AppDelegate.openHelp(_:)), to: target),
            .separator(),
            item(text(.testNotification), #selector(AppDelegate.sendTestNotification(_:)), to: target),
        ])

        NSApp.mainMenu = bar
        NSApp.windowsMenu = windowMenu
        NSApp.helpMenu = helpMenu
    }
}
