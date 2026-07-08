# Second Brain — Fable 5 Master Prompt

This document contains two prompts, both written against Anthropic's official Claude API documentation (current as of July 2026):

- **Part A** — the master build prompt. Paste it into a Claude Code session running **Claude Fable 5** (`/model claude-fable-5`) to build the tool end-to-end.
- **Part B** — the runtime system prompt and API call shapes the finished app uses for its own AI features. Part A references Part B, so paste the whole document (A + B) together as one message.

---

## Part A — Master Build Prompt

````markdown
# Build "Second Brain" — my daily life operating system

## The goal

Build me a brand-new tool that answers one question exceptionally well, every time I open it:
**"What should I do right now?"**

This is a second brain for my whole life — work, personal, family, projects — not just a work
task list. It must be intelligent, simple to use, clean, and uncluttered. It must also be
**self-improving**: the more I use it, the better it gets at prioritizing my day. That
requirement is as important as any feature below.

Build it from scratch in this repository. Do not reuse, reference, or extend any existing app
code in this repo — this is a standalone product in its own directory (suggest `secondbrain/`).

## Who I am and what I have

- My knowledge base is an Obsidian vault called **2026 Vault**, synced to Google Drive at
  `My Drive/Work MacBook Pro/2026 Vault`. Relevant contents:
  - `Daily/` — daily notes with checkbox tasks
  - `Daily_Tasks.md` — recurring tasks I monitor every day
  - `📥 Jira Inbox.md` — synced Jira items
  - `📥 Inbox.md` — general capture inbox
  - `Projects/`, `People/`, `Personal/`, `Companies/` — context about my life and work
- I use **Jira Cloud** at work (Atlassian).
- I have a Claude API key, and can create a Google OAuth client ID and a Jira API token.
- I want this hosted on my GitHub Pages site (this repo), usable from my phone and my Mac.

## Product requirements

### 1. Today view (the heart of the app)
A single ranked list of what to do today, intelligently ordered by priority — the model
decides what delivers the most impact for the time I have, not a dumb sort. Each item shows
why it's ranked where it is in one short phrase. One-tap complete, snooze, or delegate-to-later.

### 2. Capture
Adding a task must be near-instant: one input box, always visible, Enter to add. If a task is
ambiguous, the AI may ask at most one short clarifying question — never a form.

### 3. Data sources (all optional, app works with none configured)
- **Google Drive → my vault** (OAuth via Google Identity Services, client-side): read tasks
  from `Daily/` notes, `Daily_Tasks.md`, `📥 Jira Inbox.md`, and `📥 Inbox.md`; write
  completions and new tasks back in Obsidian-compatible markdown (`- [ ]` / `- [x]`,
  wikilinks preserved).
- **Jira Cloud REST API v3** (email + API token, stored locally): pull my open issues, show
  them alongside everything else, transition/comment from the app. Known constraint: Jira
  Cloud does not send CORS headers for browser requests with API tokens. Investigate and pick
  the simplest working approach — design the Jira module behind a small adapter so the
  transport (direct fetch, or an optional tiny documented proxy such as a Cloudflare Worker)
  can change without touching the rest of the app. Be honest in the UI about what Jira setup
  requires.
- **Manual** — quick-add always works with zero configuration.

### 4. Intelligence (Claude API, spec in Part B below)
- Prioritize the merged task list (vault + Jira + manual) with reasons.
- Ask follow-up questions when a task is too unclear to prioritize.
- Spot automation opportunities ("you do this every Monday — want me to make it recurring?"
  "this is a Jira status update — I can do it for you") and offer one-tap setup.
- Generate a short morning briefing: today's plan in 3–5 sentences.

### 5. Self-improvement loop — very important
The app must get smarter about *me* over time:
- Log every task's estimated vs. actual completion (and what I actually did first vs. what
  it recommended).
- Feed that history into the prioritization call so the model recalibrates — if I always
  defer a category, it should learn that; if I underestimate certain work, it should correct
  for it.
