# Customizable dashboard

🌐 [Italiano](../dashboard.md) · English · [Français](../fr/dashboard.md)

The dashboard has **three views**, each with its own grid of **widgets** that can be moved, resized, configured, removed or added several times, and a few pages:

- **Now**: always on the budget day, without filters. How much you have used today, where the budgets stand, what OpenCode is doing at this moment.
- **Analysis**: with the period, grouping and metric filters. Trend over time, work rhythm, share per model, the heaviest prompts. The period starts at **7 days**; the one you choose stays in this browser (`localStorage`, key `lens:range`), so whoever had already chosen one finds it again.
- **Monitor**: to keep open on a screen. No filters, always the budget day, it refreshes by itself and has a **Full screen** button; if the browser refuses, nothing happens.
- **Prompts** and **Sessions**: the list of prompts and the list of sessions full page, with Analysis's filters in the title bar. They are not customizable.
- **Gallery**, **Skill**, **What's new** and **Settings**: see [The pages](#the-pages).

The layout is personal: the lens saves it on your computer and it never ends up in the release package. A new installation starts from the default layout (see [Default layouts](#default-layouts)).

## The title bar

Every page has its bar at the top: the section's icon (the same as in the sidebar), the title and, below, a line saying what you are looking at.

| Page | Line under the title | On the right |
|---|---|---|
| Now | “Today from 00:00 · resets in 2 h 32 min · 1 prompt running” (the budget day; with `LENS_RESET_HOUR` the start hour is that one; when paused it ends with “· paused · data frozen at 14:31:07”) | the state of the connection with OpenCode, Customize |
| Analysis | the filters written out: “Last 7 days · by model · in tokens” | the filters, Customize |
| Monitor | “Updates by itself · resets in 2 h 32 min”; when paused “Paused · data frozen at 14:31:07 · resets in 2 h 32 min” | the connection, the clock, Full screen, Customize |
| Prompts, Sessions | what they list, with Analysis's filters | the filters |
| Gallery, Skill, What's new, Settings | the page's content | the page's controls |

## The sidebar

On the left, 200 px wide, from top to bottom:

1. **Brand** with the name; below, “beta” and the installed version, which is a link to What's new. Right below the **Collapse to icons** button.
2. **Navigation**, in three groups. The open entry has `aria-current="page"`.
   - *Dashboard*: Now (with the number of running prompts), Analysis, Monitor and **Layout** (see [Dashboard layouts](#dashboard-layouts)).
   - *Data*: Prompts (with the number of today's prompts), Sessions (with the number of sessions in the Analysis period). Vibe Coding is a module: with the module on it has its own entry at the end of this group.
   - *Lens*: Gallery, What's new (with a dot when there is a version you have not yet marked as read), Settings. Active modules have their own entry at the end of the group they declare (Skill, System and Security, in *Lens*, before Settings).
3. **At the bottom** the state of the connection with OpenCode, as a badge with a dot and text (“Connected to OpenCode”: green if connected, yellow while connecting, red if unreachable or if data are stalled), and below it the theme button, which cycles through system, light and dark and says the current one, with an icon per mode (laptop, sun, moon). With the icons-only menu the badge is just the dot. Hovering the badge shows the state with the last event received (“Connected to OpenCode · last event 3 s ago (14:31)”, or “no event received so far”) and OpenCode's version; the same text, hidden, for screen readers. The state is a `role="status"`; the dot pulses only if there is a recent event and the system does not ask for less animation. Between the badge and the theme are **Pause** (then **Resume**) and **Refresh**, icons only in the narrow sidebar: see [Live updates](#live-updates). When paused the badge is grey, with no pulse: “Paused · Data frozen at 14:31:07”.

Hovering over an entry highlights the row and the icon takes the accent color.

**Collapse to icons** narrows the bar to 64 px, icons only, to leave more room for the dashboard; the same button, now “Expand the menu”, brings it back wide. The choice stays in this browser (`localStorage`, key `lens:railCollapsed`). With the icon bar, hovering over an icon (or reaching it with Tab) shows next to it a popup with the entry's name; counters are not visible.

**Narrow screens**: below 1100 px the bar is always icons, with the same popups (the button to collapse it is not needed and is not there); below 760 px it becomes a top bar with the brand and a menu button, which opens the navigation as a panel (Esc or a click outside closes it).

### Dashboard layouts

**Layout** is the last entry of the Dashboard group and says which default layout the three views are using: “Recommended”, “Operational”, “Watch”, “Classic”, one of your [presets](#personal-presets) or, if you moved, added or configured something, “Custom”. If the layout starts from a layout or a preset but you changed it, the name stays and “· with changes” is added (for example “Recommended · with changes”). The comparison ignores widget ids and their order in the file.

A click (or Enter, or down arrow) opens the layouts menu next to the bar. The entry with focus (with the arrows, Home and End, or hovering over it with the mouse) shows beside it a popover with the layout's description and a line for Now, Analysis and Monitor; the popover is also the entry's accessible description (`aria-describedby`). Esc closes the menu and returns focus to Layout; Tab or a click outside closes it.

Choosing a layout saves it right away for all three views, like “Save” in edit mode. Switching from one layout to another asks for no confirmation, because choosing another one again is enough; if the layout is custom or has changes the lens asks first before replacing it, and “Save as preset…” (see below) is the way to keep it. Views of a newer lens version that the file may contain stay as they were. Layout is disabled while you edit the dashboard and when the lens does not accept changes from this browser (only from this computer).

- **Recommended**: each view has a role and a horizon of its own. Now is the day up close (tokens, cost and cache against the average, the three budgets, the pace per model, the running prompt, today's sessions and prompts); Analysis follows the filters from top to bottom (summary, trend, where tokens and cost go, distribution, the heaviest, tools and permissions) and keeps the fixed-window widgets at the bottom; Monitor uses the cards that enlarge the figures in full screen.
- **Operational**: for those who work with the agent all day (systems, troubleshooting, code). Only usage and the day's budget: no widget, style, column or metric that shows a cost or the week and month budgets, and in Analysis each widget's metric is fixed to tokens, so the bar's “Cost” filter does not change it. Now answers “will I make it to the evening?” (day budget with what is left and tokens per hour, tokens and prompts against the average, hour by hour, per model with the pace, today's sessions and prompts); Analysis “where am I losing time?” (cache, failed steps and tool errors, trend, models and projects, what changed, first token and speed, tools, the heaviest); Monitor “is the agent fine?” (four traffic-light quadrants, the running prompt without the cost, the log of outcomes, failed steps, errors, retries, permissions and compactions without the successful steps, models, status and today's hours). The layout also turns off “Show costs” (see below), so no amount appears even in the Prompts and Sessions pages and in the session detail.
- **Watch**: the best of the other three, with the same rules as Operational (no costs, no week and month budgets) but with the statistics of those periods. Now has the day budget with what is left, tokens and cache against the norm, hours, pace per model, today's sessions and prompts; Analysis follows the filters from the error shares to tokens and steps over time, the prompt funnel, models, projects, distribution, first token, tools and the heaviest, and at the bottom keeps the fixed windows: “Last 7 days” and “Last 30 days” (prompts, outcomes and durations), first token and reliability at 30 days, rhythm at 28; Monitor is a screen of big figures: tokens, the day's budget, failed steps and tool errors, the running prompt without the cost, a log without the successful steps, status, hours and models.
- **Classic**: the layout of versions up to 0.20, described in [Default layouts](#default-layouts). It is still the one of a new installation.

### Personal presets

A preset is your own named copy of the three views (and of “Show costs”): you create it from a layout or from the layout in use, edit it with “Customize” and find it in the **Layout** menu, under the four layouts, in “Your presets”. At most 10 presets, with a name of 1–40 characters different from the others (capitals and surrounding spaces do not count). The four built-in layouts never change: editing them with “Customize” changes only the layout in use, never the layout itself.

Below the list the menu has the actions:

- **Save as preset…** opens the window with the cursor in the name, already “Starting from” the layout in use; the new preset becomes the one in use.
- **Update the “X” preset** (only if you are using a preset with changes) saves the changes in the preset: next time you choose it you find them again.
- **Back to “X”** (only with changes) discards the changes and applies again the layout or preset you started from, after a confirmation. It is different from “Cancel” in edit mode, which applies only before “Save”.
- **Manage presets…** opens the window where presets are created, renamed, duplicated (“Home (copy)”, “Home (copy 2)”…) and deleted. Creating a preset from a layout or from another preset uses it right away (with a confirmation if the current layout has unsaved changes). Deleting the preset in use does not change the layout, which stays as it is, with no starting preset any more (it shows as “Custom”, unless it matches a layout or another preset). While a save is in progress “Close” is disabled; the confirmation to replace a layout with changes comes before saving the preset, and cancelling it leaves the form as it was.

The layout remembers which layout or preset it started from in `prefs.origin` (`t:<layout>` or `p:<preset id>`), inside `dashboard-v2.json`, so it is saved together with the layout. A value in a format this version does not know (from a newer version) is kept and names nothing: the layout shows as “Custom” instead of being refused. If that preset was deleted, the layout shows as “Custom”, unless it matches another preset or layout. Presets are in `dashboard-presets.json`, next to `dashboard-v2.json`: like the layout they are written only from this computer (`GET` and `POST /api/presets`, in [metriche.md](metriche.md#local-api)). If the file is broken or has an invalid preset, the lens ignores it (the list is empty), writes it to the log (once per content, not at every page load) and keeps a copy in `dashboard-presets.bad.json` (only once, never overwritten), so the next save does not destroy the presets it held. The menu and the window reread the presets before every change, so a tab left open does not delete the presets saved by another; two saves at the same instant, however, overwrite each other: the last one wins.

**Show costs** is a checkbox in the Customize bar and applies to all three views. It is saved with “Save” together with the layout (`prefs.costs` in `dashboard-v2.json`) and “Cancel” brings it back as it was. Operational and Watch turn it off, Recommended and Classic turn it on. When off, the cost disappears everywhere:

- Analysis's “Cost” filter (if it was chosen, it switches to tokens);
- the cost columns of Prompts, Sessions and the table by dimension;
- the cost figure in the Summary and in today's Indicators;
- the amount of the running prompt, of the steps in Live activity and of the session detail;
- the “low cost” axis of the G11 radar.

Widgets that show only a cost (Indicator, Budget or Gauge of the cost, the C9 waterfall, a Trend or a calendar fixed on cost) say “Costs hidden”.

Every page has an address: `#adesso`, `#analisi`, `#monitor`, `#prompt`, `#sessioni`, `#galleria`, `#novita`, `#vibecoding`, `#sistema`, `#security`, `#impostazioni`. An old `#dashboard` bookmark leads to the last view used (Now at the start). Moving from one page to another, page and open details are not lost; only the data of what you see are read.

## Editing the layout

Press **Customize** (the blue button with the grid icon), at the top right of the title bar of one of the three views. The edit concerns the visible view, but **a single session covers all three**: you can change view while editing. Prompts, Sessions, Gallery, What's new and Settings are not customizable. The grid (12 columns, 40 px rows) appears dashed and each widget gets its controls:

| Control | What it does |
|---|---|
| **⠿** (top center) | drag to move the widget; the dashed outline shows where it will land |
| **corner** bottom right | drag to change width and height, in steps of one cell |
| **⚙** | widget settings (see below) |
| **×** | removes the widget |

The position is **free**, as in “float” grids (Gridstack, Grafana's free layout): a widget stays where you leave it, even with empty rows above or beside it, and only the one that gets bumped by a move or an enlargement goes down. No widget moves up by itself, and removing a widget leaves its place empty. To close empty gaps there is **Compact**.

From the top bar:

- **+ Add widget** opens the catalog, which shows first the types designed for the visible view (“For this view”) and then the others (“Others”). Each entry can be added several times, for example two charts with different settings, and arrives with the [default size of its style](#sizes-per-style). Each view holds at most 60 widgets: once there, the catalog entries are disabled until you remove one.
- At the top of the catalog, **Where** chooses where the new widget starts from:

  | Choice | Where it goes |
  |---|---|
  | ↖ top left, ↗ top right | in the first row, on the left or on the right; whatever was there goes down |
  | ↙ bottom left (default), ↘ bottom right | below the lowest widget |
  | ✛ choose on the grid | after choosing the entry, the widget's outline follows the pointer and the widgets that would be pushed move to show it; a click puts it there. From the keyboard: arrows to move it, Enter to confirm, Esc to cancel |

  The choice stays for later additions, in this browser (`localStorage`, key `lens:add-place`).
- **Compact** moves every widget up, in reading order, until it touches the top edge or the widget above: it closes the empty gaps left by moves.
- The grid goes up to row 1001: a move or enlargement that would push a widget further down is not applied, and the bar says so.
- **Save** keeps the layout of **all three** views. If something is wrong (for example a widget off the grid), the bar lists the errors and you stay in edit mode.
- **Cancel** discards everything you changed, in all views, since you entered edit mode.
- **Reset** brings back the default layout **only for the visible view**, after a confirmation that names it. It stays inside the edit session: “Save” keeps it, “Cancel” discards it (and the other views do not change).

If your layout comes from a previous version (see [Migration](#migrating-from-a-previous-version)), the first time you open the catalog you see at the top “New widgets available” with the types that arrived with the two views. New widgets do not appear by themselves in a custom layout: you add them. **Monitor** is the exception: it is a new view, and if your layout does not have it yet it takes the default one.

Leaving the page with unsaved changes asks for confirmation. If you narrow the window below 700 px the edit is suspended without losing anything: bar and controls disappear and come back, with the changes made, when the window is wide again.

### From the keyboard

In edit mode every widget is reached with Tab. With a widget selected:

| Keys | Effect |
|---|---|
| arrows | move by one cell (whatever gets bumped goes down) |
| Shift + arrows | resize by one cell |
| Del / Backspace | removes the widget |

The new position is announced to screen readers.

### When the button is missing

- **Dashboard opened from another computer** (non-local `LENS_HOST` with `LENS_TOKEN`): you see the saved layout but cannot change it. Changes are accepted only from this computer.
- **Window narrower than 700 px**: widgets stack in one column, in grid order (by row, then by column), and editing is not available (an edit already started stays suspended, see above).

## Widget settings (⚙)

Every choice also has **Dashboard**, the starting value. In Analysis it follows the filters at the top, which change only the widgets left on “Dashboard”. In Now and in Monitor, which have no filters, it is the budget day with the token metric and grouping by model, and in the ⚙ it is called **View (today)**. A widget with a period of its own shows it next to the title (for example “30 days”).

| Setting | Widgets | Values |
|---|---|---|
| Title | all | free text, at most 80 characters; empty = automatic title (for example “Cost per agent”) |
| Period | Prompts, Prompts: distribution, Trend, Interaction, Summary, Table, Tools, Sessions, Gauge, Where the tokens go, Speed | **Today** (the budget day, from midnight or from `LENS_RESET_HOUR`), 1 hour, 8 hours, 24 hours, 7 days, 30 days, all |
| Metric | Last year, Trend | tokens, cost, steps |
| Indicator | Indicator (`kpi`) | tokens, cache, prompts, cost, tool errors, first token, retries |
| Budget period | Budget | day, week, month |
| Metric | Budget | **tokens** (also when missing), steps, cost; without “Show costs” the ⚙ does not offer cost |
| Group by | Trend, Table by dimension | model, agent, provider, agent type; the table also by folder, the trend also “Total” (a single series) |
| Order | Prompts | recent, heaviest (by tokens), longest (by duration) |
| What it measures | Gauge | see below |
| Model | Gauge “Daily budget of a model” | one of the models with an active budget (“Budget per model” card in Settings); the first is chosen automatically, and a model that loses its budget or leaves OpenCode's configuration stays selected as “no longer configured” |
| Style | all widgets with more than one model | see [Styles](#styles) |
| Columns | Prompts (and “The heaviest”) | a subset of the columns, in any order: time, session, project, model, agent, outcome, duration, first token, tokens per second, steps, tools, composition, tokens, cost, cache, and only for “The heaviest” the share of the period |
| Rows | Prompts | comfortable, compact |
| Prompts shown | Prompts | all, only with problems (failed, interrupted or with a tool in error: the latest of the period, paged, not those among the latest prompts) |
| Events shown | Live activity (all styles, also the classic one) | a subset of prompts, all steps, failed steps, tool errors, compactions, sessions, warnings; the classic one's `git commit`s, which have no type, appear only with all types chosen |
| Event time | Live activity | relative (“2 min ago”), clock time |
| Event session | Live activity | shown, hidden |
| Cost | Running prompts | shown (if missing), hidden: for a screen that must not show costs |

“All steps” (`step`) also includes the failed ones, as before “Failed steps” (`failed`) existed: a saved layout with `step` keeps seeing them. To hide the successful steps, which carry the cost, without losing the failed ones and their errors, remove “All steps” and leave “Failed steps”.

The table settings (columns, rows, filters) are seen in the ⚙ only while the widget is drawn by a table style, except “Events shown”, which also applies to the classic Live activity; an empty list (no column chosen) counts as “all the default ones”. The number of rows is not a setting: it is decided by the widget's height. Changes are seen right away; “Save” keeps them.

## Catalog

Sizes in columns × rows (default / minimum); the default is that of the first style, the other styles have their own (see [Sizes per style](#sizes-per-style)). All widgets have the title among the settings; the others are listed below. “Styles” refers to [Styles](#styles): every widget that has more than one is drawn with the chosen one, and **the description below is that of the `classic` style** where it exists, or of the first style listed. Styles change the drawing, never the numbers.

| Widget | View | Size | Content |
|---|---|---|---|
| Today (`hero`) | Now, Monitor | 8×9 / 4×6 | today's tokens in large, with the comparison with the average of the previous 7 days **up to the same hour** (“+18% compared to the 7-day average at this hour”; the tooltip also has the whole-day average); composition bar (input, cache read and write, output, reasoning) with legend and values; the day's budget with the projection and “resets in …” (without a budget: the tokens and the link to Settings); 24 hour-by-hour columns with the 7-day average as a grey line; week and month in mini bars (`LENS_LIMIT_*_WEEKLY` and `_MONTHLY` budgets); cost and steps only if they have a budget |
| Per model today (`model-day`) | Now, Monitor | 6×5 / 3×4 | one row for each model used today or with an active budget: today's tokens (variants summed), bar, share of the daily budget and pace (“within budget”, “at this pace it will exceed it”, “budget exceeded”, with an icon); “no budget” otherwise; models with budgets never seen invite you to check the name; at the bottom the internal tasks, split into “titles · compaction · other” when the lens knows them, with the compaction's model in the tooltip (they do not enter the per-model budgets) |
| Today's indicators (`kpis`) | Now | 12×3 / 4×3 | five tiles, each with the sparkline of the last 7 days: prompts (closed and running), cost, cache, step latency (p50 and p95), tool errors (percentage and worst tool). On narrow widths they go to 3 or 2 columns |
| Running prompts (`live`) | Now | 4×5 / 3×4 | a box for each prompt OpenCode is running: session title or folder, agent, model, running time, steps, tool calls, tokens so far with the composition, **context fill** (for example “61%”), the running tool with its time, “waiting for a permission”, “waiting for the first token” with the running time, and for the last finished step “1.8 s to first token · 42 tok/s”. The cost so far is hidden with the “Cost” setting. Without prompts: “No prompts running” |
| Live activity (`feed`) | Now, Monitor | 6×6 / 3×4 | steps, tools, finished prompts, compactions (finished or failed, with the reason and the model) and new sessions just recorded; the table styles (banded timeline, terminal log, events by session, compact rows) are configured in the ⚙ (event types, relative time or clock time, session shown or hidden) and show the most recent events that fit in the widget. In the terminal log a line that is too long ends with “…” and the session stays in a column on the right; the whole text is in the tooltip. The log is white with the light theme and black with the dark one |
| Prompts (`runs`) | both | 12×8 / 6×5 | table of the period's prompts, paged (as many rows as fit in the widget, at most 10 per page): time, session, models, outcome (icon and label, with the reason of an interruption seen live: “interrupted · by you”, “· superseded”, “· for inactivity”), duration, steps, tools (errors as a badge), token composition, total, cache, tok/s (median of the steps, with the first token in the tooltip). A click on a row opens below the session detail with that prompt highlighted. With “heaviest” order, until the widget is tall enough for a full page of 10, it shows the first ones that fit (up to 10), one row each: a taller widget never shows fewer rows. When resizing a paged widget the row you had reached stays visible. Settings: period, order |
| Prompts: distribution (`run-stats`) | Analysis | 6×7 / 4×4 | histogram of tokens per prompt in bands (<10k, 10–30k, 30–100k, 100–300k, 300k–1M, 1–3M, >3M) with the median mark; median, p95 and average duration; among the outcomes the interrupted ones by reason, when known; twin table. Settings: period |
| Trend (`trend`) | Analysis | 12×7 / 4×5 | tokens, cost or steps over time, **as columns or as a line**, by model, agent, provider, type or total. Beyond the usual first six entries the rest is summed into “other models” (“other agents”, “other providers”…). Settings: period, metric, grouping, style |
| Interaction (`interaction`) | Analysis | 5×11 / 4×3 | prompts, permissions (per action, with the wait), commits and subagents. Settings: period |
| Summary (`summary`) | Analysis | 12×3 / 4×3 | tokens, cost, steps, cache, latency and tools of the period, with one of the styles, drawn like the Indicators (caption at the top, big figure, a small bar per figure: the token types, the internal tasks' share of the cost, successful and failed steps and retries, the cache, the median latency up to p95, tool errors): C22 figures in a row, C23 big tokens with the composition and the other five figures beside, B13 tiles with rings (success shares colored with the reliability strip's thresholds; latency as a p50–p95 whisker). Settings: period, style |
| Last year (`calendar`) | Analysis | 6×4 / 4×4 | daily calendar of 53 weeks; on a narrow width it drops the oldest weeks and says so. Settings: metric |
| Table by dimension (`breakdown`) | Analysis | 12×11 / 4×4 | tokens, cost, cache, latency, first token (median) and tok/s (median over the stream) per model, agent, provider, type or folder; “–” where streaming times are missing (OpenCode steps from before mid-October 2026) |
| Tools (`tools`) | Analysis | 7×11 / 4×4 | calls, errors and duration per tool |
| Sessions (`sessions`) | Analysis | 12×13 / 6×6 | sessions of the period, paged (as many as fit in the widget, at most 10 per page), with the steps and tools timeline; in the detail the tooltip of a step's duration gives first token, tok/s and tool wait after the stream, and internal tasks are grouped by type and model (title, automatic or manual compaction with the model, other), with the number of calls when there is more than one (“title ×3 1.2k”) |
| Gauge (`gauge`) | Analysis | 3×5 / 2×4 | a value against a maximum (see below) |
| Indicator (`kpi`) | Now, Monitor | 3×4 / 3×3 | a number of today with the comparison, chosen with the “Indicator” setting: **tokens**, **cache**, **prompts**, **cost**, **tool errors**, **first token** (the median of today's steps) or **retries** (today's repeated attempts, and in the caption how many due to rate limit: a 429 or “rate limit” in the error). Tokens, cost, prompts and retries grow during the day and are compared **at the same hour**: tokens with the average of the previous 7 days up to this hour, cost, prompts and retries with the average of the previous days reduced to the part of a typical day already elapsed (that of the tokens); without previous days with data, no comparison. Retries are recorded only live: days when the lens was off have zero. Cache, first token and tool errors are compared with the average of the previous days. In C20 the normal band (p25–p75) is of the previous days, without today's partial, and today is judged against the same band at this hour; beside it, the last days in small |
| Budget (`budget`) | Now, Monitor | 3×4 / 3×4 | the budget of the day, week or month (“Budget period”) of tokens, steps or cost (“Metric”, tokens if missing): how much is left, the projection and when it resets. Figures and title follow the metric (“Day steps budget”, “≤ 15 steps/h”, amounts in dollars). Without a budget it invites you to set it in Settings. The burn-up trend (C1) exists only for week and month: without a period, or with “day”, it is the month |
| Where the tokens go (`flow`) | Now, Monitor | 6×6 / 4×5 | the period's tokens by model and by type (input, output, cache read and write, reasoning). Settings: period |
| Status (`status`) | Now, Monitor | 3×4 / 3×4 | connection with OpenCode, synchronization, API drift (only if there is one) and models over the day's budget. “Availability strip” shows per day only “Tools without errors” and “Successful prompts”: the connection with OpenCode and the API contract per day are not recorded yet, and the strip does not pretend to have them |
| Speed (`speed`) | Analysis | 6×5 / 3×4 | the first token over time (band between median and p95), by model or as a speedometer of tokens per second. Settings: period |
| When you work (`rhythm`) | Analysis | 5×4 / 4×4 | tokens by hour of the day and day of the week (heat map with squares of at most 12 px, with totals per hour above and per day on the right, the legend always visible and, where there is room, peak hour and day, weekly average and active hours) over the last 4 weeks, in local time; the clock shows the average per hour |
| Sessions of the day (`day-sessions`) | Analysis | 6×6 / 4×5 | today's sessions on a timeline with lanes, with their prompts. The step marks inside a prompt's bar are drawn only where the lens has the step's instant: no invented marks |
| Module widgets (`<id>-<name>`) | Now and/or Analysis, as the module says; never in Monitor | the module's | the widgets an active module declares in its manifest; they appear in “Add” after the core's, with the “{name} module” badge, and have the settings (title, period…) the module lists. With the module off they stay in the layout and say why they are not drawn. See [A module's widgets](moduli.md#a-modules-widgets) |

The **period** of a widget in Now and in Monitor is “Today” (or “View (today)”, if left on the starting value); the other widgets with a period work as in Analysis.

### Gauge

| What it measures | Value | Color |
|---|---|---|
| Budget of the day, week or month · tokens, cost or steps | used over the corresponding `LENS_LIMIT_*` budget, with the end-of-period projection (tick on the arc) | green, yellow from 80%, red from 100% |
| Daily budget of a model | today's tokens of the model chosen in **Model** over its `LENS_MODEL_LIMITS` budget, with the projection; the automatic title is the model's name | like the budgets |
| Prompts from cache | share of the prompts read from the cache in the period | blue |
| Failed steps | steps finished in error over the period's total | green below 5%, yellow up to 15%, red above |
| Tool calls with an error | calls in error over the period's total | like failed steps |

With a budget, below the value there is also how long until the period resets (“resets in 2 d 9 h”). Without the corresponding budget the gauge shows how much has been used and the link to the Settings page, where you set it. The gauge of a model that is no longer in `LENS_MODEL_LIMITS` says so and points to the ⚙ or to Settings. To keep an eye on several models, add a gauge for each. Week and month budgets follow the calendar (from Monday, from day 1), so the widget's period does not change them.

### Line trend

With the “line” style the curves pass through every point without ever exceeding it, so no peak above the real value and no dip below zero. Each series has an area that fades from its color to transparent. Series are overlaid, not stacked: the scale is the highest value of a single series. As in the columns, “other models” (or “other agents”, “other providers”…) sums the entries beyond the usual first six and “internal tasks” are titles and compactions; “Show table” gives the values. Axes have round ticks without repeated labels and the unit next to the values.

## Styles

Every type with more than one graphic model has the **Style** setting: the model it is drawn with. The numbers are the same, the drawing changes. The name is always the model's (“G1 · Area with gradient”); `classic` (and `columns`/`line` for Trend, `semi` for Gauge) is the previous rendering from before styles. A widget without a style uses the first of the list.

| Type | Styles (the first is the one without a setting) |
|---|---|
| Today (`hero`) | classic · G1 area with gradient · G4 columns with peak |
| Indicator (`kpi`) | B11 figure with daily bars · B12 ring with sparkline · C20 figure with normal band |
| Budget (`budget`) | C19 reset countdown · B1 semicircle with needle · B2 ring with ticks · B5 bullet bars · B10 segmented batteries · C14 double ring used and projection · C16 budget thermometers · C1 month consumption with projection |
| Per model today (`model-day`) | classic · B3 budget rings per model · C15 radial budget arcs · B6 bars per model · C3 small multiples · G9 models treemap |
| Where the tokens go (`flow`) | G12 flow from models to token types · G10 token types donut · C13 waffle · B7 token composition |
| Status (`status`) | C18 status lights · C17 reliability strips |
| Live activity (`feed`) | classic · T1 banded timeline · T4 terminal log · T3 events by session · T2 compact rows with filters |
| Prompts (`runs`) | classic · T5 prompts table · T6 cards with step bar · T7 expandable rows · T8 heat formatting · T9 ranking with bars · T12 grouped by session · T10 Pareto · T11 sparklines per step |
| Trend (`trend`) | columns · line · G2 lines with end labels · C3 small multiples · G3 stacked areas · G4 columns with peak · C4 day-by-day ranking · C5 yesterday against today |
| Speed (`speed`) | C2 p50-p95 band of the first token · B9 first token per model · B4 speed speedometer |
| When you work (`rhythm`) | G5 hour × day heat map · C6 hours clock |
| Last year (`calendar`) | classic · G6 activity calendar |
| Table by dimension (`breakdown`) | classic · C21 models table · B6 bars per model · B7 token composition · B8 change per model · G9 models treemap · G11 models radar · C9 cost waterfall |
| Prompts: distribution (`run-stats`) | classic · G8 tokens-per-prompt histogram · C10 duration box plot · C11 prompts swarm · C12 daily ridges · G7 tokens and duration scatter · C8 prompt funnel |
| Gauge (`gauge`) | semicircle · B1 semicircle with needle · B2 ring with ticks · B10 segmented batteries |
| Summary (`summary`) | C22 figures in a row · C23 tokens with composition · B13 tiles with rings |

“Sessions of the day” has a single model (C7 session lanes) and therefore no style setting.

### Sizes per style

Each style has a **default size** (columns × rows): it is the one “Add” puts the widget in the view with and the one the Gallery shows it with. A type's first style has the type's size (the [Catalog](#catalog) table); changing style on a widget already in the grid does not resize it. The criterion: gauges and rings almost square, lines and columns wide and low, tables tall, figures in a strip.

| Type | Style → columns × rows |
|---|---|
| Today | classic 8×9 · G1 6×6 · G4 6×6 |
| Indicator | B11, B12, C20 3×4 |
| Budget | C19 3×4 · B1, B2 3×5 · B5, B10 4×4 · C14, C16 4×5 · C1 6×5 |
| Per model today | classic 6×5 · B3 6×6 · C15 3×6 · B6 6×5 · C3 6×6 · G9 4×5 |
| Where the tokens go | G12 6×6 · G10, C13 4×5 · B7 6×5 |
| Status | C18 3×4 · C17 6×4 |
| Live activity | classic, T1, T3, T2 6×6 · T4 8×6 |
| Prompts | all 12×8 |
| Trend | columns, line 12×7 (the legend needs room) · G2, G3, G4, C5 6×5 · C3 6×6 · C4 6×7 |
| Speed | C2 6×5 · B9 4×5 · B4 3×5 |
| When you work | G5 5×4 · C6 4×5 |
| Last year | classic, G6 6×4 |
| Sessions of the day | C7 6×6 |
| Table by dimension | classic 12×11 · C21 6×6 · B6, B7, B8, C9 6×5 · G9, G11 4×5 |
| Prompts: distribution | classic 6×7 · G8, C10, C12 6×5 · C11 6×4 · G7 6×6 · C8 4×4 |
| Gauge | semicircle 3×5 · B1, B2 3×5 · B10 4×4 |
| Summary | C22 12×3 · C23 12×4 · B13 6×5 |

The sizes are designed for a 1710×1112 point screen (MacBook full screen: grid 1430 px wide, about 18 visible rows). Rings and semicircles fit in 3 columns, bars and thermometers in 4, lines and columns in 6 or 12 and 5 rows.

**Where to change it.** In edit mode each card has in its header the **Style** menu (the model's name and id). Changing it redraws the card right away with the data already read; “Save” keeps it, “Cancel” brings it back. The settings of that style (columns, rows, filters) are in the ⚙. Outside edit mode the header shows the style id only if the Gallery's **Show model ids** switch is on.

**How they are drawn.** Each model is drawn at the card's real size: texts and strokes stay the same size in Now, in Analysis and in the Gallery, and the extra space goes to the data (more columns, labels, rows). Below a certain width some models switch to a reduced form (without legend or without end labels), others only scale. Each chart has a tooltip and an `aria-label` with the main numbers. Where the data is missing the style shows the empty state with the reason, never an estimated number.

**Comparisons.** In “C21 models table” and “B8 change per model” the comparison is with **the period before**, of equal length: in a 7-day period it is the previous week, in a 30-day one the 30 days before. That is why the label says “compared to the period before” and not “7 days before”.

**Samples.** C7, C10, C11, C12 and G7 draw individual prompts, and the server sends at most 1000, the most recent. When the period has more the chart says so at the top right and in the `aria-label` (“latest 1000 of 4321 prompts”): the distribution is that of the latest 1000, not of the whole period. For the whole period there are G8 and C8, which read the summary. C7 starts anyway from the start of the budget day, so the hours of prompts not arrived stay empty but visible. C11 draws at most 150 points and C12 as many days as fit in the card: what stays out is told by “+N not shown” and “latest N days”.

### Default layouts

A new installation starts from these (heights are in 40 px rows). Layouts already saved do not change: their widgets without `style` use the type's first style, the previous one.

Every row is full (12 columns) and the cards of a row have the same height.

- **Now**: at the top four 3-column tiles (token indicator B11, cache indicator B12, day budget C19, Status C18); then Today (G1) and Per model today (B3); then Running prompts, Live activity (T1) and Where the tokens go (G12); at the bottom today's prompts (T5).
- **Analysis**: Summary (C22, figures in a row); Trend (G2) and “Hour by hour per model” (Trend with C3); When you work (G5) and “Share per model” (B6); Sessions of the day (C7) and the table by model (C21); at the bottom “The heaviest” (Prompts with T9, sorted by tokens, one row per prompt with aligned columns: all ten fit).
- **Monitor**: exactly 18 rows, one screen without scrolling. Token indicator (B11, 6 columns), day budget (C19) and Status (C18); Per model today (C15, narrow and tall) and Today (G1, 9 columns); Live activity as a terminal log (T4, 8 columns) and Where the tokens go (G12). If your saved layout does not have the Monitor view yet, it receives this one.

Default configuration of the tables: Live activity with all event types, relative time and session shown; Recent prompts with the columns time, session, model, outcome, duration, first token, composition, tokens and cache, comfortable rows, all prompts; “The heaviest” with the columns project, model, outcome, duration, tokens and period share.

## The pages

### Prompts and Sessions

The prompts widget and the sessions widget full page, with Analysis's filters (period, grouping, metric) in the title bar. They are not customizable. A click on a Prompts row opens below the session detail with that prompt highlighted, as in the widget.

### Gallery

`#galleria`, with **a tab per view**: Now, Analysis and Monitor (`#galleria/adesso`, `#galleria/analisi`, `#galleria/monitor`), each with the number of its styles; the lens remembers the last one opened. A tab shows only the types its view hosts: Now those of the day, Analysis those of the period, Monitor the types of Now made for a screen of big figures (no tables); a widget like Budget is therefore in both Now and Monitor. In every tab there is a card for every style of every type (all the models of [Styles](#styles)), **at the style's default size** on the same 12-column grid as the views (below 1280 px of window, cards of at least 340 px), drawn **with real data**: the budget day in Now and Monitor, the current filters in Analysis; at the top the page says which.

Under the title, always in view while you scroll, are the tabs, the **search** by id, name or type (“G3”, “ring”), the **Only not in use** switch and the **index of types**: a click takes you to the group. Each card shows the id, the name, the size in columns × rows, **where it is already in use** (“In use: Now, Monitor”), according to the layout you are looking at, unsaved changes included, and the state only when there is something to say (loading, the reason why it is empty, data unavailable).

**Add to the view.** Each card has the «Add to {view}» button (in the Monitor tab: “Add to Monitor”): it puts in the tab's view that widget with the style and settings you see and its default size, in the corner chosen in the catalogue's «Where» (with “Pick on the grid”, bottom left: the grid is not visible from here). It is the same editing session as Customize: the row **“Editing in progress · n added from here”** appears with **Save** and **Cancel**, nothing is written to disk before Save, and the cards update “In use” at once. If the view is full (60 widgets, or no free row at the bottom) the bar says so and nothing changes. The buttons exist only with a window at least 700 px wide and editable settings, like Customize; otherwise the page says so at the top.

**Compare.** Each card has a “Compare” box: you pick from 2 to 4 styles of the same type (a card of another type restarts the pick) and the row **“Comparison: n styles of {type}”** offers “Compare” and “Clear”. The comparison shows only those styles, in the order picked, **all at the same size** (the widest and tallest of their default sizes) and with real data; search, filter and index are off and “Leave the comparison” goes back to the tab. From a card of the comparison you can add the winner at once, always at its style's default size. Changing tab clears the pick.

To change or remove a widget already in a view you still use Customize (**Style** menu). The **Show model ids** switch adds the style id next to the title of every card even outside edit mode; it is a preference of this browser (`localStorage`, key `lens:show-style-ids`), starts off and does not enter the service's settings. It is useful during a review, to say “change G2 to G3”.

### Skill

`#skill`: the library of your skills, in the Agent Skills format (a folder with a `SKILL.md`, that is a frontmatter with `name` and `description` followed by the instructions, and if needed `references/`, `scripts/`, `assets/`), and the presets that group them to hand them to OpenCode models through the MCP (see [configurazione.md](configurazione.md#prompts)). It is a board: on top a hero with the state of the library and its usage, below the “Library” column and one column per preset. It is the page of the **Skill** module (see [moduli.md](moduli.md#skill)), off by default: turn it on from Settings › Modules. While it is off there is no menu entry, no page and no `/api/skill*` routes (they answer 404); usage counts keep being collected and when you turn the module back on the page shows them.

- **Import…** (the button at the top opens a panel with “Choose files…”, “Choose a folder…” and the three modes; files can also be dragged onto the whole page, and a “Drop to import” veil appears, which a skill dragged from the board does not trigger): choose or drag a `.zip`, a `.skill` (it is a zip) or a `SKILL.md`, up to 16 MiB; or **a folder** (“Choose a folder…”, or drag it) or **several files and folders together**. The browser groups the files: every folder that directly contains a `SKILL.md` is one skill (with all the files under it, except those of a nested skill folder), it packs it into a zip and uploads it with one request per skill, one after the other, on the same route as ever; zips, `.skill` files and `SKILL.md` files chosen or dropped together are uploaded as they are. `.DS_Store`, `__MACOSX`, `.git` and `._*` files are ignored, and so are files outside a folder with a `SKILL.md`; a folder over 16 MiB is refused before uploading, with the reason. With several skills the message gives a summary (“2 imported, 1 already up to date, 1 rejected”) and a list appears below: one line per skill with its outcome, which can be imported (`vN`), “already up to date, no new version” or rejected with the reason. The zip must have `SKILL.md` at its root or in its only folder. It is checked (safe names, no symlinks, a `.git` folder inside the zip is ignored like `__MACOSX`, at most 2000 files and 64 MiB unpacked, `SKILL.md` up to 1 MiB and valid UTF-8) and copied into the library, never run. The skill's id is the frontmatter `name` when it follows the Agent Skills rule (lowercase, digits and hyphens, up to 64 characters). If the `name` is a label such as "Code Reviewer", the id comes from the zip's root folder or the file name, otherwise from the `name` turned into a slug (`code-reviewer`), as OpenCode does; the `name` stays as the label. Without `name` it is derived from the folder or the file (a file called just `SKILL.md` is not enough: it needs the `name`). Without a `description` the skill is refused: without it, the model does not know when to use it; over 1024 characters it is refused too (the Agent Skills limit). Below the upload area, “If the skill already exists” has three choices, each with its own line of explanation: **New version** (the starting choice: the previous version stays), **Overwrite the current one** (replaces the folder of the version in use, without creating one and without history: it asks for a confirmation) and **Skip if it already exists** (if the id is already there nothing is imported, and it says so without treating it as an error). Uploading the same files again does not create an extra version: the content is compared with the version in use (a hash of the files, their bytes and their permissions) and, if it is identical, the skill is reported as “already up to date” (also with “Overwrite the current one”). The same paths and bytes with only different permissions are “already up to date” too: a browser cannot read the permissions of a folder and guesses them, so the same skill uploaded from the Finder and from a folder does not make a version, and the one in use keeps its own. After every upload the choice goes back to “New version”. A `SKILL.md` uploaded alone, on a skill that exists, brings along the other files of the version in use: you update the text without uploading the zip again. At most 100 skills and 20 versions per skill: to add more you have to remove some. Each version carries in the index the hash of its content and the length in characters of the `SKILL.md` text (without the frontmatter), which the preset weight uses. At startup the lens adopts the valid version folders that the index does not know (reading their `SKILL.md`), so a damaged index does not hide skills; it never follows symbolic links, and an index it cannot read is not rewritten, a copy is kept. If `skills.json` exists but cannot be read (it is not JSON, or not a skills index) and there is no way to rebuild it from the folders, the page does not show an empty library with the import instructions: it shows the reason (“The skills index (skills.json) cannot be read…”), `GET /api/skills` carries `reason` and `unusable: true` with `canSave: false`, and imports and actions on skills answer 409 with that same reason until you repair or move the file.
- **Top bar and hero**: title, a context line (“Last 30 days · 23 Sep – 23 Oct · counts since 12 Oct”, the last part only if collection started inside the period), the period selector **7 d · 30 d · 90 d · All** (30 d by default, remembered by the browser; hidden until there is at least one load), **+ New preset** and **Import…**. The period applies only to the usage numbers: the state of the library (how many skills, weights, without a preset, missing) is always the current one. The hero has six tiles: **Library** (n / 100, new and updated in the period, imports per week), **Loads** (with ▲▼ against the previous period, “from presets” and “direct”, bars per day), **Skills in use** (used and never used), **Without a preset** (the skills OpenCode does not see: library skills reach OpenCode only inside a preset), **Presets** (n / 30, the most used, those never asked for, missing skills) and **Text limit** (the fullest preset against 40,000 characters). With zero skills there is no hero and the board becomes the import zone.
- **Board**: the dashed **Library** column has a filter (Without a preset, All, Never used, Recently updated), the order (Most used, Last import, Name, Heaviest), the search and the counter “n of 100 skills”; each card shows name and presets, description, loads in the period, last use (“never”, or “—” if collection does not cover the period) and weight, with “new” and “updated” badges (a fixed 30-day window). One column per preset, in the presets' order: name, status (missing, over the limit, almost full, never asked for), `/lens:<id>` to copy, **Edit**, the loads (from the command and from the model), the weight meter and the skills' mini-cards, with “cut” or “missing” written out. **Drag and drop**: library → preset adds, preset → preset moves (⌥ copies), preset → library removes, inside the column reorders (the order decides which skills arrive cut). Every move is saved immediately, with a notice and **Undo** for 6 seconds. From the keyboard and on a phone there is the “Add to… / Move to… / Remove from…” menu on every card, with up/down buttons for the order. Saving sends `rev`: if another tab changed the presets in the meantime the lens answers `409`, the page rereads and redoes the move on the current document only if it still makes sense. Below 900 px the columns stack.
- **Detail of a skill** (side panel; Esc closes it and focus returns to the card): status and full description; **Usage** (loads in the period, bars per day, channels, presets, last use, first 3 project folders, errors); **In presets**, with the checkboxes and the share of the limit; **Versions** (loads per version, Detail, **Use this version**, **Delete version**); the text (characters, files, `SKILL.md`, **Copy path**, declared version); **Delete** last, with a confirmation naming the presets that use it and the last use. The page counts and shows only the library's skills: loads of native skills are in `/metrics` but not here.
- **Presets**: each column has a name, `/lens:<id>` command, brief and its skills, and the buttons **Copy /lens:<id>** and **Edit** (opens the dialog already on that preset); a line explains that in OpenCode the command updates within about 30 seconds and the list in the model's instructions at the next OpenCode restart. A skill that is no longer in the library is marked “<id> · missing”, in red; a preset with no skills says so. The dialog, opened from **Edit** or **+ New preset**, is used to create a preset (name, id proposed from the name but editable, brief, skills to tick), edit it (with “Remove from preset” for missing skills; the id cannot be changed), duplicate it (id “…-copia”) and delete it; each row says how many skills it has and how many are missing, and a form error appears under the field. Saving a preset with no skills is allowed, but it warns that it will bring no instructions in OpenCode. With no presets the board offers to create the first one. The usage count is tied to the preset id (see [Skill usage](metriche.md#skill-usage)). At most 30 presets; name from 1 to 40 characters and different from the others; id of lowercase letters, digits and hyphens, up to 40 characters (it is what the MCP offers as `/lens:<id>`); brief up to 500 characters; up to 30 skills per preset.
  **Order and weight.** The order of a preset's skills is the one you choose: ticking a skill puts it at the end, and under “Order” each skill has **Up** and **Down** buttons (the accessible name says which skill it moves); it is saved as it is, and presets already saved keep their order. The model receives the skills in this order, up to the cap of 40,000 characters per answer. The preset's **weight**, in the dialog and on every card, is the `SKILL.md` text of each skill plus what the MCP puts around it (description, base folder, up to ten file paths, the tags, and the preset's header): “12,000 of 40,000 characters · estimate”, with a bar. It is an estimate, because the file paths are worked out from their number. Like the MCP, the page goes through the skills in order: a skill that does not fit under the cap arrives without its text, but a smaller one after it may still fit. The skills that by this count would probably arrive **without their text** (only folder and files, to be read with `read`) are marked “· without its text” with the explanation: change the order or remove some. A missing skill weighs one short line and is never cut; a version imported before the index knew the measure is marked “weight unknown”. Deleting a preset warns that the `/lens:<id>` command will no longer be offered.

From another computer (not localhost) or behind a proxy the page is read-only: you see the library, details, versions and presets, but dragging, the cards' menu, upload, going back to a version and deletions are off and a line at the top of the page says why. The same without a data folder (`LENS_DB=:memory:`).

### What's new

`#novita`, from the data of `/api/changelog` and `/api/about`:

- At the top a **“since the last visit”** strip: the new versions and entries by type (Added, Fixed, Changed, Performance, Documentation), counted against the last version you marked as read. **Mark as read** saves the installed version in the browser (`lens:seenVersion`) and turns off the dot next to “What's new” in the bar: **opening the page is not enough**, the dot stays until you press the button.
- The **versions timeline**: for each, number, type (patch, minor or major, compared to the previous one), date, “installed” and “new for you”, and the counts per section. The first two are open, the others open with a click. Every entry has the link to the commit (the short hash).
- Above, the **filters by type** and a **search** that highlights the text found.
- The entries are in the language chosen in Settings (`CHANGELOG.en.md` and `CHANGELOG.fr.md`, translated by hand at every release). A version not translated yet shows the entries in Italian, with the label “not translated yet”.
- On the side: the installed version (lens, OpenCode, Node, startup, automatic update), the **release rhythm** (columns stacked by type of the last 12 versions) and the links to CHANGELOG, release and SemVer.

### Vibe Coding

This is the Vibe Coding module: it exists only when it is on (Settings › Modules, see [moduli.md](moduli.md)); off, it has no menu entry, `#vibecoding` does not exist and `/api/vibe-coding`, `/api/vibe-coding/history` and `/api/vibe-projects` answer 404. After an upgrade that finds it off but with projects already saved, a notice in every page offers to turn it back on.

`#vibecoding`: how much time and how many tokens you spent, and where, with your **projects** (groups of working folders) and the month-end forecast. It reads `/api/vibe-coding`, `/api/vibe-coding/history` and `/api/vibe-projects`. It has a period of its own (7 days, 30 days, **Month** or All, remembered by the browser), independent of the Analisi filters; it is not a widget and cannot be moved. «Month» is the current calendar month, from midnight of the 1st, like the monthly budget of Adesso. Vibe Coding is OpenCode only: the Bob source chosen in the title bar does not touch it, not even the start of “All”.

- **Estimated and spent cost**: every cost has two figures. The **estimate** is the main one: tokens × the **Price list** (Settings, see [configurazione.md](configurazione.md#price-list)), the same for every project however you pay (subscriptions and local models included), so it measures the effort. The **spent** cost is the one OpenCode writes, smaller beside it. Both count only steps, without internal tasks. With an empty price list the page stays on spent, labels it «spent» and a notice leads to Settings. With a partial price list the tokens of models without a price do not become $0: every figure that contains them says «**incomplete estimate** · N tokens without a price».
- **Project kinds**: you choose the kind in the detail. **Ongoing** (the default, and the kind of every project already saved): **monthly** budget, for activities that do not end (for example AppSec or everyday work). **Deadline**: a **start** (empty = the day of the first step in its folders), a **delivery** date and a **total** budget, for work with an end. Changing the kind resets the budget and the page says so, because the same number would change meaning.
- **Overview**: above the board, the table of all projects: kind (due … / ongoing / closed …), hours, estimate, spent, forecast (at delivery or at month end), budget and status. Month totals add up **all** projects; the month budget only the **ongoing** ones. For deadline projects the figures count from the start, for ongoing ones from the current month, and the table says so.
- **Summary strip**: six tiles on a dark band: cost (hidden when «Show costs» is off), tokens (the breakdown by type is in the chart), **working time**, sessions, **pace** (per day: the mean of the last 7 complete days; the chart shows 14) and **month end**. Each tile has a context line and a small chart; cost, tokens and working time also carry the change from the previous period. The «Month end» tile has a ring: if you set `LENS_LIMIT_COST_MONTHLY` it uses the numbers of the monthly budget of Adesso; otherwise it compares the projects that have a budget with the sum of their budgets; with no budget at all there is no ring and the forecast and its uncertainty remain. Without costs the pace and the month end are in tokens and there is no ring. The cost tile shows the estimate with the spent cost in its note; pace and month end follow the estimate. The exception is «Month end» when `LENS_LIMIT_COST_MONTHLY` is set: that budget is on OpenCode's cost, so figure and ring stay on **spent** and the tile says so.
- **Projects** (the board): one column per project and a **No project** column with the folders that are not assigned. Each column shows the period's cost, tokens and time, the month-end forecast and, if there is a budget, the spent → forecast → budget bar with its status. Folders are cards (name, whole path, token trend, tokens, time, cost and sessions): **drag** them from one column to another, or use **Move to…** on each card, which also works from the keyboard (arrows, Home, End, Enter, Esc). A folder belongs to a project by **exact path**: a subfolder does not follow the folder above it. **+ New project** creates one (with a free color); the name is changed in place (Enter or leaving the field saves, Esc cancels). At most 50 projects, 500 folders in all and names of 60 characters. Clicking a project's numbers opens its detail. For a deadline project the forecast is the one at delivery and the status compares it with the total budget; the column's numbers stay those of the period, while the bar follows the project's life and carries its own figure below it, «since the start: …».
- **Project detail**: name, kind, dates and budget can be edited (empty field = no budget), «Delete project» with confirmation (the folders go back to «No project»; OpenCode's data is not touched). Figures and charts follow the **life of the project**, not the chosen period; the board and the shares by folder and by model follow the period and say so in the label. The project's **folders** have their share (you can drop a folder from the board onto it) and the **models** have estimate and spent, with «no price» for those outside the price list.
- **Ongoing project**: this month (the estimate, with spent beside it, and the hours), the **month end** with the band and the monthly budget, the monthly average of the **last 12 months** and the weekly average, the **trend** (the last 3 complete months against the 3 before; with fewer than 6 months of data the figure is «–» with «less than 6 months of data»; with unpriced tokens in those six months it carries «incomplete estimate») and the cost per hour. The last-12-months chart has the estimate as columns with the spent cost inside, the current month with the forecast dashed, the hours and the monthly budget line.
- **Deadline project**: estimate (with spent), working hours, **at delivery** (forecast estimate with the band, forecast hours), two **budget and time** bars (how much of the budget is used and how many days have passed from start to delivery), cost per hour and, with a budget, the **margin at delivery** («Budget runs out on …» when the forecast goes over it). The **cumulative estimated cost** chart runs from start to delivery: what is done solid, the forecast dashed with the band, the budget line, today and the delivery, and the spent cost as a grey line. The **hours per week** show future weeks dashed. The **actuals and forecast** table has estimate, spent, hours and tokens as of today, at delivery, in the budget and as variance. Before the start the project says «starts …» and shows zero. If a start after the delivery cannot be saved, the dates go back to what they were and a line beside them says why.
- **After delivery**: the project **closes the day after the delivery** and shows the final figures from start to delivery and the variance from the budget. Work in its folders after the delivery is not part of the final figures: it appears in a note («after delivery»). If the delivery slips, move the date. If retention has already cut the first data, the totals are partial and the page writes «data from …».
- **Forecast**: it is an estimate, not a promise. It looks at the **14 complete days before today** and computes one average for weekdays and one for weekends. To the days that remain, **today included**, it applies the average of that kind of day; today counts as the higher of what you have already done and the average. The **uncertainty** is the standard deviation of the 14 days multiplied by the square root of the days left (today included): it is the «± …» band. With fewer than **3 active days** in the window there is no forecast and the page writes «not enough data», without inventing a number. For a deadline project the window runs from start to delivery: before the start and after the delivery there is no forecast.
- **Budget and statuses**: the status compares the forecast with the project's budget: «budget exceeded» if the forecast is above it, «close to the limit» above 85%, «within budget» otherwise. A project without a budget has no status. On projects the budget is only a reference: the lens blocks nothing. For a deadline project the comparison is between the forecast at delivery and the total budget. Budgets are on the estimate (on spent with an empty price list); a project with unpriced tokens carries the «incomplete estimate» note.
- **Tables at the bottom**: by model, by day (budget day, following `LENS_RESET_HOUR`) and the period's heaviest sessions. They show 5 rows, with «Show all» to see them in full and «Show less» to fold them back.
- **Hidden costs**: with «Show costs» off no amount appears (cost tile, budgets, statuses and bars in dollars, or in the cost currency): tokens, time and pace remain, and forecasts are in tokens and time. The estimate disappears too, with the count of unpriced tokens.
- **Working time** is an estimate, not a stopwatch: for each session with its subagents (at any depth), the time covered by its steps (from start to end, at most 30 minutes each) and its prompts is taken, and the gaps under 30 minutes are bridged; a pause of 30 minutes or more does not count. A subagent running in parallel adds no time, and sessions left open do not inflate the total. The time of each folder and each session is its share of the same timeline, so the sum matches the total. With a limited period only the part inside the period is counted.
- **Where the projects are saved**: in `vibe-projects.json`, in the database folder. They are your own configuration (names, colors, kind, dates, budgets and folder paths), never prompts or answers. If the file cannot be read, the page starts with no projects and the lens keeps a copy in `vibe-projects.bad.json` (made only once), so the next save does not destroy its content. With `LENS_DB=:memory:` there is nowhere to save them.
- **Read-only from the network**: from your computer (localhost) you can create, rename, move and delete; from another computer or behind a proxy the page shows everything but changes nothing, and a line at the top says so. The only write is `POST /api/vibe-projects`, loopback only.
- It is read again every minute while the page is open. The projects' history (`/api/vibe-coding/history`: each project's calendar days, up to 24 months) is read when the page opens, when the day changes, after a change to the projects and after a change to the **price list** (even a single price: saving it restarts the lens), not every minute; the days before today come from it, **today** from the month data, read again every minute like the rest. If the read fails, a line above the board says the figures of deadline projects may be partial and it is tried again a minute later.

### System

This is the System module: it exists only when it is on (Settings › Modules, see [moduli.md](moduli.md)); off, it has no menu entry and `#sistema` does not exist.

`#sistema`, read-only: the computer the lens runs on and the services around it, read live while the page is open and never saved in the database, in `/metrics` or in the OTLP export. CPU and memory are read every 2 seconds from `/api/system/live`, everything else every 5 seconds from `/api/system`. Under the title the computer's name, operating system, processor and how long it has been on; on the right the time of the last update and the search.

- **What to look at**: one sentence at the top with what is wrong, the worst problem first and in bold («Disk at 95%, 21.1 GB free: it is the database's volume, when it fills up the lens stops recording»), then the others (battery not plugged in, memory under pressure with the swap, CPU, synchronisation, OpenCode). When all is well it says «All normal».
- **From the source to the database**: the chain the lens keeps up, OpenCode → Lens → Database. For each one its state with a dot (connected, working, disk almost full) and three lines: OpenCode's version, address and PID; the lens's last synchronisation, event loop delay, PID and Node; the size of the database and of its WAL, the records stored and the free space on the volume.
- **CPU** and **Memory**, live: the Gallery's «Gradient area» over the last 4 minutes, one sample every 2 seconds, with a dot on the last value and the window's average dashed. At the top the value now; below it, for the CPU the 4-minute average and the busiest core, for the memory the share in use and the pressure. The memory in use is Activity Monitor's (app memory + wired + compressed).
- **Disk and battery**: they change slowly, so one segmented row each (the Gallery's «Segmented batteries») for disk, swap and battery: green, amber from 70 % and every segment red when the resource is in trouble (disk from 90 %, battery under 10 % and not plugged in). The disk is the database's volume. At the bottom the network speed in and out of the physical interfaces (`en*`, macOS). Without a battery its row is not there.
- **Memory breakdown**, **Lens** and **OpenCode**: the memory split into wired, compressed, active (three shades of blue: what is taken), cached and free (greys: what macOS can give back), with the swap (macOS); the lens (CPU, memory, heap, sync interval, the `local.opencode-lens` LaunchAgent, also when it belongs to another instance, last error) and the OpenCode service it watches (state, version, address, PID, how long it has been running, CPU and memory). A figure OpenCode does not give is a dash.
- **Processes**, **Listening** and **Launch agents**: one card with a tab each and their count, 8 rows and «Show all».
  - *Processes*: the 15 heaviest, sortable by CPU or by memory. CPU is a percentage of one core, as in Activity Monitor (a process can exceed 100 %). Only the executable's name is shown, with the path on hover: **never the arguments**, which may contain tokens and passwords.
  - *Listening*: the listening TCP ports and the UDP sockets opened by your user's processes (`lsof`), with the protocol, the address, the process, the PID and whether they are reachable only from this computer or **from the network**; «Only reachable from the network» keeps only these.
  - *Launch agents*: your user's LaunchAgents, without Apple's and the open apps, first those that exited with an error, then the running ones, then the stopped ones.
  - The lens and OpenCode are highlighted.
- **Search** (in the top bar): finds a process by **PID**, by **TCP or UDP port** or by name. A number counts as a PID or as a port; `:4777` only as a port; `tcp 80` and `udp 5353` only for that protocol; `udp` alone shows every UDP socket; text searches the process name. Several terms are separated by a comma (`node, 4777`). With a search the three tabs show all and only the matches (processes even if they are not among the 15 heaviest, with whoever owns a port that was found).

The lens keeps the last 4 minutes of CPU and memory in memory, one sample every 2 seconds, and runs no command to do it: the CPU comes from `os.cpus()`. On macOS it reads the memory with `vm_stat` only while someone watches the page (up to 15 seconds after the last read of `/api/system/live`); before the first read a sample stays without memory rather than using `os.freemem()`, which leaves out the cache.

Processes, ports and agents describe everything running on the computer: they are shown only when the dashboard is opened from this computer. From the network or behind a proxy, even with the token, the page shows only the summary (what to look at, chain, CPU, memory, disk and battery, memory breakdown, lens and OpenCode) and says so. Outside macOS CPU, memory, disk, lens, OpenCode, processes and ports (if `lsof` is there) remain; memory breakdown, swap, battery and network are macOS only.

### Security

`#security`, read-only and only with the Security module on (see [sicurezza.md](sicurezza.md#the-security-module)), from the data of `/api/security` and `/api/security/<guard>`: what OpenCode's **DLP guards** (today Context7 Guard) let through or blocked, why, and whether they work. A new guard shows up by itself as soon as it writes a `<name>.audit.jsonl`: the lens reads its files read-only and never touches them. It has a period of its own (7 days, 30 days or all, remembered by the browser) and is read again every 10 seconds; it is not a widget and does not move.

- One button per guard, with the verdict dot.
- At the top, a dark band with six tiles and their charts: guard status (the checks passed), calls and blocks with the change from the period before, block rate (if the guard also records the allowed ones), most detected category and last block with the last 24 hours.
- **Health** (audit, policy, plugin, last event and the check against the calls Lens saw, each with a note) and the guard's **Policy** (protections on or off and keys in groups), side by side.
- **Events**: calls and blocks over time, then the table, 50 per page, with the “Blocks only” filter; a click on a row opens object, session, findings and, if the guard writes it, the preview. Next to it: events per category, events per tool and blocks by weekday and hour.
- From another computer the page is reduced to outcomes, tools and categories: objects, sessions and policy are visible only from this computer.

How a guard is recognised, the audit fields, the health and the MCP tool `security` are in [sicurezza.md](sicurezza.md).

### IBM Bob

`#bob`, only with the IBM Bob module on (see [configuration](configurazione.md#ibm-bob)): Bob IDE and Bob Shell tasks, with a period of its own (7 days, 30 days or all, remembered by the browser), read again every 30 seconds. Six tiles (Bobcoins and their cost, tokens, tasks and subagents, model calls, tools, running tasks), the month bar against the plan's Bobcoins with the projection, Bobcoins per day, the tables by folder, by model Bob chose, by mode and by tool, and the recent tasks. Numbers only: Bob's titles and prompts never reach the lens.

**OpenCode · + Bob · Bob only**, in the title bar of Now, Analysis and Monitor (only with the IBM Bob module on; the selector is generic, “OpenCode · + {source} · {source} only”, and hides itself if `/api/status` lacks the source), chooses whose numbers are shown: **OpenCode** (the dashboard as it always was), **+ Bob** (Bob added to OpenCode) or **Bob only** (the same widgets with Bob's numbers alone). It applies to the summary, days, hours, tools, breakdowns (by mode as «agent», by folder, by kind, by model, always `bob/auto` since Bob does not record the model it picks), trends, rhythm, calendar, prompts, run statistics, sessions, interaction, running prompts and live activity, the Prompts and Sessions pages included: the server answers with OpenCode's own queries read over Bob, so in the same shape. A Bob task is a session, a subagent a child session, a model call a step of provider `bob`, a user message a prompt, a prompt of a main task with what Bob does up to the next prompt a run. Bob leaves main tasks «active» after the work is done: a task is «running» only if it moved in the last 10 minutes, otherwise it is «open»; its context is measured against Bob's window, 270,000 tokens. **Budgets**: with Bob only they are Bob's plan (`LENS_BOB_COINS_MONTHLY` Bobcoins a month, in dollars, and the share of the day and the week; no per-model budget), with + Bob they stay OpenCode's. Bob's **live activity** arrives at each read of its database (every `LENS_BOB_INTERVAL`), not in real time; with OpenCode it does not show. Errors and Vibe Coding stay OpenCode's only; speed, retries, compactions, permissions and titles stay empty because Bob does not record them (titles the lens does not store). It applies to this browser only, as the `source` preference (the old `bob-source` is no longer read: after the upgrade the selector starts again from “OpenCode”). If the module is turned off while a tab is open on “+ Bob” or “Bob only”, the tab goes back to “OpenCode” and rereads everything. With the «All» period the start is the earliest data of the chosen source.

### Settings

`#impostazioni`. At the top a status box: “Changes are saved in the service”, or, if the lens was started by hand, “Read only” with the reason (the fields are disabled). A side index leads to the sections and counts the unsaved changes of each; on narrow screens it becomes a scrolling row.

| Section | Content |
|---|---|
| General | version, Node, startup, folder; `LENS_SCAN_INTERVAL`, `LENS_STORE_TITLES`, `LENS_LOG_LEVEL`, `LENS_DB`, `LENS_RETENTION_DAYS` (Keep details: see [configurazione.md](configurazione.md#detail-retention)) |
| Budget | `LENS_RESET_HOUR` (local time or UTC); three cards, Day, Week and Month, with tokens, cost and steps and the bar of current consumption; the per-model budgets table (today's consumption with bar and percentage, budget field) |
| Network and security | `LENS_HOST`, `LENS_PORT`, `LENS_TOKEN`, `LENS_ALLOWED_HOSTS`; with a non-local host the warning about the mandatory token appears |
| OpenCode | discovery mode, address, version, API contract state; the `OPENCODE_*` variables |
| Export | `LENS_LABELS` and the `LENS_OTLP_*` variables, with the OTLP state |
| Language and format | **Language** (`LENS_LANG`: Automatic, Italiano, English, Français) and **Format** (`LENS_LOCALE`: Automatic, it-IT, en-US, en-GB, fr-FR) of dates, times and numbers, independent of each other. Automatic follows the browser; saving reloads the page in the new language. See [configurazione.md](configurazione.md#language-and-format) |
| Appearance | **Widget size**: Auto, Small (85%), Normal (100%) or Large (120%), with the size in use. It applies to the grids of Now, Analysis and Monitor, and only to this browser (`lens:size`): menu, Settings and the other pages do not change. Rows, spaces, texts and charts change together and the saved layout stays as it is. Auto, the starting choice, shrinks below 1500 px of window width (down to 75%), leaves everything as is between 1500 and 2200 px and enlarges above (up to 150%: a 4K at 100% scale is at 150%). Below 700 px, where the grid is a single column, nothing changes. It uses the CSS `zoom` property (Chrome, Safari, Firefox from 126) |
| Modules | one card per module found, with name, description and state (off, on, error with the reason) and the *Turn on* or *Turn off* button: it changes `LENS_MODULES`, asks for confirmation and saves at once (the lens restarts), together with any other pending changes (see [moduli.md](moduli.md)). After an upgrade, an off module that already has data gets a notice on every page, which can be dismissed. A module that is on but incomplete is “to configure”, with the reason. A module can have a panel of its own under the fields: for IBM Bob the state of the reading of bob.db, the facts and the probes |
| MCP server | state of the `lens` server read from OpenCode (connected, in error, disabled, waiting, declared but not loaded, not linked, unknown), the registered command with the warning if it is no longer this installation's, the error text hidden or visible; how to connect it (command, `opencode.jsonc` block, prompt for the model) and the example questions for each tool (budget, errors, usage, sessions, security and skill presets), all with “Copy”. Read-only: nothing to save |
| Update | installed version and how the last update went; a lens zip chosen or dragged in, with the preview (new and current version, zip type, CHANGELOG news, warnings) and **Install and restart**, which runs the zip's `install.sh` and waits for the new version. Off, with the reason beside it, if the lens does not run as a service from `~/Applications/opencode-lens`. See [aggiornamento.md](aggiornamento.md#from-the-dashboard) |
| Data and files | size of the database and rows; files written and read; the browser's `lens:*` keys |
| Uninstall | the commands already filled in, with “Copy” |

Fields give the name, the variable in small type, the help and the starting value. Secrets show only “set” or “not set”. Validation is the startup one (`src/config.js`), with the error under the field. The `LENS_LIMIT_*` budget wants an **integer**; **only the per-model budgets table** also accepts `100M`, `500k`, `1.5G`.

A fixed bar at the bottom appears only with unsaved changes: the number, the touched variables, **Discard changes** and **Save and restart**, disabled while there is an error. A single submit (`POST /api/settings`) saves the variables and the per-model budgets together. The variables are explained in [configurazione.md](configurazione.md).

## States and formats

- **Empty**: an invitation, not an excuse (“No prompts today”).
- **Error**: “Data unavailable · retry”, with the message in the tooltip. If a read fails, the widgets that use it show the error above the last drawing, dimmed.
- **Loading**: only at the first drawing. On rereads the widget keeps the previous drawing until the new one arrives: no dimming, skeletons or jumps, neither on the widget nor on the page.
- **Numbers**: compact with `k`, `M`, `G` without a space (`6.7M`, `1k`). Money is `$11.53`, `$0.0042` (four decimals below 0.01), `$0`, and without decimals from 100 up. The examples above and in the rest of the documentation are in the Italian format (it-IT); with another **format** (Settings › Language and format) separators, the symbol position and the order of day and month change.
- **Durations**: `ms`, `s`, `min`, `1 h 20 min`, `2 d 3 h` (in Italian `2 g 3 h`, in French `2 j 3 h`). Dates and times according to the chosen format.

## Live updates

The dashboard updates by itself while OpenCode works. The service sends the page, at most once a second, a notice (the `tick` of `/api/live`) with the kinds of activity of that second: a step started or ended, a tool call, token usage, a permission, a retry. In Now and in the Monitor, which follow the budget day, the page reads again only the data those kinds may have changed and redraws only the widgets that show it: a permission touches the running prompts, not the day budget. Each piece of data is read again at most every so often: running prompts every 5 seconds, the prompt list every 10, budget, summary and breakdowns every 15, sessions every 30, the daily and hourly totals every 60; a postponed update still arrives when it is due, even if OpenCode stops meanwhile. A sync, a session created, renamed or deleted and a kind of activity the page does not know read everything again. In the other views (Analysis, Prompts, Sessions) the periods move with the clock and every notice reads everything again.

Every 60 seconds, when a view opens, on every filter or saved layout the page reads everything anyway. While it reads it does not dim: a widget shows “Loading…” only the first time, and its errors over the last drawing. In a background tab it reads nothing, neither the notices nor the 60 seconds, and when you come back to the tab it reads everything again.

**Pause.** **Pause**, below the state at the bottom of the sidebar, stops the automatic updates: notices, the 60 seconds, “Live activity” and the timers of the running prompts. The state turns grey with no pulse, “Paused · Data frozen at 14:31:07”, and the line under the title of Now and of the Monitor repeats it. The connection with the lens stays open: **Resume** reads everything again at once, “Live activity” included. **Refresh** reads the view again now, also when paused (the time of the frozen data moves); changing view or filter also reads new data. The pause stays in this browser (`localStorage`, key `lens:paused`) across page reloads; it is not a setting of the service.

## If the lens does not answer

If the page can no longer read the data (lens stopped, restart after an update, token changed) the state at the bottom of the sidebar turns red with “Data stalled at …” (“Lens unreachable” if it never read anything) and the banner stays until a read succeeds: the numbers on screen are those of the time indicated. The page retries by itself; when the lens is back it reloads data and “Live activity” without needing to refresh the page. The banner at the top of the page interrupts the screen reader (`role="alert"`) only when the lens or OpenCode cannot be reached; the other notices (OpenCode API changed, sync failed) are a `role="status"`, and a text that does not change is not read again.

## Where it is saved

The layout is in `dashboard-v2.json` (and the presets in `dashboard-presets.json`), in the same folder as the database (`~/Library/Application Support/opencode-lens/` by default, or next to `LENS_DB`). With `LENS_DB=:memory:` it stays in memory until restart. The **Settings** page lists the files written, and the [uninstall](disinstallazione.md) removes them with the rest.

The skills of the [Skill](#skill) page are in the same folder: the library in `skills/` (one folder per skill and per version, `skills/<id>/<n>/`), the index in `skills.json` and the skill presets in `skill-presets.json`. They are your own configuration, never prompts or answers, and they do not end up in the release package. An unreadable index or preset file gives an empty list, a warning in the log and a copy (`skills.bad.json`, `skill-presets.bad.json`, made only once), so the next save does not destroy its content. With `LENS_DB=:memory:` there is no folder to keep the skills in.

The file is readable JSON, version 2: each view has its own grid (`adesso`, `analisi`, `monitor`).

```json
{
  "version": 2,
  "views": {
    "adesso": { "widgets": [
      { "id": "w-kpi-tokens", "type": "kpi", "x": 0, "y": 0, "w": 4, "h": 4,
        "settings": { "style": "B11", "metric": "tokens" } },
      { "id": "w-runs", "type": "runs", "x": 0, "y": 4, "w": 12, "h": 9,
        "settings": { "style": "T5", "sort": "recent", "cols": ["ora", "modello", "token"], "density": "comoda" } }
    ] },
    "analisi": { "widgets": [
      { "id": "w-trend", "type": "trend", "x": 0, "y": 0, "w": 12, "h": 8,
        "settings": { "style": "line", "metric": "cost", "by": "agent", "range": "2592000000" } }
    ] },
    "monitor": { "widgets": [] }
  }
}
```

`x` and `w` are columns (0–11 and 1–12), `y` and `h` rows; `range` is in milliseconds (`0` = all, `day` = today). `style` is one of the ids in [Styles](#styles); `cols` and `kinds` are lists without duplicates of allowed values, in any order. The `id`s are unique across views. The values in the file (`cols`, `density`, `only`…) are the internal Italian ones and are not translated. If the file is not valid JSON or describes an impossible layout (widgets off the grid or overlapping, a setting not allowed), the dashboard uses the default one and the log says why. A widget of a type, or a view, that this version does not know, saved by a newer version, is not drawn: it stays in the file, still in its place, and the other widgets work around it.

### Migrating from a previous version

Versions up to 0.12.x saved a single grid in `dashboard.json`. This version reads it and converts it in memory, without losing widgets; the new file is born at the first “Save”.

- A layout still **equal to the previous default** becomes the new default.
- Otherwise each widget goes to its view, with the same id, title and coordinates: Today, Budget and reset, Budget per model, Live activity and the budget gauges go to **Now** (they become Today, Per model today, Live activity and Gauge); Column chart and Line become **Trend** with the right style, “Runs and interaction” becomes **Interaction**, and the others stay in **Analysis**. “Budget and reset” is absorbed by Today (if the view already has one it disappears) and its metric is lost.
- Width and height are brought to the new type's minimum; the settings the new type does not allow are discarded.
- New widgets do not appear by themselves: only once the catalog flags them in “New widgets available”.
- A v2 layout saved before styles and Monitor stays as it is: its widgets without `style` are drawn as before and the Monitor view, which did not exist, takes the default one.
- The **classic** Summary (six tiles) is gone: a widget saved with that style is read as **C22** (figures in a row), with the same position and size, and one without `style` is now drawn as C22. Save keeps the new choice; for another style use the **Style** menu.
- The **solid ring** Gauge (`ring`) is gone: a widget saved with that style (even from a v1) is read as **B2**, the ring with ticks, with the same source, position and size. The semicircle does not change.
- The **hours clock** of the Today widget (`hero`, C6) is gone: a widget saved with that style is read as **G1** (area with gradient, the same hours of today), with the same position and size. The clock of “When you work” (`rhythm`, C6) does not change.

**`dashboard.json` (v1) is never written by this version.** Going back to an older lens you find your previous layout, intact. If both files exist `dashboard-v2.json` wins.

### Going back to an older lens

A lens released **before styles** refuses a widget with a setting it does not allow (“unknown setting”, “not allowed”): a new style (`style: "G1"`; on Today, Per model today, Live activity, Prompts, Prompts: distribution, Summary, Last year and Table by dimension any `style`, even `"classic"`: it did not exist there), `cols`, `kinds`, `density`, `only`, `time`, `session`. Likewise a lens prior to “Failed steps” refuses `kinds` with `failed` (“not allowed”). It also refuses a **Today** (`hero`) narrower than 6 columns (“smaller than the minimum 6 × 6”), which from this version can go down to 4: it happens if you narrow it, and with every `today` widget of a v1 layout migrated by this version (it becomes a Today 4 wide). A `dashboard-v2.json` with one of these things is discarded **entirely**: it uses `dashboard.json` (v1) if there is one, otherwise the default layout, and writes it to the log. The new types (`kpi`, `budget`, `flow`, `status`, `speed`, `rhythm`, `day-sessions`) and the Monitor view, by themselves, an old lens keeps without drawing them; what makes it discard the file is a setting it does not know, or a Today that is too narrow.

That is why, **at the first save with new styles or settings**, the lens copies the `dashboard-v2.json` that was there into `dashboard-v2.prev.json`, in the same folder. In practice it happens at the first save with this version, whatever changes: the Monitor view it adds already counts as news. This way even a narrowed Today is covered: the copy has the previous one, and a v1 layout stays intact in `dashboard.json`. The copy is made only once and is never overwritten; if the previous file does not exist or is not readable nothing is copied (and the save succeeds anyway). To go back:

1. stop the lens (`opencode-lens service stop`, or quit the process);
2. in the data folder, replace `dashboard-v2.json` with `dashboard-v2.prev.json` (`cp dashboard-v2.prev.json dashboard-v2.json`);
3. install the old version (see [aggiornamento.md](aggiornamento.md)) and restart it.

Without the copy, delete `dashboard-v2.json`: the old lens restarts from `dashboard.json` or from the default layout. The copy appears in `/api/about` and in Settings's uninstall command. Changes made with the new version do not come back into the old one: the copy is the layout as it was before the first save.

API: `GET /api/dashboard` and `POST /api/dashboard`, in [metriche.md](metriche.md#local-api). Restoring from the API (`{ "reset": true }`) deletes only `dashboard-v2.json`: if a v1 `dashboard.json` is still there, it is migrated again. From the page, “Reset” concerns only the visible view.
