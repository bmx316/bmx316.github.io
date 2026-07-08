# Second Brain

**"What should I do right now?"** — a self-improving daily life operating system.
Static PWA, no build step, no frameworks. Lives at
[`bmx316.github.io/secondbrain/`](https://bmx316.github.io/secondbrain/) once this repo
is on GitHub Pages, and works from any static file server locally:

```sh
cd secondbrain && python3 -m http.server 8000
# → http://localhost:8000
```

## Two-minute try

1. Open the app. You're in **Basic mode**: one input box, one ranked list.
2. Type a task, hit Enter. It's ranked instantly (heuristic — no setup needed).
3. Tap **"Try with demo data"** (or Settings → Demo mode): sample vault + Jira tasks
   appear, a mock "AI" plan runs — briefing, rank reasons, a clarifying question, an
   automation suggestion — so you can exercise every flow with zero credentials.
4. Settings → Mode → **Advanced** to unlock layouts, themes, integrations, analytics,
   and the weekly retrospective.

Everything is stored in your browser's localStorage. Secrets (Claude key, Google token,
Jira token) never go anywhere except the API they belong to.

## What each credential unlocks

### Claude API key → real intelligence
Settings → Intelligence → paste your key (`sk-ant-…`).
- Ranked plan with honest per-task reasons, a 3–5 sentence morning briefing, clarifying
  questions for vague tasks, automation suggestions.
- Models: **Claude Opus 4.8** (default), **Claude Fable 5** (maximum intelligence —
  requires your Anthropic org to allow 30-day data retention; refusals automatically
  fall back server-side to Opus 4.8), **Claude Haiku 4.5** (economy).
- Without a key the app ranks heuristically (deadlines, age, deferrals, quick wins,
  learned category weights) — still a complete product.

### Google OAuth client ID → your Obsidian vault
1. In [Google Cloud Console](https://console.cloud.google.com/): create a project →
   enable the **Google Drive API** → OAuth consent screen (External, add yourself as a
   test user) → Credentials → **OAuth client ID**, type *Web application*.
2. Add your origins to **Authorized JavaScript origins**:
   `https://bmx316.github.io` and `http://localhost:8000`.
3. Paste the client ID in Settings → Obsidian vault → **Connect Drive**.

Then the app:
- reads open checkboxes from your `2026 Vault` folder (found anywhere in your Drive) — the last 7
  `Daily/` notes, `Daily_Tasks.md`, `📥 Jira Inbox.md`, `📥 Inbox.md`;
- checks tasks off in place (`- [ ]` → `- [x]`, wikilinks preserved) when you complete
  them here, and appends quick-adds to `📥 Inbox.md`;
- syncs its learnings file to `2026 Vault/Second Brain/memory.md`.

It requests the full `drive` scope because it must read files it didn't create; the
access token lives in memory only and is gone when you close the tab.

### Jira email + API token → your issues
Create a token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

**The honest part:** Jira Cloud does not send CORS headers for browser requests
authenticated with API tokens, so the *direct* transport will almost certainly fail in
a normal browser. The app's Jira module is built behind an adapter, and the reliable
transport is a tiny proxy you own — deploy this Cloudflare Worker (free tier is plenty):

```js
// Cloudflare Worker — forwards Second Brain's Jira requests. Holds no secrets:
// your credentials travel per-request in headers and go only to your Jira site.
const ALLOWED_ORIGINS = ['https://bmx316.github.io', 'http://localhost:8000'];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Headers': 'x-jira-site, x-jira-auth, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const site = req.headers.get('x-jira-site');
    const auth = req.headers.get('x-jira-auth');
    if (!site || !auth || !/^https:\/\/[\w-]+\.atlassian\.net$/.test(site)) {
      return new Response('bad request', { status: 400, headers: cors });
    }
    const url = new URL(req.url);
    const upstream = await fetch(site + url.pathname + url.search, {
      method: req.method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'content-type': 'application/json' } });
  },
};
```

Deploy (`npx wrangler deploy`), then in Settings → Jira set transport to **Proxy** and
paste the worker URL. With Jira connected: your open issues appear alongside everything
else, completing one offers the Done transition, and automation suggestions can post
comments for you.

## The self-improvement loop

- Completing a task asks (one tap) how long it actually took → estimated-vs-actual log.
- Every planning call includes a digest of your behavior: estimate bias by category,
  how often you follow the #1 recommendation, what you keep deferring.
- Lessons live in a memory file (vault `Second Brain/memory.md` via Drive, localStorage
  otherwise) — one lesson per entry, updated not duplicated, never secrets.
- Once a week (after ≥3 completions) the app offers a **retrospective**: Claude reviews
  the week and proposes concrete changes to its own weights and patterns summary, each
  a one-tap accept/dismiss. Accepted patches immediately change ranking — including the
  no-API heuristic.

## Layout & theme

Five layouts (Focus, List, Board, Timeline, Dashboard) × five themes (Ledger, Terminal,
Signal, Tide, Clay — see `THEMES.md` for the design rationale), each with proper light
and dark. All persist across reloads. Installable as a PWA; viewing, adding, and
completing work offline and write-backs happen when you're connected.

## Files

```
index.html            app shell + settings dialog
css/themes.css        5 themes (custom properties + light-dark())
css/app.css           layout & components
js/store.js           state, localStorage, history, memory, recurring
js/heuristic.js       no-API ranking (same plan shape as the AI)
js/ai.js              Claude API calls (prioritize + weekly retro)
js/demo.js            demo seed data + deterministic mock intelligence
js/drive.js           Google Drive vault sync (GIS OAuth, Drive v3 REST)
js/jira.js            Jira adapter (demo / proxy / direct transports)
js/views.js           the five layouts
js/app.js             wiring
sw.js                 offline app shell
```
