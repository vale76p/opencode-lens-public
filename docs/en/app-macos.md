# macOS app

🌐 [Italiano](../app-macos.md) · English · [Français](../fr/app-macos.md)

**OpenCode Lens** (`~/Applications/OpenCode Lens.app`) is an optional macOS app that shows the lens's dashboard in a native window, with an icon in the Dock, notifications and launch at login. It is a thin wrapper: a `WKWebView` loading the same dashboard as `http://127.0.0.1:4777`, plus what a web page lacks (menus, Dock, notifications). Its sources are in `extras/macos/` and are built on the Mac that uses it.

## What it is

- **Optional.** The lens works the same without it: same service, same dashboard in the browser, same data. `install.sh` copies the app's sources into `~/Applications/opencode-lens/extras/macos/`. The app is installed from **Settings › Update** or with the command below; from then on `install.sh` keeps it at the lens's version.
- **An HTTP client of the lens.** It does not open the database and does not read the lens's files: it learns where the lens is from the LaunchAgent's plist and talks to it over HTTP on loopback. No new API: it uses the dashboard, `/healthz` and `/api/budget`.
- **Next to [OpenCode Lens Monitor](https://github.com/vale76p/opencode-lens-monitor-public), not instead of it.** Monitor keeps the menu bar: the budget percentage, the panel, the widgets, Start and Stop of the LaunchAgent and its own launch at login. The app keeps the dashboard's window, the Dock icon, the notifications and the window's launch at login. It has no menu bar icon and neither starts nor stops the lens. The two apps have different names and bundle ids (`local.opencode-lens-monitor`, `local.opencode-lens.app`) and live side by side; neither needs the other.

## Requirements

- macOS 13 or later.
- The Command Line Tools with Swift 6 or later: `xcode-select --install`. Xcode is not needed.
- The lens installed (the script is in its folder, `~/Applications/opencode-lens/extras/macos/app.sh`) or a clone of the repository.
- A normal user: the script refuses to run as root and never asks for `sudo`.

The script checks all of this before building and stops with a message if something is missing (`Serve swiftc: xcode-select --install (Xcode non serve).`, `Serve macOS 13 o successivo`, `Serve Swift 6 o successivo`; the script's messages are in Italian).

## Installation

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh install
```

From a clone: `bash extras/macos/app.sh install`.

**From the dashboard.** **Settings › Update › macOS app** shows the app's version next to the lens's and, with **Install the app** (or **Update the app**), runs the same command in a process that outlives a restart of the lens; the build log stays on the page. The button is there only when the lens runs from the LaunchAgent in its folder `~/Applications/opencode-lens`, as for the update from a zip: a development lens shows the state but cannot replace the app. Without the Command Line Tools there is no button and the page says what to install (`xcode-select --install`). If you are using it from the app, the app closes and opens again.

The command builds the app for the Mac's architecture (`arm64` or `x86_64`) in `~/Library/Caches/opencode-lens-app`, signs it, quits a copy that may be open, copies it to `~/Applications/OpenCode Lens.app`, checks the signature and opens it. At the first start macOS asks for the notification permission. The app's version is the one of the lens you build it from (`version` in `package.json`).

**Why it is built on every Mac.** The release zip holds only the sources. A downloaded app would carry the quarantine and an ad-hoc, non-notarized signature, and Gatekeeper would block it; an app built on the Mac itself has no quarantine. For the same reason do not copy `OpenCode Lens.app` to another Mac: run `app.sh install` there.

The app never lives inside `~/Applications/opencode-lens`, which every lens update replaces.

## The window

The window shows the dashboard: 1280×840 at the first start, at least 760×520, and it remembers its position and size. When the lens is not on `127.0.0.1:4777`, the window's subtitle shows `host:port`.

- **⌘W** closes the window and frees the page (web process and `/api/live` stream); the app stays in the Dock for the notifications. A click on the Dock icon or **⌘1** opens the dashboard again.
- The page zoom (⌘+, ⌘-, ⌘0) goes from 50% to 200% and is kept between launches.
- The browser features the dashboard uses are here too: the confirmations before destructive actions (`confirm()`, as a sheet of the window), choosing files and folders (Skill › Import…), saving files (panel on Downloads), Monitor's full screen, two-finger swipes for back and forward.
- When the lens does not answer, a native error page replaces the dashboard: «La lens non risponde» (The lens is not responding), «Token mancante o errato» (Missing or wrong token) or «Indirizzo non supportato» (Unsupported address), in the app's language. It tries again by itself after 2, 4, 8 and 16 seconds, then every 30, with a countdown; **Try Again** (or ⏎) and ⌘R try at once. Every attempt reads the plist again, so the app finds the lens even if its port or token changed meanwhile.

The dashboard in the app and the one in the browser are two independent clients, like two tabs: the browser preferences (theme, `lens:*` keys) are separate; layout and presets live in the lens and the last save wins.

### Menus and shortcuts

| Menu | Items |
|---|---|
| OpenCode Lens | About OpenCode Lens · Settings… ⌘, (opens the dashboard's Settings page) · Open at Login · Hide OpenCode Lens ⌘H · Hide Others ⌥⌘H · Show All · Quit OpenCode Lens ⌘Q |
| Edit | Undo ⌘Z · Redo ⇧⌘Z · Cut ⌘X · Copy ⌘C · Paste ⌘V · Select All ⌘A |
| View | Reload ⌘R · Back ⌘[ · Forward ⌘] · Actual Size ⌘0 · Zoom In ⌘+ (also ⌘=) · Zoom Out ⌘- · Open in Browser |
| Window | Minimize ⌘M · Zoom · Dashboard ⌘1 · Close ⌘W |
| Help | OpenCode Lens Help (this page on GitHub, in the app's language) · Send a Test Notification |

**Open in Browser** opens the same page in the system browser. With a token, the address carries `?token=`: the lens trades it for a cookie and drops it from the address with a redirect, but the first address may stay in the browser history.

The language of menus and notifications is the plist's `LENS_LANG` when it is `it`, `en` or `fr`; otherwise the first of these among macOS's preferred languages; otherwise English.

## Dock

- **Badge**: `!` when the lens has not answered two checks in a row; otherwise the number of budgets exceeded right now; nothing when all is well.
- **Icon menu** (right click): a status line («The lens is responding (127.0.0.1:4777)», «The lens is not responding (…)» or «Checking the lens…»), «Budgets exceeded: N» when there are some, then **Reload** and **Open in Browser**.

## Notifications

The app checks the lens 5 seconds after starting and then once a minute, also with the window closed: `GET /healthz` and then `GET /api/budget`, with its own HTTP session (no cookies, no cache) and the token in the `Authorization` header. It does not read the dashboard's page. After waking from sleep the failed checks from before do not count and the next check comes after 10 seconds. macOS may delay a check by a few minutes to save energy (App Nap): a notification may arrive late.

| Event | Title | Text |
|---|---|---|
| A budget is at 100% or more (day, week or month; tokens, cost or steps) | Budget exceeded | «Today, tokens: 120% of the budget» (also «This week», «This month»; «cost», «steps») |
| A model went over its daily budget (`LENS_MODEL_LIMITS`) | Budget exceeded | «openai/gpt-5.5: 104% of today's budget» |
| More than three new budgets at once (for example at the first start) | Budgets exceeded: N | the first three, then «and N more» |
| The lens does not answer two checks in a row (about 2 minutes), after answering at least once since the app started | The lens is not responding | «No answer from 127.0.0.1:4777 in the last checks.» |
| The lens answers again | The lens is responding again | «127.0.0.1:4777 is answering.»; the previous notification is removed |

- The 503 of the diagnostic mode also counts as «not responding».
- **Deduplication.** Each budget is notified once per period: «Today, tokens» at most once a day, «This week» once a week. Those already notified are kept in `notified.<port>` in the app's preferences (`local.opencode-lens.app`); when the period ends they are forgotten. Opening the app again does not repeat the notifications.
- **Remembered only when delivered.** If a notification does not go out (permission denied, an error of the notification center), that budget is not marked and the next check tries again.
- A click on a notification brings the window to the front on the **Now** view. Notifications appear also while the app is in front.
- **Help › Send a Test Notification** sends a notification; when it cannot appear, an alert says why (notifications turned off, or the system's error).

To see the budget notifications already sent again (port 4777): `defaults delete local.opencode-lens.app notified.4777`.

### If notifications do not arrive

With the ad-hoc signature `app.sh` uses by default, macOS may refuse the app's notifications: the notification center does not recognize it and the system log shows «Failed to find or validate client». To enable them:

1. Open the copy in `~/Applications` and answer **Allow** to the request, if it appears.
2. **System Settings › Notifications › OpenCode Lens**: turn on «Allow notifications», style «Banners».
3. **Help › Send a Test Notification**.
4. If the app is not in the list or the test gives an error, sign it with a code-signing certificate (for example the one you already use for Monitor). Find its exact name:

   ```bash
   security find-identity -v -p codesigning
   ```

   Reinstall with that certificate and check the signature:

   ```bash
   LENS_APP_SIGN="<exact certificate name>" bash ~/Applications/opencode-lens/extras/macos/app.sh install
   codesign -dv ~/Applications/"OpenCode Lens.app" 2>&1 | grep Authority
   ```

   Open the app again and repeat steps 2 and 3.

For diagnosis, the log of the last 5 minutes (in zsh use `/usr/bin/log`: `log` alone is a shell command):

```bash
/usr/bin/log show --last 5m --predicate 'eventMessage CONTAINS "local.opencode-lens.app"' | grep -iE "validate client|hasError"
```

Budgets that were not delivered were not remembered: they arrive by themselves at the first successful check.

## Open at Login

**OpenCode Lens › Open at Login** opens the app (and the window) at every login. The item is enabled only with the app in `~/Applications` or `/Applications`, where `app.sh install` puts it; from another folder (for example a test build) it is disabled and a tooltip says why. Turning it off is always possible.

If macOS asks for an approval, the item becomes «Open at Login (to approve in System Settings)» and a click opens **System Settings › General › Login Items**. After a reinstall macOS may show the «Login item added» notice again.

It is independent of the lens's start, which stays the LaunchAgent's job (and Monitor's for Start/Stop).

## Port, token and host

The app reads port, token, host and language from the `EnvironmentVariables` of the LaunchAgent's plist, `~/Library/LaunchAgents/local.opencode-lens.plist`, as the MCP server does. It reads it again at every load and every check: if you change the port from Settings, the app follows the lens to the new address.

| Variable | Use in the app |
|---|---|
| `LENS_PORT` | the lens's port; empty, `0` or invalid → 4777 |
| `LENS_TOKEN` | token for the dashboard and the checks; **valid only on the plist's port** |
| `LENS_HOST` | `127.0.0.1`, `0.0.0.0`, `::`, `[::]` → the app uses `127.0.0.1`; `localhost` → `localhost`; any other value (`::1`, a network address, a name) → «Unsupported address» page |
| `LENS_LANG` | the app's language (`it`, `en`, `fr`) |

- `LENS_PORT` and `LENS_TOKEN` in the app's environment (for example `open -n --env LENS_PORT=4800 …`) take precedence over the plist. When the port comes from the environment and differs from the plist's, the plist's token is not used: the real lens's token never goes to a development lens.
- A non-loopback host is refused: the app never connects to another computer and never sends the token in clear over the network. For a lens reachable from the network use the browser.
- A `401` reads the plist again and sets the token once more; if the lens still refuses, the «Missing or wrong token» page appears.

## Security

- **Only the lens's origin.** Only the lens's `http://<host>:<port>`, with no credentials in the address, stays in the window; `about:blank` is allowed. A file created by the dashboard (the lens's `blob:`) can only be saved. Everything else is cancelled: `file:`, `javascript:`, `data:` as a page, frames and redirects to other sites.
- **External links in the browser, only when clicked.** A click on an `http`, `https` or `mailto` link to another site (also `target="_blank"`) opens it in the system browser. A `window.open` called by a script opens nothing: scripts cannot open windows and the app never creates a second page.
- **No injected JavaScript.** No user scripts, no bridges between page and app; the error page is native; the lens's Content-Security-Policy stays intact. A test (`test/macos-app.test.js`) enforces it.
- **The token** reaches the dashboard in a session cookie `lens_token` (HttpOnly, SameSite Strict, no expiry: it never goes to disk), set by the app before loading; for the checks it goes in the `Authorization` header. Never in the address, never in the logs. If you pass it with `open --env LENS_TOKEN=…` it is visible in `ps eww`, as for the MCP.
- **Network**: App Transport Security allows only the local network (`NSAllowsLocalNetworking`). Signed with the hardened runtime; no App Sandbox.
- **Data**: the dashboard's preferences (`localStorage`) live in the app's WebKit data, `~/Library/WebKit/local.opencode-lens.app`.
- **Known limit.** An `a.click()` called by a script on a link without `target` reaches WebKit as a real click: an external link opened that way would go to the browser. Only the lens's scripts run in the window (its Content-Security-Policy ensures it), so it would take a flaw in the dashboard itself.

## Update

After every install of the lens (a new zip from the terminal, or **Settings › Update**, also from the app) `install.sh` runs `app.sh update`: when the app is installed and its version differs from the lens's, it rebuilds and reinstalls it. It opens it again only if it was open. The build takes about a minute and starts after the lens has restarted, which is already up in the meantime; its log ends up in the update's.

If the build fails (for example the Command Line Tools are missing), the lens stays updated and **Settings › Update › macOS app** says the app was left behind, with the button to retry. From the terminal:

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh update
```

`LENS_SKIP_APP=1 bash <extracted folder>/install.sh` skips the step.

**With a certificate.** Without `LENS_APP_SIGN`, `app.sh` reuses the certificate the installed app was signed with, when the keychain still has it. The first time `codesign` uses its key, macOS may ask for permission with a window: answer **Always Allow**. If nobody is at the screen, a build started from the dashboard waits; the lens is updated anyway.

## Uninstall

```bash
bash ~/Applications/opencode-lens/extras/macos/app.sh uninstall
```

It removes, in this order: the login item (the app itself unregisters it, with `OpenCodeLens --unregister-login-item`), the running app, `~/Applications/OpenCode Lens.app`, the build cache `~/Library/Caches/opencode-lens-app`, the WebKit data (`~/Library/WebKit/local.opencode-lens.app`, `~/Library/Caches/local.opencode-lens.app`, `~/Library/HTTPStorages/local.opencode-lens.app` and `.binarycookies`), the saved window state and the app's preferences (`defaults delete local.opencode-lens.app`: window size, zoom, notified budgets).

It leaves the lens, its LaunchAgent, the database and all its data, and Monitor. To remove the lens too follow [disinstallazione.md](disinstallazione.md), running this command first: the script lives in the lens's folder.

## Development

```bash
bash extras/macos/app.sh test                 # tests of the pure part (Sources/Core), «OK N checks»
bash extras/macos/app.sh build --out /tmp/olapp   # builds without installing
npm run test:macos                            # real build, signature, version and icon; before a release
```

- `app.sh build` without `--out` builds into the cache, `~/Library/Caches/opencode-lens-app`. Pick an `--out` folder outside iCloud (`~/Documents` may be in it): extended attributes break the signature and the script says so. The build itself happens in a temporary folder.
- `npm run test:macos` (`test/macos/app.test.js`) really builds the app and checks bundle, ad-hoc signature with hardened runtime, version, icon and architecture, without ever starting it. It is skipped off macOS or without the Command Line Tools. In CI it runs in the `macos` job (macOS 26 runner), which fails if the test is skipped; it also stays among the checks before a release.
- `npm test` (CI included) has the static checks `test/macos-app.test.js` (script, `Info.plist`, sources without injected JavaScript, no lens file depending on the app) and `test/macos-app-contract.test.js` (the lens APIs the app uses).
- Variables for testing, passed with `open -n --env …`:

  | Variable | Effect |
  |---|---|
  | `LENS_APP_PLIST` | another plist instead of the LaunchAgent's, for example the development lens's `dev/data/dev.plist` (copy it out of `~/Documents`: there macOS permissions may block the app) |
  | `LENS_APP_INSPECTABLE=1` | the page becomes inspectable from Safari › Develop (macOS 13.3 or later) |
  | `LENS_PORT`, `LENS_TOKEN` | port and token instead of the plist's |
  | `LENS_APP_SIGN` | for `app.sh build` and `install`: the certificate to sign with instead of the ad-hoc signature |

  ```bash
  open -n --env LENS_APP_PLIST=/tmp/dev.plist --env LENS_APP_INSPECTABLE=1 "/tmp/olapp/OpenCode Lens.app"
  ```

- Layout: `Sources/Core` (pure logic, Foundation only, with its tests in `Tests/CoreTests.swift`), `Sources/App` (AppKit, WebKit, notifications, login items), `Tools/MakeIcon.swift` (the icon, generated from the dashboard's mark at every build), `Info.plist`, `app.sh`. No Xcode project, no SwiftPM.

## Limits

- It is not integrated with `uninstall.sh` or **Settings › Uninstall**: it is removed only with `app.sh uninstall`.
- No menu bar icon (Monitor has one), no option to hide the Dock icon, no hidden launch at login.
- Notifications do not cover the «over the budget by the end of the day» projection, API drifts or the reason of the diagnostic mode; the one-minute interval cannot be changed.
- With a wrong token the checks fail as if the lens did not answer: the Dock says «not responding», while the window shows the token page.
- `LENS_HOST=::1`, network addresses and `.local` names are not supported.
- Only the architecture of the Mac that builds it; ad-hoc signature by default (notifications may need a certificate); no App Sandbox.
- **OpenCode Lens Help** opens this page on GitHub: it needs access to the repository.
- `prompt()` is not supported (the dashboard does not use it).
