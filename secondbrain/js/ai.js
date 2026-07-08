// ai.js — the app's own Claude API calls, per Part B of the spec.
// Model policy: claude-opus-4-8 default (adaptive thinking), claude-fable-5 optional
// (thinking omitted, server-side fallbacks + refusal handling), claude-haiku-4-5 economy
// (no thinking, no effort — effort errors on Haiku 4.5).

import { activeTasks, historyDigest, todayStr } from './store.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

// Byte-stable for prompt caching. Never interpolate timestamps/IDs here.
const SYSTEM_PROMPT = `You are the planning engine inside "Second Brain," a personal daily-planning tool for one
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

Respond only in the required JSON schema.`;

const PRIORITIZE_SCHEMA = {
  type: 'object',
  properties: {
    briefing: { type: 'string' },
    ranked_tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          rank: { type: 'integer' },
          reason: { type: 'string' },
          estimated_minutes: { type: 'integer' },
        },
        required: ['id', 'rank', 'reason', 'estimated_minutes'],
        additionalProperties: false,
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['task_id', 'question'],
        additionalProperties: false,
      },
    },
    automation_suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          suggestion: { type: 'string' },
          setup_action: { type: 'string' },
        },
        required: ['task_id', 'suggestion', 'setup_action'],
        additionalProperties: false,
      },
    },
  },
  required: ['briefing', 'ranked_tasks', 'questions', 'automation_suggestions'],
  additionalProperties: false,
};

const RETRO_SCHEMA = {
  type: 'object',
  properties: {
    observations: { type: 'array', items: { type: 'string' } },
    proposed_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          patch: { type: 'string' },
        },
        required: ['description', 'patch'],
        additionalProperties: false,
      },
    },
  },
  required: ['observations', 'proposed_changes'],
  additionalProperties: false,
};

export function aiConfigured(state) {
  return Boolean(state.settings.apiKey);
}

export class AIError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function buildHeaders(settings) {
  const h = {
    'content-type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (settings.model === 'claude-fable-5') {
    h['anthropic-beta'] = 'server-side-fallback-2026-06-01';
  }
  return h;
}

function buildBody(settings, systemExtra, userText, schema, effort) {
  const model = settings.model || 'claude-opus-4-8';
  const body = {
    model,
    max_tokens: 16000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      { type: 'text', text: systemExtra, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  // Effort errors on Haiku 4.5 — send it only on Opus/Fable.
  if (model !== 'claude-haiku-4-5') body.output_config.effort = effort;
  // Thinking: adaptive on Opus; omit entirely on Fable 5 (always on) and Haiku.
  if (model === 'claude-opus-4-8') body.thinking = { type: 'adaptive' };
  if (model === 'claude-fable-5') body.fallbacks = [{ model: 'claude-opus-4-8' }];
  return body;
}

async function callClaude(settings, body) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000);
      res = await fetch(API_URL, {
        method: 'POST',
        headers: buildHeaders(settings),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch (e) {
      throw new AIError('network', 'Could not reach the Claude API. Check your connection.');
    }

    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 10;
      if (attempt >= 1) throw new AIError('rate_limit', `Rate limited — try again in ~${wait}s.`);
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000));
      continue;
    }
    if (res.status >= 500) {
      if (attempt >= 3) throw new AIError('server', 'Claude API is having trouble — using heuristic order for now.');
      attempt++;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) throw new AIError('auth', 'API key rejected — check your Claude API key in settings.');
    if (res.status === 400) {
      const detail = await res.text().catch(() => '');
      console.warn('Claude API 400:', detail);
      let msg = 'The API rejected the request — using heuristic order.';
      if (body.model === 'claude-fable-5') {
        msg += ' Note: Claude Fable 5 requires your org to allow 30-day data retention; if every request fails, that is the likely cause.';
      }
      throw new AIError('bad_request', msg);
    }
    if (!res.ok) throw new AIError('http', `Unexpected API response (${res.status}).`);

    const data = await res.json();
    // A decline is HTTP 200 with stop_reason "refusal" — check before reading content.
    if (data.stop_reason === 'refusal') {
      throw new AIError('refusal', 'Claude declined this request — falling back to heuristic ordering.');
    }
    const text = (data.content || []).find((b) => b.type === 'text')?.text;
    if (!text) throw new AIError('empty', 'Empty response from the API.');
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError('parse', 'Could not parse the API response.');
    }
  }
}

// System block #2: stable learned-patterns summary + memory. Changes only when a retro
// patch is accepted or a memory entry changes — that's the intended weekly cache refresh.
function patternsBlock(state) {
  const memLines = state.memory.map((m) => `- ${m.summary}${m.detail ? `: ${m.detail}` : ''}`);
  return [
    '<learned_patterns>',
    state.patterns.summary,
    '</learned_patterns>',
    '<memory_file>',
    memLines.length ? memLines.join('\n') : '(empty)',
    '</memory_file>',
  ].join('\n');
}

function taskPayload(t) {
  return {
    id: t.id,
    title: t.title,
    source: t.source,
    category: t.category,
    created: t.createdAt.slice(0, 10),
    due: t.due ? t.due.slice(0, 10) : null,
    deferrals: t.deferrals || 0,
    estimated_minutes: t.estimatedMinutes,
    notes: t.notes || null,
    jira_key: t.jiraKey || null,
    vault_file: t.vaultFileName || null,
  };
}

export async function planDay(state) {
  const tasks = activeTasks(state);
  if (!tasks.length) throw new AIError('empty_list', 'Nothing to plan.');
  const user = [
    `Today is ${todayStr()} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })}).`,
    '',
    'Recent behavior digest:',
    historyDigest(state),
    '',
    'Current tasks (JSON):',
    JSON.stringify(tasks.map(taskPayload), null, 1),
    '',
    'Rank every task for today. Use each task\'s "id" verbatim.',
  ].join('\n');

  const body = buildBody(state.settings, patternsBlock(state), user, PRIORITIZE_SCHEMA, 'medium');
  return callClaude(state.settings, body);
}

export async function runRetro(state) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const week = state.history.filter((h) => h.completedAt >= weekAgo);
  const user = [
    `Weekly retrospective for the week ending ${todayStr()}.`,
    '',
    "This week's completion log (JSON):",
    JSON.stringify(week, null, 1),
    '',
    'Open tasks still deferred:',
    JSON.stringify(state.tasks.filter((t) => !t.completedAt && (t.deferrals || 0) >= 2)
      .map((t) => ({ title: t.title, category: t.category, deferrals: t.deferrals })), null, 1),
    '',
    'Current learned-pattern weights (category -> multiplier applied by the heuristic ranker):',
    JSON.stringify(state.patterns.weights),
    '',
    'Propose concrete improvements to your own prioritization. Each proposed_changes[].patch',
    'must be a JSON string of the shape {"weights": {<category>: <multiplier>}, "summary": "<new one-paragraph',
    'learned-patterns summary>"} — weights are merged, summary (optional) replaces the current one.',
    'Each description is one sentence the user can accept or dismiss with one tap.',
  ].join('\n');

  const body = buildBody(state.settings, patternsBlock(state), user, RETRO_SCHEMA, 'high');
  return callClaude(state.settings, body);
}