- Maintain a learnings file in my vault (e.g. `2026 Vault/Second Brain/memory.md` via Drive,
  falling back to localStorage when Drive isn't connected): one lesson per entry with a
  one-line summary, recording corrections and confirmed patterns and why they mattered.
  Update existing notes rather than duplicating; delete notes that turn out to be wrong.
  Never store secrets there.
- Weekly retrospective: once a week, propose concrete improvements to its own prompts and
  weights ("I noticed X — should I start doing Y?") that I can accept or dismiss with one tap.

### 6. UI — five layouts × five themes, never cluttered
- **5 UI variations** I can switch between in settings, each a genuinely different way of
  seeing my day (for example: Focus — one task at a time; Classic ranked list; Board/kanban;
  Timeline/agenda; Dashboard with stats). Same data, same actions in all five.
- **5 color themes**, each designed intentionally (not just hue swaps), with light and dark
  handled properly.
- **Basic / Advanced mode**, like early Gmail: Basic is quick-add plus today's ranked list
  and nothing else — a person who never opens settings gets a complete product. Advanced
  unlocks integrations, analytics, automation, the retrospective, and layout/theme pickers.
  Basic is the default.
- Avoid generic AI-app aesthetics: no overused font stacks, no purple-gradient clichés,
  no cookie-cutter component layouts. Before building the themes, propose 5 distinct visual
  directions (bg hex / accent hex / typeface — one-line rationale each) in a comment or doc,
  then implement them as the 5 themes.

### 7. Platform and constraints
- Static web app / PWA in this repo, served by GitHub Pages: no build step required to
  deploy, or a build step that outputs committed static files — your call, keep it simple.
- Mobile-first responsive; installable (manifest + service worker); core features (view,
  add, complete) work offline, syncing when back online.
- All secrets (Claude key, Jira token, Google tokens) live only in the browser
  (localStorage); the settings UI says so plainly. Nothing is ever sent anywhere except the
  APIs it belongs to.
- No frameworks unless they genuinely earn their weight; fast on a phone.

## Claude API rules (follow Part B exactly)

The app's runtime AI calls follow the spec in Part B of this document — model choice,
request shapes, structured outputs, caching, and refusal handling are specified there from
the official documentation. Do not improvise different API shapes.

## How to work

- You have the full spec above — act on it. When you have enough information to make a
  reasonable product decision, make it and note it; don't stop to ask about naming, styling
  details, or which of two equivalent approaches to take. Ask only for genuine scope
  decisions or things only I can provide (credentials).
- Don't add features, abstractions, or defensive code beyond what this spec requires. Do the
  simplest thing that works well. No half-finished stubs either — if a feature is in, it works.
- Verify as you build: run the app, exercise each flow (add, prioritize with a mocked API
  response, complete, switch all 5 layouts and all 5 themes, toggle Basic/Advanced), and fix
  what you find before reporting. Every integration must be testable without real
  credentials via a mock/demo mode.
- Keep a `secondbrain/NOTES.md` as your own memory while building: decisions made, things
  verified, known gaps. Consult and update it as you go.
- Before reporting progress, audit each claim against something you actually ran. If it
  isn't verified, say so.
- When you finish, lead with the outcome: what works, how I try it in two minutes, what
  needs my credentials to light up. Plain sentences, no shorthand.

## Definition of done

1. App loads from this repo on GitHub Pages and as a local file server; installable as a PWA.
2. Basic mode: I can add tasks and see a ranked today list with zero configuration
   (heuristic ordering without an API key; AI ordering once a key is added).
3. All 5 layouts and all 5 themes work and persist across reloads.
4. Advanced mode: Drive vault sync, Jira, morning briefing, automation suggestions, and the
   self-improvement loop (estimate-vs-actual logging, memory file, weekly retrospective) are
   implemented and demonstrably working in mock/demo mode.
5. A short `secondbrain/README.md` covers setup: Claude key, Google OAuth client, Jira token,
   and what each unlocks.
````

---

## Part B — Runtime AI Spec (the app's own Claude calls)

Everything here comes from Anthropic's official API documentation. The build agent must implement it as written.

### Model policy

| Purpose | Model | Why |
|---|---|---|
| Default for all app calls | `claude-opus-4-8` | Recommended default; $5/$25 per MTok |
| Optional "maximum intelligence" setting | `claude-fable-5` | Most capable model; $10/$50 per MTok; extra rules below |
| Optional "economy" setting | `claude-haiku-4-5` | Cheap/fast for simple triage |

Use exact model IDs — never append date suffixes.

### Request shape (prioritization call)

- Endpoint: `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` (required for browser calls).
- **Thinking:** send `"thinking": {"type": "adaptive"}` on `claude-opus-4-8`. On `claude-fable-5`, **omit the `thinking` field entirely** — thinking is always on, and `{"type": "disabled"}` or `budget_tokens` returns a 400.
- **Effort:** control depth with `"output_config": {"effort": "..."}` — `"medium"` for routine daily triage, `"high"` for the weekly retrospective.
- **Never send** `temperature`, `top_p`, or `top_k` (removed on these models; 400).
- **Never use assistant prefill** (last-assistant-turn prefills return 400). Use structured outputs instead.
- **Structured output:** the prioritization call sets

```json
"output_config": {
  "effort": "medium",
  "format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "properties": {
        "briefing": { "type": "string" },
        "ranked_tasks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "rank": { "type": "integer" },
              "reason": { "type": "string" },
              "estimated_minutes": { "type": "integer" }
            },
            "required": ["id", "rank", "reason", "estimated_minutes"],
            "additionalProperties": false
          }
        },
        "questions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "task_id": { "type": "string" },
              "question": { "type": "string" }
            },
            "required": ["task_id", "question"],
            "additionalProperties": false
          }
        },
        "automation_suggestions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "task_id": { "type": "string" },
              "suggestion": { "type": "string" },
              "setup_action": { "type": "string" }
            },
            "required": ["task_id", "suggestion", "setup_action"],
            "additionalProperties": false
          }
        }
      },
      "required": ["briefing", "ranked_tasks", "questions", "automation_suggestions"],
      "additionalProperties": false
    }
  }
}
```

(`additionalProperties: false` is required on every object; no `minimum`/`maxLength`-style constraints — not supported.)

### Prompt caching

Order the request so the stable part caches: the system prompt (Part B system prompt below + the user's learned patterns summary) goes first with `"cache_control": {"type": "ephemeral"}` on its last block; the volatile task list and today's date go in the user message **after** the breakpoint. Never interpolate timestamps or IDs into the system prompt itself.

### Refusal handling (required when the Fable 5 setting is on)

Check `stop_reason` before reading `content` — a decline is HTTP 200 with `stop_reason: "refusal"`. Opt into server-side fallbacks by default on every `claude-fable-5` call:

```json
{
  "model": "claude-fable-5",
  "max_tokens": 16000,
  "fallbacks": [{ "model": "claude-opus-4-8" }],
  ...
}
```

with header `anthropic-beta: server-side-fallback-2026-06-01`. If the final response still has `stop_reason: "refusal"`, fall back to the app's built-in heuristic ordering and tell the user unobtrusively. Note: `claude-fable-5` requires the org to allow 30-day data retention — if every request 400s, surface that hint in settings.

### Error handling

Branch on status: 429 → respect `retry-after`; ≥500/529 → exponential backoff (max 3 tries); 401 → "check your API key" in settings; 400 → log and fall back to heuristic ordering. Never string-match error messages.

### Runtime system prompt (copy-paste, keep byte-stable for caching)

```text
You are the planning engine inside "Second Brain," a personal daily-planning tool for one
user, Troy. Your one job: given his current tasks — from his Obsidian vault, Jira, and
manual entry — decide what he should do today and in what order, so that his limited time
produces the most impact across his whole life: work, personal, family, and projects.

How to prioritize:
- Weigh impact against time required. A high-impact task that takes minutes outranks a
  medium-impact task that takes hours. Hard deadlines and commitments to other people
  outrank both.
- Balance life, not just work. If personal and family items keep losing to work items day
  after day, correct for it and say so in the briefing.
- Use his history. The request includes his patterns: how his time estimates compare to
  actuals, which recommendations he follows or defers, and lessons recorded in his memory
  file. Trust observed behavior over stated intentions, and adjust estimates for his known
  biases.
- Be honest in rank reasons: one short specific phrase each ("blocks 3 other tasks,"
  "you've deferred this 4 days"), never generic filler.

Ask a question only when a task is genuinely too unclear to place — at most two questions
per response, one sentence each.

Suggest an automation only when you see a real repeated pattern or a mechanical step the
app can do (recurring tasks, Jira transitions, drafting a routine update). Each suggestion
names the task, the automation, and the one-tap setup action.

The briefing is 3-5 sentences, warm but efficient: the shape of the day, the one thing that
matters most, and anything he's been avoiding that deserves honesty.

Respond only in the required JSON schema.
```

### Weekly retrospective call

Same shape, `effort: "high"`, own small schema (`observations[]`, `proposed_changes[]` with `description` + `patch` fields the app can apply to its stored preference weights). Input: the week's estimate-vs-actual log, completion patterns, and the memory file. Output proposals are shown to the user for one-tap accept/dismiss; accepted patches update the learned-patterns summary that rides in the cached system block (changing it invalidates the cache once — acceptable weekly).

---

*Generated for Troy (bmx316) — July 2026. API details verified against Anthropic's official documentation.*
