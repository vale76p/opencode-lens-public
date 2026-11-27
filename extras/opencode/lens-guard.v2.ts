/**
 * lens-guard — plugin per OpenCode 2.x (provato su 2.0.26)
 *
 * Quando il provider non può rispondere, il turno continua su un modello di
 * riserva invece di fermarsi: niente prompt da rimandare.
 *
 * Cambia modello in tre casi:
 * - quota esaurita (429 con insufficient_quota, billing…);
 * - rate limit con un Retry-After lungo (attesa ≥ minRetryDelayMs, 60 s per default);
 * - provider non raggiungibile (connessione rifiutata, DNS non risolto, rete assente).
 * Il modello successivo viene dalla catena `fallback`; ogni catena si percorre
 * una sola volta per turno. La TUI mostra «Switched model from … to …» e la
 * sessione resta sul modello di riserva. Non serve che Lens sia attiva.
 *
 * Installazione:
 *   cp lens-guard.v2.ts ~/.config/opencode/plugins/
 *   cp lens-guard.example.json ~/.config/opencode/lens-guard.json   (e modificalo)
 * Configurazione: ${XDG_CONFIG_HOME:-~/.config}/opencode/lens-guard.json, JSON puro,
 * oppure il file indicato da LENS_GUARD_CONFIG. LENS_GUARD=off lo disattiva.
 * Dettagli: docs/configurazione.md di opencode-lens.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type ModelRef = { providerID: string; id: string; variant?: string }
type ProviderError = { type?: string; status?: number; message?: string; response?: { body?: string } }
type Decision = { retry: boolean; delay?: number }
type RetryEvent = { sessionID: string; model: ModelRef; error?: ProviderError; attempt?: number; decision: Decision }
type ContextEvent = { sessionID: string; messages?: { id?: string; role?: string }[] }
type Ctx = {
  session: {
    hook(name: string, fn: (e: never) => unknown): unknown
    switchModel(input: { sessionID: string; model: { providerID: string; id: string } }): Promise<unknown>
  }
}
type Config = { fallback: Map<string, string[]>; minRetryDelayMs: number }
type Turn = { turn: string | undefined; tried: Set<string>; chain: string[] | null }

const MIN_RETRY_DELAY_MS = 60_000
const MODEL_REF = /^[^/\s]+\/\S+$/
const QUOTA_TEXT = /insufficient_quota|billing|quota|credit/i
// the connection was never made; resets mid-stream are left to OpenCode's own retry
const UNREACHABLE = /ConnectionRefused|Unable to connect|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|getaddrinfo|DNS/i

function configPath(env: NodeJS.ProcessEnv): string {
  if (env.LENS_GUARD_CONFIG) return env.LENS_GUARD_CONFIG
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(base, "opencode", "lens-guard.json")
}

/** The config, or null when the plugin must stay off (missing, not JSON, wrong shape). */
function loadConfig(env: NodeJS.ProcessEnv): Config | null {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(configPath(env), "utf8"))
  } catch {
    return null
  }
  if (!isObject(raw) || !isObject(raw.fallback)) return null
  const fallback = new Map<string, string[]>()
  for (const [key, list] of Object.entries(raw.fallback)) {
    if (!MODEL_REF.test(key) || !Array.isArray(list)) continue
    const chain = [...new Set(list.filter((m): m is string => typeof m === "string" && MODEL_REF.test(m) && m !== key))]
    if (chain.length) fallback.set(key, chain)
  }
  const delay = raw.minRetryDelayMs
  const minRetryDelayMs = typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? delay : MIN_RETRY_DELAY_MS
  return { fallback, minRetryDelayMs }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Why this failure deserves another model, or null to leave it to OpenCode. */
function reason(error: ProviderError | undefined, decision: Decision | undefined, cfg: Config): string | null {
  if (!error) return null
  const text = `${error.response?.body ?? ""} ${error.message ?? ""}`
  // trust OpenCode's type when it has one: some providers say "quota" for per-minute limits
  if (error.type === "provider.quota" || (!error.type && error.status === 429 && QUOTA_TEXT.test(text))) return "quota"
  const rateLimited = error.type === "provider.rate-limit" || error.status === 429
  if (rateLimited && decision?.retry === true && (decision.delay ?? 0) >= cfg.minRetryDelayMs) return "rate-limit"
  if (error.type === "provider.transport" && UNREACHABLE.test(error.message ?? "")) return "unreachable"
  return null
}

/** "provider/model" split at the first slash: model ids may contain more. */
function parseRef(ref: string): { providerID: string; id: string } {
  const i = ref.indexOf("/")
  return { providerID: ref.slice(0, i), id: ref.slice(i + 1) }
}

export default {
  id: "opencode-lens.lens-guard",

  async setup(ctx: Ctx) {
    if (process.env.LENS_GUARD === "off") return
    const cfg = loadConfig(process.env)
    if (!cfg) return
    const turns = new Map<string, Turn>()
    const stateOf = (sessionID: string): Turn => {
      let st = turns.get(sessionID)
      if (!st) turns.set(sessionID, (st = { turn: undefined, tried: new Set(), chain: null }))
      return st
    }

    // A new user message starts a new turn: the chains can be walked again.
    await ctx.session.hook("context", (e: ContextEvent) => {
      const user = (e.messages ?? []).findLast((m) => m.role === "user")
      const st = stateOf(e.sessionID)
      if (user?.id === undefined || user.id === st.turn) return
      if (st.turn === undefined) {
        // state created by a retry before any context: this is still that turn
        st.turn = user.id
        return
      }
      st.turn = user.id
      st.tried = new Set()
      st.chain = null
    })

    await ctx.session.hook("retry", async (e: RetryEvent) => {
      if (!e.model || !reason(e.error, e.decision, cfg)) return
      const st = stateOf(e.sessionID)
      const key = `${e.model.providerID}/${e.model.id}`
      st.tried.add(key)
      // the first model that fails in the turn fixes the chain: no ping-pong between chains
      st.chain ??= cfg.fallback.get(key) ?? null
      const next = st.chain?.find((m) => !st.tried.has(m))
      if (!next) return
      st.tried.add(next)
      try {
        await ctx.session.switchModel({ sessionID: e.sessionID, model: parseRef(next) })
      } catch {
        return // OpenCode keeps its own decision
      }
      e.decision = { retry: true, delay: 0 }
    })
  },
}
