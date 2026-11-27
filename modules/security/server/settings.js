// Where Security looks: the folders of the guards' audits and the folder of their policies, from LENS_SECURITY_DIRS
// and LENS_SECURITY_CONFIG_DIR or, without them, OpenCode's XDG data folder (also on macOS) and OpenCode's config
// folder. Nothing is refused, as before the module; a relative folder (XDG_DATA_HOME too) is resolved against the
// lens's working directory, where the core's reads resolved it, so /api/about (absolute paths only) still lists it.
import path from "node:path";

/** Folders searched for `<guard>.audit.jsonl`: LENS_SECURITY_DIRS (":"-separated) or OpenCode's data folder and its security/. */
function securityDirs(ctx) {
  const given = (ctx.env.LENS_SECURITY_DIRS ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);
  if (given.length) return given.map((dir) => path.resolve(dir));
  const data = path.resolve(ctx.paths.xdgData, "opencode");
  return [data, path.join(data, "security")];
}

/** configure(ctx): { values: { dirs, configDir }, errors: [] }, read from ctx.env and ctx.paths only; every folder absolute. */
export function configure(ctx) {
  const configDir = path.resolve(ctx.env.LENS_SECURITY_CONFIG_DIR || ctx.paths.opencodeConfigDir);
  return { values: { dirs: securityDirs(ctx), configDir }, errors: [] };
}
