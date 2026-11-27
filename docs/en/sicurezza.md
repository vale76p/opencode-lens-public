# Security: DLP guards

🌐 [Italiano](../sicurezza.md) · English · [Français](../fr/sicurezza.md)

A **DLP guard** is an OpenCode plugin that checks what external MCP tools are about to send out (for example the text of a request to a documentation service) and lets it through, blocks it or asks you. The one that exists today is **Context7 Guard**, but the **Security** page (`#security`) does not know it by name: it reads the files a guard leaves on its own, so a new guard shows up by itself.

The page answers three questions:

1. **What went through and what was blocked**, over a period you choose.
2. **Why**: which categories of data the guard recognised, in which tool and on which object.
3. **Does the guard work?** Whether its audit is readable and recent, whether its policy is valid and whether it records all the calls Lens saw.

The lens **writes nothing** to the guard's files and does not change how the guard behaves: it only opens its files read-only. The events are read again from the file at every request (with a cache keyed on the modification date) and are never copied into the database.

## The Security module

Security is a **module** (`modules/security/`, see [moduli.md](moduli.md)) and is **off** by default: you turn it on from **Settings › Modules**. Off, it has no menu entry, `/api/security` and `/api/security/<guard>` answer 404, `/metrics` has no `opencode_lens_security_events` series and the MCP server does not offer the `security` tool. With the module off the lens does not read the guards' files: it only looks whether an audit exists, for the “was in use: turn it back on from Settings › Modules” notice after an upgrade. The folders it searches are two settings of the module (see [Folders searched](#folders-searched)).

## How the lens finds a guard

By file-name convention. A guard `<name>` leaves up to three traces:

| What | Where | Required |
|---|---|---|
| **Audit** | `<name>.audit.jsonl` in OpenCode's data folder (`$XDG_DATA_HOME/opencode`, usually `~/.local/share/opencode`) or in its `security/` subfolder | yes: it is what makes the guard exist |
| **Policy** | `<name>.json` in OpenCode's configuration folder (`$XDG_CONFIG_HOME/opencode`, usually `~/.config/opencode`) | no |
| **Plugin** | a `plugins/<name>.*` or `plugins/<name>-*` file with a `.ts`, `.js` or `.mjs` extension in the same configuration folder: the name is followed by a dot or a hyphen, so the guard `a` does not take `aws-tool.ts` | no |

For Context7 Guard they are, for example, `context7-guard.audit.jsonl`, `context7-guard.json` and `plugins/context7-guard.v2.ts`.

**For a new guard to appear, all it has to do is write a `<name>.audit.jsonl`** in one of those folders. There is nothing to change in Lens, nothing to register and nothing to declare in a file: the policy and the plugin, if there, are recognised by name.

Rules:

- `<name>` is made of lowercase letters, digits and hyphens (`context7-guard`), at most 40 characters. Other `.audit.jsonl` files are ignored.
- The folders are scanned without going into subfolders. If the same name appears in two folders the first one wins. At most 20 guards are shown, in alphabetical order.
- Only regular files are read: a symbolic link is never followed. The plugin is never opened: the lens only checks that the file is there.
- The guard's label is its name in readable form (`context7-guard` becomes "Context7 guard").

### A line of the audit

Each line is a JSON object. All fields are optional except the time; what is missing stays empty, with no error.

| Field | What it is |
|---|---|
| `ts` | the time: an ISO 8601 string or milliseconds since the epoch. Without a valid time, or with a time more than a day in the future, the line is discarded |
| `outcome` | the outcome. `allowed`, `blocked`, `approved-by-user` and `rejected-by-user` are translated; any other value (lowercase and hyphens, up to 40 characters) is shown as it is, an invalid one becomes "?" |
| `tool` | the MCP tool that was called |
| `kind` | the kind of call |
| object | what the call was about, taken from the **first field present among `object`, `library`, `target` and `resource`** (up to 120 characters) |
| `findings` | up to 20 findings `{ category, detail, field }`. `category` is a code of uppercase letters, digits and `_` (`INFRA_INTERNA`); `detail` is the guard's own text (up to 160 characters) |
| `chars`, `lines` | the size of what was about to be sent |
| `sha256` | the fingerprint (hexadecimal) of what was about to be sent; the MCP tool shows its first 12 characters, the same as in the guard's block message |
| `sessionID` | the OpenCode session: it is the link with the lens's sessions |
| `callID`, `partID`, `runtime` | identifiers the page shows in the detail |
| `args` | the preview: an object of up to 4096 characters. If the guard does not write it, the detail says "not recorded by the guard" |

