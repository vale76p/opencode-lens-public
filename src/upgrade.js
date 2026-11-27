// Restart after an update. Extracting a new release zip over the folder the
// LaunchAgent starts from (or a pull in a clone) swaps the files, but the running
// lens keeps the old code in memory. So the lens itself checks the version next
// to its launch path and exits when it changed: launchd (KeepAlive) starts it
// again with the new code.
import fs from "node:fs";
import path from "node:path";

/** The version now installed at `launchPath` if it differs from `running`, "?" if unreadable, else null. */
export function upgradeAvailable(launchPath, running, readFile = (p) => fs.readFileSync(p, "utf8")) {
  try {
    const version = JSON.parse(readFile(path.join(path.dirname(launchPath), "..", "package.json"))).version;
    return version === running ? null : String(version ?? "?");
  } catch {
    return "?"; // files gone mid-upgrade: the new ones are where launchd will look
  }
}

/** Checks every `intervalMs`; calls `onUpgrade(version)` once. Returns stop(). */
export function watchForUpgrade({ launchPath, running, onUpgrade, intervalMs = 60_000, readFile }) {
  const timer = setInterval(() => {
    const version = upgradeAvailable(launchPath, running, readFile);
    if (version === null) return;
    clearInterval(timer);
    onUpgrade(version);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
