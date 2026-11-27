// The lens's folder and version, for every module that names them. A leaf: it imports nothing of the
// lens, so any module can import it without a cycle. It must stay in src/: APP_DIR is the folder above
// this file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")).version;
