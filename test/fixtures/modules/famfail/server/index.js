// Test fixture: families() throws on every call; files() declares entries whose paths are not in the data folder.
import path from "node:path";

export function create() {
  return {
    families: () => {
      throw new Error("metriche rotte");
    },
  };
}

export function files(ctx) {
  const dir = path.dirname(ctx.dbPath);
  return [
    { label: "Relativo", path: "relativo.json", note: null },
    { label: "Fuori", path: path.join(dir, "..", "fuori.json"), note: null },
    { label: "Scappa", path: `${dir}/sotto/../../fuori.json`, note: null },
    { label: "Cartella", path: dir, note: null },
    { label: "Altrove", path: "/etc/passwd", note: null },
    { label: "Dentro", path: `${dir}/sotto/../famfail.json`, note: null },
  ];
}