A line that cannot be read (broken JSON, more than 8 KiB, without a valid time or with a time more than a day in the future) does not become an event but is counted as an **unreadable line**. The last line, if it does not end with a newline, is still being written: it is ignored and not counted. An audit larger than **20 MiB** is read from the tail only (the last 20 MiB): the health card says so.

Category codes are shown in readable form (`INFRA_INTERNA` becomes "Infra interna") and each one gets a colour from the page's palette, always the same for the same code. There are 6 colours for any number of codes: two different categories can share a colour, so the name matters more than the colour.

## The page

With the module on, `#security` is in the *Lens* group of the sidebar, after System (if that is on too). It is a fixed (not a widget), read-only page with a period of its own: **7 days**, **30 days** (the default) or **All**, remembered by the browser. It is read again every 10 seconds while it is open.

- Under the title, the chosen guard and its **verdict** in words; the dot next to the update time takes its colour.
- One button per **guard**, with a dot in the colour of the verdict (green, yellow, red).
- **At the top**, a dark band with six tiles, each with its chart:
  - *Guard status*: a ring with the checks without problems (for example 5/5), the verdict and a coloured bar for each check;
  - *Calls* (with how many were allowed) and *Blocks*, with their trend over the period and the **change** from the period of the same length just before (for blocks an increase is red). The change is missing with *All* and when the audit does not reach back to the start of the period before, because it would make that period look quieter than it was;
  - *Block rate*, with its moving average over 7 points. It appears only if the period has at least one allowed call: if the guard records only blocks, the tile says "only blocks recorded";
  - *Detected*: the most frequent category and a bar with the share of each category;
  - *Last block*: when and in which tool, with the blocks of the last 24 hours on a line.

  A block is a `blocked` or a `rejected-by-user`; an allowed call is an `allowed` or an `approved-by-user`.
