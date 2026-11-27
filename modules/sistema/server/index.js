// The Node side of Sistema: GET /api/system (everything, processes, ports and agents only for this computer)
// and GET /api/system/live (CPU and memory every 2 s). The history sampler runs between start() and stop().
import { SystemInfo } from "./system.js";

export function create(ctx) {
  const system = new SystemInfo({ collector: ctx.collector, store: ctx.store, dbPath: ctx.dbPath });
  return {
    routes: {
      // CPU and memory every 2 s for the page: summary data, as the history in /api/system
      "GET /api/system/live": () => system.live(),
      // processes, ports and agents describe the whole computer: only for this computer
      "GET /api/system": (_req, { url, local }) => system.get({ local, q: url.searchParams.get("q") }),
    },
    start: () => system.start(),
    stop: () => system.close(),
  };
}
