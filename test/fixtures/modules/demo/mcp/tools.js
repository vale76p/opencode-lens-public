// Test fixture: the demo module's MCP tool, built only from the kit the MCP process passes in.
export function tools(kit) {
  const args = kit.argSpec({ since: { enum: Object.keys(kit.SINCE), default: "24h", description: "periodo" } });
  return [
    {
      name: "demo",
      title: "Demo",
      description: "Lo strumento del modulo di prova",
      inputSchema: args.inputSchema,
      run: async (a, { signal }) => {
        const p = args.parse(a);
        return kit.withLens(signal, async (lens) => {
          const d = await lens.get("/api/demo", {}, signal);
          return `Demo ${kit.SINCE_LABEL[p.since]}: ${kit.text.plural(d.count ?? 0, "evento", "eventi")}`;
        });
      },
    },
  ];
}

/**
 * Test fixture: the demo module's prompts (a PromptSource), read from the fake lens's /api/demo/prompts
 * ({ prompts: [{ id, name, brief, text }] }), built only from the kit.
 */
export function prompts(kit) {
  const read = async (signal, timeoutMs) => {
    const r = await kit.connect(timeoutMs ? { timeoutMs } : {}).lens.get("/api/demo/prompts", {}, signal);
    if (!Array.isArray(r?.prompts)) throw new kit.LensError("Lens ha risposto con dati inattesi su /api/demo/prompts");
    return r.prompts;
  };
  const snapshotOf = (list) => JSON.stringify(list.map(({ id, name, brief }) => ({ id, name, brief })));
  return {
    async list(signal) {
      const list = await read(signal);
      return { prompts: list.map(({ id, name, brief }) => ({ id, name, brief })), snapshot: snapshotOf(list) };
    },
    async get({ name }, signal) {
      const p = (await read(signal)).find((x) => x.id === name);
      if (!p) throw new kit.PromptNotFoundError(`prompt della demo sconosciuto: ${kit.text.cleanName(name)}`);
      return { description: `Prompt della demo ${kit.text.cleanName(p.name)}`, text: p.text };
    },
    async instructions(signal) {
      const list = await read(signal, 3000);
      return list.length ? [`Prompt della demo: ${list.map((p) => p.id).join(", ")}`] : [];
    },
    async snapshot(signal) {
      return snapshotOf(await read(signal));
    },
  };
}