- **Health**: the verdict with a shield and a row for each check, with its state, its value and a note on why it matters or what to look at (see [below](#health)).
- **Policy**, next to the health: the protections turned on or off and the keys split into groups, see [below](#the-policy).
- **Events**: above the table, calls and blocks over time. Calls (allowed and approved by the user) are above the axis, blocks (blocked and rejected by the user) below it, on a scale of their own, because a few blocks among many calls would otherwise be invisible; one point per hour for a period up to 2 days, per day up to 120 days, per week beyond. Hover a point to read its counts. Then the table, newest first, 50 per page (*Previous* and *Next*), with the filter **All** or **Blocks only**. Each row has time, outcome, tool, object and categories. Clicking a row opens the detail: object and kind, field, size, session (title and folder, if Lens knows it), whether Lens also saw the tool, the call identifier, the runtime, the fingerprint, the findings with their text and the **preview** (only if the guard writes `args`). Next to the call identifier and the fingerprint there is a **Copy** button. While the detail is open, the read every 10 seconds does not redraw it until the event changes, so selected text stays selected.
- Next to the events: **What was detected** (events per category, the first 8), **By tool** (events of the 10 busiest tools, with the blocked part) and **When it happens** (blocks by weekday and hour, in the local time of the lens's computer).
- With no guard at all, the page says which folders it searched and points to this document.

The totals, tiles, charts and categories are always those of the **whole period**: the blocks filter and the paging change only the table.

## Health

For each guard the lens answers "can I trust it?" without asking the guard anything:

| Check | What it looks at |
|---|---|
| Audit | that there are events; size; unreadable lines; whether it was read from the tail only |
| Policy | that `<name>.json` is there, is valid JSON (an object) and is within 1 MiB. If it contains `auditLog`, that it is a string pointing to the audit file actually found (only a leading `~/` is expanded, and symbolic links in the folders are resolved on both sides); an `auditLog` that is not a string counts as "points to another file" |
| Plugin | that the file in `plugins/` is there |
| Last event | when; **more than 7 days ago** is "stale" |
| Check against Lens | see below |

The **verdict** is the worst of the checks. It is *broken* (red) if the policy exists but is not valid. It is *to check* (yellow) if the last event is stale, there are unreadable lines, the audit was read from the tail only, `auditLog` points to another file, the policy is too large or the check against Lens finds a gap. Otherwise it is *ok* (green). A missing plugin or policy does not lower the verdict: they are optional.

### Check against Lens

It is the only "live" signal that asks nothing of the guard. The distinct `tool` names that appear in the audit (ever, not only in the period) are the tools the guard watches. For the chosen period the lens counts the calls to those tools in its own database and compares them with the audit's lines:

- equal: "12 calls, as in Lens";
- **more calls in Lens than in the audit**: "Lens saw 12 calls, the audit 0" is a gap (yellow verdict). It means the guard is not recording: it is off, not loaded, bypassed or does not write allowed calls;
- "Cannot be checked" if the audit does not name any tool yet.

Lens's calls are counted from the oldest event the audit still holds, when that is later than the start of the period: calls made before the guard started writing, before the audit was rotated or before the part read of an audit over 20 MiB are not a gap. A guard that wrote in the past and writes nothing in the period does give a gap.

The page does not decide for you what happened: it gives the two figures. For a guard that records **only blocks** the check reports a gap every time a call goes through, because Lens counts it and the audit does not.

## The policy

If `<name>.json` exists and is valid, the page shows all its top-level keys (up to 100), split into groups: *Enforcement*, *Detection*, *Lists* and *Audit* for the keys of guards that follow the Context7 Guard convention, *Other* for all the rest, in the file's order. A path or a long text takes the whole width of its group.

Above the groups, the **protections** the policy turns on or off, for the known keys only: *Blocks* (`mode` equal to `block`), *Fail-closed* (`failClosed` true), *Personal data* (`detectPersonalData` true), *No evidence in the log* (`logEvidence` false) and *Full audit* (`auditAllowed` true). Each is green when it protects and yellow when it does not, with the count "n of m protections on" next to the title; the yes/no of these keys take the same colour. A key that is missing, masked or has a value of another kind does not become a protection. A guard with other keys is not judged: its keys are just shown.

How values are shown:

- strings and numbers as text; booleans as yes/no; lists of strings as labels (the first 5, then "+n", which counts every entry of the list, also beyond the 50 the lens sends); objects and other lists as their number of entries; key names are cut at 60 characters;
- keys whose name contains, in upper or lower case, `secret`, `token`, `password` or `passwd`, `api_key`, `api-key` or `apikey`, `credential`, `private`, `auth`, `bearer` or `dsn` are **left out**, and the note under the groups says how many;
- a string is masked as `••••` if any of its words (separated by spaces) is 32 characters or more, has high entropy and is not a path: so `Bearer eyJ…` is hidden as a whole too;
- a word is a path, and is shown in full, when it starts with `~/`, `/`, `./` or `../`, contains no `+` or `=` (base64 has them) and has at least two parts separated by `/`, each made only of letters, digits and `.`, `_`, `~`, `@`, `%`, `-`. A path with a space is looked at word by word: if the part after the space is long and has high entropy, the string is masked.

The policy shown is **the global policy**, the one in OpenCode's configuration folder: a project can make it stricter and Lens does not see that. The note under the groups says so again, with the file's last modification date.

## Who sees what

Three levels, the same for the page, `/api/security` and the MCP tool:

| Where | What it sees |
|---|---|
| **Dashboard on this computer** | everything: objects, finding details, sessions, previews, policy, file paths, session and folder filters |
| **Dashboard over the network** (with the token) | the "reduced view" (`restricted: true`): for each event only time, outcome, tool, kind and category codes; then totals, charts, categories and health. The Security endpoints give no objects, details, sessions or policy, and no paths or searched folders; the Settings page, in *Data and files*, does list the guards' folders, as it lists every other path of the lens. The session and folder filters are ignored |
| **MCP tool `security`** | events with time, outcome, tool, object, categories and the 12-character fingerprint; never the findings text (`detail`) nor previews. Of the policy, keys and simple values (numbers as written); lists become "N entries", N being the number of all the entries, and masked values stay hidden |

Behind a reverse proxy that adds its own headers, even requests from the same machine count as "over the network": see [Behind a reverse proxy](configurazione.md#behind-a-reverse-proxy).

## Folders searched

Two variables, both optional, which are the **module's settings**: they are read only while the module is on and are changed from its card in **Settings › Modules** (not from the table of the core's variables; see [moduli.md](moduli.md#a-modules-settings)). A wrong value puts the module in error, with the reason in the card.

| Variable | Default | |
|---|---|---|
| `LENS_SECURITY_DIRS` | `$XDG_DATA_HOME/opencode:$XDG_DATA_HOME/opencode/security` (usually `~/.local/share/opencode`, also on macOS) | where to look for `<name>.audit.jsonl`; several folders separated by `:` |
| `LENS_SECURITY_CONFIG_DIR` | OpenCode's configuration folder (`$XDG_CONFIG_HOME/opencode`, usually `~/.config/opencode`) | where to look for `<name>.json` and `plugins/<name>*` |

With `LENS_SECURITY_DIRS` set, **only** the listed folders are searched. The Settings page, in the *Data and files* section, lists them among the files read, as "read-only", while the module is on; they are read-only paths the lens neither writes nor deletes, and the uninstall script never touches them.

## MCP tool `security`

For the model working in OpenCode: `lens_security`. See [MCP server for OpenCode](configurazione.md#mcp-server-for-opencode) for installation.

**OpenCode must be restarted.** The tool exists only with Security on. When you turn it on or off, the MCP notices within 30 seconds and tells OpenCode with `notifications/tools/list_changed`, but OpenCode (verified with 2.0.26) does **not reread** the list of tools nor the server's instructions: it keeps showing the old list until you restart it. If `lens_security` is already in the list and the module is off, calling it answers “Il modulo Security è spento in Lens: attivalo da Impostazioni › Moduli.”; if you have just turned the module on, the tool shows up after the restart. If the lens stops answering, the MCP keeps the last known state.

| Argument | Values | |
|---|---|---|
| `guard` | the guard's name | without it, the only guard found if there is one, otherwise the summary of all |
| `session` | `current` or a `ses_…` id | a single session |
| `scope` | `project` (default) or `all` | without `session`: the project of the asking session, or all |
| `since` | `1h`, `6h`, `24h` (default), `7d` | the period, up to now |
| `outcome` | `blocked`, `allowed`, `all` (default) | only blocked, only allowed or all |
| `limit` | 1–30, 10 by default | events at most |

Typical questions: "what did the DLP guards block today?", "is the Context7 guard working?". If a tool failed with a message starting with "GUARD — invio bloccato" it is a DLP block, not a failure: the server's instructions tell the model so, and it asks `security` (with `session: "current"` and `outcome: "blocked"`; the 12-character fingerprint is the same as in the message).

The answer says how many calls there were and how many were blocked (and the rate, if the audit also records allowed calls), the categories detected (up to 10, then how many more), the most recent events, the health (audit, policy, plugin, check against Lens, verdict and, when it is not ok, its reasons: unreadable lines, no event for N days, audit read from the tail only, `auditLog` pointing to another file, policy not valid or too large, gap with Lens) and the global policy. The totals at the top are the guard's over the whole period: `session` and `scope` narrow only the events line, which says what it refers to. The usual text handling applies: cleaned, shortened and between « ».

## On `/metrics`

One gauge, written from the cached scan, which **exists only with Security on**:

| Series | Type | Labels |
|---|---|---|
| `opencode_lens_security_events` | gauge | `guard`, `outcome` (`allowed`, `blocked`, `approved-by-user`, `rejected-by-user`, and `other` for any other outcome or a line without one): the events present **in the whole audit** for each outcome |

It is a gauge, not a counter: if the audit is rotated or cleaned it goes down, and an audit read from the tail counts only what was read. It also goes to the OTLP export (as a gauge, with the other metrics of the modules that are on) and has no period. An example alert on blocks in the last hour: `delta(opencode_lens_security_events{outcome="blocked"}[1h]) > 0`.

## Limits and what the lens does not do

- **It writes and creates nothing** in the guard's folders and does not change the guard: it only reads. The data stays in the guard's files; the lens does not copy it into the database.
- **The policy is the global one.** A project can have a stricter one and Lens does not know.
- **The preview is there only if the guard writes `args`** (in Context7 Guard with `logEvidence` on in the policy). Without it, the detail says "not recorded by the guard".
- **An audit over 20 MiB is read from the tail**: older events are not seen, the totals hold for the part read and the verdict is yellow.
- **Category colours can repeat** (there are 6 for any number of codes).
- **The check against Lens holds for the tools the audit names.** A guard that has not written any line yet has nothing to compare ("Cannot be checked"), and the name in `tool` must be the one under which Lens records the call.
- The page sees what the guard wrote, not what it should have written: if a line is missing, the check against Lens is the only clue.
