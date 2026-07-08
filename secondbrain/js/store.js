// store.js — single localStorage-backed state blob + pub/sub.
// All app data lives here; nothing leaves the browser except calls the user configures.

const LS_KEY = 'secondbrain.v1';

const DEFAULT_STATE = {
  v: 1,
  tasks: [],       // {id,title,notes,source,category,createdAt,completedAt,actualMinutes,
                   //  snoozedUntil,later,deferrals,rank,reason,estimatedMinutes,due,
                   //  jiraKey,vaultFileId,vaultFileName,vaultLine,recurringId}
  history: [],     // {taskId,title,category,source,estimated,actual,completedAt,rankAtCompletion,topRankedId}
  memory: [],      // {id,summary,detail,updatedAt}
  recurring: [],   // {id,title,freq:'daily'|'weekly:<0-6>',lastSpawned}
  patterns: {
    summary: 'No learned patterns yet. Treat estimates and stated priorities at face value.',
    weights: {},   // category -> multiplier, e.g. {personal: 1.2}
  },
  briefing: null,  // {text,date,source:'ai'|'mock'}
  suggestions: [], // pending automation suggestions {id,taskId,suggestion,setupAction}
  questions: [],   // pending clarifying questions {id,taskId,question}
  retro: null,     // pending retro {observations:[], changes:[{id,description,patch,valid}]}
  lastRetro: null, // ISO date of last completed/dismissed retro
  lastMemorySync: null,
  planSource: 'heuristic', // 'heuristic'|'ai'|'mock'
  settings: {
    mode: 'basic',           // 'basic'|'advanced'
    theme: 'ledger',
    scheme: 'auto',          // 'auto'|'light'|'dark'
    layout: 'list',
    demo: false,
    apiKey: '',
    model: 'claude-opus-4-8',
    driveClientId: '',
    jira: { site: '', email: '', token: '', transport: 'demo', proxyUrl: '' },
  },
};

let state = null;
const listeners = new Set();

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw ? deepMerge(structuredClone(DEFAULT_STATE), JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }
  return state;
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], over[k]);
    } else {
      base[k] = over[k];
    }
  }
  return base;
}

export function getState() { return state; }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function update(mutator) {
  mutator(state);
  // Synchronous save: state is small, and a reload right after a change must not lose it.
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* storage full — keep running in memory */ }
  for (const fn of listeners) fn(state);
}

export function resetStore() {
  localStorage.removeItem(LS_KEY);
  state = structuredClone(DEFAULT_STATE);
  for (const fn of listeners) fn(state);
}

// ---------- task helpers ----------

const PERSONAL_WORDS = /\b(mom|dad|kids?|family|wife|husband|birthday|gift|groceries|doctor|dentist|gym|vet|school)\b/i;
const QUICK_WORDS = /\b(call|text|email|reply|pay|book|schedule|renew|confirm|rsvp)\b/i;

export function inferCategory(t) {
  if (t.jiraKey) return 'work';
  if (t.vaultFileName && /personal/i.test(t.vaultFileName)) return 'personal';
  if (PERSONAL_WORDS.test(t.title)) return 'personal';
  if (t.vaultFileName && /daily_tasks/i.test(t.vaultFileName)) return 'routine';
  return 'general';
}

export function defaultEstimate(title) {
  return QUICK_WORDS.test(title) ? 15 : 30;
}

export function makeTask(props) {
  const t = {
    id: uid(), title: '', notes: '', source: 'manual', category: null,
    createdAt: new Date().toISOString(), completedAt: null, actualMinutes: null,
    snoozedUntil: null, later: false, deferrals: 0,
    rank: null, reason: null, estimatedMinutes: null, due: null,
    jiraKey: null, vaultFileId: null, vaultFileName: null, vaultLine: null, recurringId: null,
    ...props,
  };
  if (!t.category) t.category = inferCategory(t);
  if (!t.estimatedMinutes) t.estimatedMinutes = defaultEstimate(t.title);
  return t;
}

export function isSnoozed(t, now = new Date()) {
  return t.snoozedUntil && new Date(t.snoozedUntil) > now;
}

export function activeTasks(s = state, now = new Date()) {
  return s.tasks.filter((t) => !t.completedAt && !t.later && !isSnoozed(t, now));
}

export function laterTasks(s = state) {
  return s.tasks.filter((t) => !t.completedAt && (t.later || isSnoozed(t)));
}

export function doneToday(s = state) {
  const today = todayStr();
  return s.tasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) === today);
}

export function rankedActive(s = state) {
  return activeTasks(s).slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
}

// ---------- mutations ----------

export function addTask(props) {
  const t = makeTask(props);
  update((s) => { s.tasks.push(t); });
  return t;
}

export function completeTask(id, actualMinutes = null) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t || t.completedAt) return;
    t.completedAt = new Date().toISOString();
    t.actualMinutes = actualMinutes;
    const top = rankedActive(s)[0];
    s.history.push({
      taskId: t.id, title: t.title, category: t.category, source: t.source,
      estimated: t.estimatedMinutes, actual: actualMinutes,
      completedAt: t.completedAt, rankAtCompletion: t.rank,
      topRankedId: top ? top.id : null,
    });
    if (s.history.length > 500) s.history = s.history.slice(-500);
  });
}

export function snoozeTask(id) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1); tmrw.setHours(6, 0, 0, 0);
    t.snoozedUntil = tmrw.toISOString();
    t.deferrals = (t.deferrals || 0) + 1;
  });
}

