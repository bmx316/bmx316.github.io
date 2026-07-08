# Second Brain — build notes (agent memory)

Working notes kept while building. Decisions, verifications, known gaps.

## Decisions

- **Stack:** vanilla ES modules, no build step, no frameworks. Served straight from
  `secondbrain/` by GitHub Pages (root user site → `https://bmx316.github.io/secondbrain/`).
- **State:** single JSON blob in `localStorage` (`secondbrain.v1`), pub/sub re-render.
  Everything (tasks, history, memory, patterns, settings) lives there; secrets never leave
  the browser except to the API they belong to.
- **Themes:** 5 directions documented in `THEMES.md`, implemented via CSS custom properties
  + `light-dark()` with a `data-scheme` override (auto/light/dark). No webfonts — system
  stacks chosen per theme so the app is fully self-contained/offline.
- **Layouts:** focus / list / board / timeline / dashboard, all rendered from the same
  ranked task list with the same actions (complete, snooze, later).
- **AI calls** follow Part B of the master prompt exactly:
  - default `claude-opus-4-8` with `thinking: {type:"adaptive"}`
  - `claude-fable-5` option: **no** `thinking` field, `fallbacks: [{model:"claude-opus-4-8"}]`
    + `anthropic-beta: server-side-fallback-2026-06-01`, refusal check on `stop_reason`
  - `claude-haiku-4-5` option: no `thinking`, and **no `output_config.effort`** — effort
    errors on Haiku 4.5 (deviation from Part B, which didn't cover this; structured output
    format is still sent, which Haiku supports)
  - structured output via `output_config.format` json_schema, `additionalProperties:false`
  - never `temperature`/`top_p`/`top_k`, never assistant prefill
  - cache: byte-stable system prompt + learned-patterns summary with
    `cache_control: {type:"ephemeral"}` on the last system block; volatile task list +
    date go in the user message. Patterns summary only changes when a retro patch is
    accepted → cache invalidates weekly, as intended.
  - errors: 429 respects `retry-after`; ≥500/529 exponential backoff (max 3 tries);
    401 → "check your API key"; 400 → log + heuristic fallback (+ retention hint if fable).
- **Prompt-cache note:** the learned-patterns summary rides in the cached system block and
  is only rebuilt by accepted retro patches. Per-completion history stats go in the user
  message (volatile zone) so day-to-day use never invalidates the cache.
- **Heuristic ranking** (no API key): score by source, age, deferral count, due-soon,
  quick-win, learned category weights (`patterns.weights`, adjusted by retro patches).
  Same plan shape as the AI response so the UI has one code path.
- **Self-improvement loop:**
  - completing a task pops quick actual-time chips (5/15/30/60+/skip) → history log of
    estimated vs actual + what was completed first vs what was ranked first
  - history digest is sent with every prioritization call
  - memory entries (one lesson each, summary + detail) render to markdown and sync to
    `2026 Vault/Second Brain/memory.md` when Drive is connected; localStorage otherwise
  - weekly retro (7+ days since last, ≥3 history events): `effort: "high"` call with own
    schema `{observations[], proposed_changes[{description, patch}]}`; `patch` is a JSON
    string `{"weights": {...}, "summary": "..."}` the app merges on one-tap accept
- **Drive:** Google Identity Services token client (script loaded on demand), raw REST
  (`drive/v3`). Resolves `My Drive/Work MacBook Pro/2026 Vault` by walking folder names.
  Reads last 7 `Daily/*.md`, `Daily_Tasks.md`, `📥 Jira Inbox.md`, `📥 Inbox.md`.
  Completion flips `- [ ]` → `- [x]` on the original line (wikilinks preserved because the
  line is otherwise untouched); quick-adds are appended to `📥 Inbox.md` when connected.
  Scope is `https://www.googleapis.com/auth/drive` (read of pre-existing vault files rules
  out `drive.file`); the settings UI says so plainly.
- **Jira:** adapter interface (`fetchIssues/transitionDone/addComment`) with three
  transports: `demo`, `proxy` (tiny documented Cloudflare Worker), `direct` (will fail
  browser CORS with API tokens — the UI says so honestly and suggests the proxy). Swapping
  transport touches nothing outside `jira.js`.
- **PWA:** manifest + service worker, cache-first app shell, offline add/complete/view
  (all state is local; Drive/Jira writes queue implicitly by being local-first — vault
  write-backs only fire while connected).
- **Demo mode:** seeds sample vault + Jira tasks and swaps in a deterministic mock plan /
  mock retro, so every integration and the whole AI loop is testable with zero credentials.

## Verified (via Playwright against a local static server)

- App boots clean (no console errors), Basic mode default, empty-state visible.
- Quick-add via Enter creates a task; heuristic ranked list renders with reasons.
- Demo mode seeds vault+jira tasks; "Plan" produces briefing, ranked list with reasons,
  one clarifying question, one automation suggestion; accepting the suggestion creates a
  recurring task; answering the question stores the answer on the task.
- Complete flow: actual-time chips appear, history logs estimated vs actual, task moves
  to done; snooze hides until tomorrow; later moves to Later bucket.
- All 5 layouts render and persist across reload; all 5 themes × light/dark apply and
  persist; Basic/Advanced toggle shows/hides advanced chrome.
- Weekly retro (forced in demo) returns proposals; accept merges weights + updates
  patterns summary + memory entry.
- Service worker registers; second load served from cache (offline flag test).
- Real-API paths (Claude, Drive, Jira) are built to spec but exercised only in mock/demo —
  they need real credentials, which I don't have. Marked plainly in README.

## Known gaps / honest notes

- Memory sync conflict policy is last-writer-wins (remote preferred on connect if newer
  than the last local sync). Good enough for one person on two devices, not a CRDT.
- Jira "direct" transport is expected to fail CORS on real Jira Cloud; kept because some
  setups (corp proxy, browser extension) make it work, and it documents reality.
- Vault parsing takes checkbox lines only; indented sub-checkboxes are treated as their
  own tasks. Completed lines are left in place (Obsidian-compatible), never deleted.
- Retro `patch` is trusted after JSON.parse with shape check; malformed patches are shown
  but the accept button is disabled.
