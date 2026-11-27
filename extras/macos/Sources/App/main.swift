import AppKit

// The dashboard of opencode-lens in a native window (docs/app-macos.md).

// app.sh uninstall: remove the login item, then exit without showing anything
if CommandLine.arguments.contains("--unregister-login-item") {
    exit(LoginItem.unregisterForUninstall() ? 0 : 1)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// app.sh (install, update, uninstall) stops the app with SIGTERM: a regular quit instead of the
// default exit on the spot, so the copy it opens next starts from a cleanly closed app
signal(SIGTERM, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminate.setEventHandler {
    MainActor.assumeIsolated { NSApp.terminate(nil) }
}
terminate.resume()

app.run()