export function deferToLater(id) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    t.later = true;
    t.deferrals = (t.deferrals || 0) + 1;
  });
}

export function bringBack(id) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    t.later = false; t.snoozedUntil = null;
  });
}

export function deleteTask(id) {
  update((s) => { s.tasks = s.tasks.filter((t) => t.id !== id); });
}

// Apply a plan (AI, mock, or heuristic) — same shape everywhere.
export function applyPlan(plan, source) {
  update((s) => {
    const byId = new Map(s.tasks.map((t) => [t.id, t]));
    for (const r of plan.ranked_tasks || []) {
      const t = byId.get(r.id);
      if (!t) continue;
      t.rank = r.rank;
      t.reason = r.reason;
      if (r.estimated_minutes) t.estimatedMinutes = r.estimated_minutes;
    }
    if (plan.briefing) s.briefing = { text: plan.briefing, date: todayStr(), source };
    s.questions = (plan.questions || [])
      .filter((q) => byId.has(q.task_id))
      .slice(0, 2)
      .map((q) => ({ id: uid(), taskId: q.task_id, question: q.question }));
    s.suggestions = (plan.automation_suggestions || [])
      .filter((a) => byId.has(a.task_id))
      .map((a) => ({ id: uid(), taskId: a.task_id, suggestion: a.suggestion, setupAction: a.setup_action }));
    s.planSource = source;
  });
}

export function answerQuestion(qid, answer) {
  update((s) => {
    const q = s.questions.find((x) => x.id === qid);
    if (!q) return;
    const t = s.tasks.find((x) => x.id === q.taskId);
    if (t && answer.trim()) {
      t.notes = (t.notes ? t.notes + '\n' : '') + `Q: ${q.question}\nA: ${answer.trim()}`;
    }
    s.questions = s.questions.filter((x) => x.id !== qid);
  });
}

export function addMemory(summary, detail = '') {
  update((s) => {
    const existing = s.memory.find((m) => m.summary.toLowerCase() === summary.toLowerCase());
    if (existing) {
      existing.detail = detail || existing.detail;
      existing.updatedAt = new Date().toISOString();
    } else {
      s.memory.push({ id: uid(), summary, detail, updatedAt: new Date().toISOString() });
    }
  });
}

// ---------- recurring ----------

export function spawnRecurring() {
  const now = new Date();
  const today = todayStr(now);
  update((s) => {
    for (const r of s.recurring) {
      if (r.lastSpawned === today) continue;
      let due = false;
      if (r.freq === 'daily') due = true;
      else if (r.freq.startsWith('weekly:')) due = now.getDay() === Number(r.freq.split(':')[1]);
      const alreadyOpen = s.tasks.some((t) => t.recurringId === r.id && !t.completedAt);
      if (due && !alreadyOpen) {
        s.tasks.push(makeTask({ title: r.title, source: 'manual', recurringId: r.id, category: 'routine' }));
        r.lastSpawned = today;
      }
    }
  });
}

// ---------- history digest (volatile — goes in the user message, not the cached system block) ----------

export function historyDigest(s = state) {
  const recent = s.history.slice(-60);
  if (!recent.length) return 'No completion history yet.';
  const lines = [];
  const withActual = recent.filter((h) => h.estimated && h.actual);
  if (withActual.length >= 3) {
    const byCat = {};
    for (const h of withActual) (byCat[h.category] ||= []).push(h.actual / h.estimated);
    for (const [cat, ratios] of Object.entries(byCat).sort()) {
      const med = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      lines.push(`- "${cat}" tasks actually take ~${med.toFixed(1)}x their estimate (${ratios.length} samples)`);
    }
  }
  const followed = recent.filter((h) => h.rankAtCompletion === 1).length;
  lines.push(`- Followed the #1 recommendation ${followed}/${recent.length} recent completions`);
  const deferred = s.tasks.filter((t) => !t.completedAt && (t.deferrals || 0) >= 3);
  for (const t of deferred.slice(0, 5)) {
    lines.push(`- Keeps deferring: "${t.title}" (${t.deferrals}x, category ${t.category})`);
  }
  const catDone = {};
  for (const h of recent) catDone[h.category] = (catDone[h.category] || 0) + 1;
  lines.push('- Completions by category: ' + Object.entries(catDone).sort().map(([k, v]) => `${k}=${v}`).join(', '));
  return lines.join('\n');
}

export function memoryMarkdown(s = state) {
  const out = ['# Second Brain — memory', '', `_Updated ${new Date().toISOString()}_`, ''];
  for (const m of s.memory) {
    out.push(`## ${m.summary}`, '', m.detail || '_no detail_', '', `<!-- id:${m.id} updated:${m.updatedAt} -->`, '');
  }
  return out.join('\n');
}

export function parseMemoryMarkdown(md) {
  const entries = [];
  const blocks = md.split(/^## /m).slice(1);
  for (const b of blocks) {
    const lines = b.split('\n');
    const summary = lines[0].trim();
    const meta = b.match(/<!-- id:(\S+) updated:(\S+) -->/);
    const detail = lines.slice(1).join('\n').replace(/<!--.*?-->/gs, '').trim().replace(/^_no detail_$/, '');
    if (summary) entries.push({ id: meta ? meta[1] : uid(), summary, detail, updatedAt: meta ? meta[2] : new Date().toISOString() });
  }
  return entries;
}
