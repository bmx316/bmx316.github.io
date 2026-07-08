// app.js — wiring: boot, capture, planning, settings, cards (briefing/questions/
// suggestions/retro), theme + layout application, service worker.

import {
  initStore, getState, subscribe, update, resetStore, addTask, completeTask, snoozeTask,
  deferToLater, bringBack, applyPlan, answerQuestion, addMemory, spawnRecurring, uid,
  todayStr, activeTasks, memoryMarkdown, parseMemoryMarkdown, makeTask,
} from './store.js';
import { heuristicPlan } from './heuristic.js';
import { planDay, runRetro, aiConfigured, AIError } from './ai.js';
import { seedDemoTasks, mockPlan, mockRetro } from './demo.js';
import * as drive from './drive.js';
import { getJiraAdapter, jiraConfigured } from './jira.js';
import { renderView, LAYOUTS, el } from './views.js';

const $ = (sel) => document.querySelector(sel);
const ctx = { focusIndex: 0, planning: false, retroRunning: false };

// ---------- toast ----------
let toastTimer = null;
function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- actions shared by all layouts ----------
const actions = {
  complete(id, actualMinutes) {
    const s = getState();
    const t = s.tasks.find((x) => x.id === id);
    completeTask(id, actualMinutes);
    ctx.focusIndex = 0;
    // write-backs are best-effort; local state is the source of truth
    if (t?.source === 'vault' && drive.driveConnected()) {
      drive.completeInVault(t).then((ok) => ok && toast(`Checked off in ${t.vaultFileName}`)).catch((e) => toast(e.message));
    }
    if (t?.source === 'jira' && t.jiraKey && jiraConfigured(s.settings.jira) && s.settings.jira.transport !== 'demo') {
      try {
        getJiraAdapter(s.settings.jira).transitionDone(t.jiraKey)
          .then((name) => toast(`${t.jiraKey} → ${name}`))
          .catch((e) => toast(e.message, 6000));
      } catch (e) { toast(e.message, 6000); }
    }
  },
  snooze(id) { snoozeTask(id); ctx.focusIndex = 0; toast('Snoozed until tomorrow morning'); },
  later(id) { deferToLater(id); ctx.focusIndex = 0; },
  bringBack(id) { bringBack(id); },
  focusMove(d) { ctx.focusIndex = Math.max(0, (ctx.focusIndex || 0) + d); render(); },
  enableDemo() {
    update((s) => { s.settings.demo = true; s.settings.jira.transport = 'demo'; });
    seedDemoTasks(update, getState());
    rerank();
    plan(); // mock plan — instant, no credentials
  },
};

// ---------- planning ----------
function rerank() {
  // heuristic ordering is always applied instantly; AI refines it when available
  applyPlanKeepingCards(heuristicPlan(getState()), 'heuristic');
}

// heuristic re-ranks shouldn't wipe AI-produced briefing/questions/suggestions
function applyPlanKeepingCards(p, source) {
  const s = getState();
  const keep = source === 'heuristic' && s.planSource !== 'heuristic';
  const merged = keep
    ? { ...p, briefing: null, questions: s.questions.map((q) => ({ task_id: q.taskId, question: q.question })), automation_suggestions: s.suggestions.map((a) => ({ task_id: a.taskId, suggestion: a.suggestion, setup_action: a.setupAction })) }
    : p;
  applyPlan(merged, keep ? s.planSource : source);
  if (keep) update((s2) => { s2.briefing = s.briefing; });
}

async function plan({ silent = false } = {}) {
  const s = getState();
  if (!activeTasks(s).length) { if (!silent) toast('Nothing to plan yet — add a task first.'); return; }
  if (s.settings.demo && !aiConfigured(s)) {
    applyPlan(mockPlan(s), 'mock');
    if (!silent) toast('Planned (demo intelligence)');
    return;
  }
  if (!aiConfigured(s)) {
    rerank();
    if (!silent) toast('Ordered heuristically — add a Claude API key in settings for AI planning.');
    return;
  }
  ctx.planning = true; render();
  try {
    const p = await planDay(s);
    applyPlan(p, 'ai');
    if (!silent) toast('Planned with Claude');
  } catch (e) {
    rerank();
    toast(e instanceof AIError ? e.message : 'Planning failed — using heuristic order.', 6000);
    console.warn(e);
  } finally {
    ctx.planning = false; render();
  }
}

// ---------- capture ----------
function setupCapture() {
  $('#capture').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#capture input');
    const title = input.value.trim();
    if (!title) return;
    addTask({ title, source: 'manual' });
    input.value = '';
    rerank();
    if (drive.driveConnected()) {
      drive.appendToInbox(title).then((ok) => ok && toast('Added to 📥 Inbox.md')).catch(() => {});
    }
  });
}

// ---------- suggestion / question / retro handling ----------
function acceptSuggestion(sug) {
  const s = getState();
  const t = s.tasks.find((x) => x.id === sug.taskId);
  const action = sug.setupAction || '';
  if (/recur/i.test(action) || /recurring/i.test(sug.suggestion)) {
    const freq = /daily/i.test(action) ? 'daily' : /weekly:(\d)/.exec(action)?.[0].replace('weekly:', '') !== undefined && /weekly:(\d)/.test(action) ? `weekly:${/weekly:(\d)/.exec(action)[1]}` : /weekly/i.test(action) ? `weekly:${new Date().getDay()}` : 'daily';
    update((st) => { st.recurring.push({ id: uid(), title: t ? t.title : sug.suggestion, freq, lastSpawned: todayStr() }); });
    addMemory(`Recurring: ${t ? t.title : sug.suggestion} (${freq})`, 'Set up from an automation suggestion.');
    toast('Recurring task created');
  } else if (/^jira:/i.test(action) && t?.jiraKey) {
    const st = getState();
    try {
      getJiraAdapter(st.settings.jira).addComment(t.jiraKey, action.replace(/^jira:/i, '').trim() || 'Status update posted from Second Brain.')
        .then(() => toast(`Commented on ${t.jiraKey}`)).catch((e) => toast(e.message, 6000));
    } catch (e) { toast(e.message, 6000); }
  } else {
    addMemory(sug.suggestion, `Accepted automation idea (action: ${action}).`);
    toast('Noted in memory');
  }
  update((st) => { st.suggestions = st.suggestions.filter((x) => x.id !== sug.id); });
  syncMemoryUp();
}

async function startRetro({ mock = false } = {}) {
  const s = getState();
  ctx.retroRunning = true; render();
  try {
    const r = (mock || (s.settings.demo && !aiConfigured(s))) ? mockRetro(s) : await runRetro(s);
    update((st) => {
      st.retro = {
        observations: r.observations || [],
        changes: (r.proposed_changes || []).map((c) => {
          let valid = false;
          try { const p = JSON.parse(c.patch); valid = p && typeof p === 'object' && !Array.isArray(p); } catch {}
          return { id: uid(), description: c.description, patch: c.patch, valid };
        }),
      };
    });
  } catch (e) {
    toast(e instanceof AIError ? e.message : 'Retrospective failed.', 6000);
  } finally {
    ctx.retroRunning = false; render();
  }
}

function acceptRetroChange(change) {
  try {
    const p = JSON.parse(change.patch);
    update((s) => {
      if (p.weights && typeof p.weights === 'object') Object.assign(s.patterns.weights, p.weights);
      if (p.summary && typeof p.summary === 'string' && p.summary.trim()) s.patterns.summary = p.summary.trim();
    });
    addMemory(change.description, `Accepted in weekly retro ${todayStr()}.`);
    toast('Applied — future planning will use it');
  } catch { toast('Could not apply that change.'); }
  dismissRetroChange(change);
  syncMemoryUp();
}

function dismissRetroChange(change) {
  update((s) => {
    if (!s.retro) return;
    s.retro.changes = s.retro.changes.filter((c) => c.id !== change.id);
    if (!s.retro.changes.length) { s.retro = null; s.lastRetro = todayStr(); }
  });
}

function retroDue(s) {
  if (s.retro) return false;
  const week = s.history.filter((h) => h.completedAt >= new Date(Date.now() - 7 * 86400000).toISOString());
  if (week.length < 3) return false;
  if (!s.lastRetro) return true;
  return (new Date(todayStr()) - new Date(s.lastRetro)) / 86400000 >= 7;
}

// ---------- memory sync (Drive when connected, localStorage otherwise) ----------
let memSyncTimer = null;
function syncMemoryUp() {
  if (!drive.driveConnected()) return;
  clearTimeout(memSyncTimer);
  memSyncTimer = setTimeout(() => {
    drive.saveMemoryFile(memoryMarkdown(getState()))
      .then(() => update((s) => { s.lastMemorySync = new Date().toISOString(); }))
      .catch((e) => console.warn('memory sync failed', e));
  }, 1500);
}

// ---------- integrations ----------
async function connectDriveFlow() {
  const s = getState();
  try {
    await drive.connectDrive(s.settings.driveClientId);
    toast('Drive connected — syncing vault…');
    // memory: prefer remote if it changed since our last sync
    try {
      const remote = await drive.loadMemoryFile();
      if (remote && (!s.lastMemorySync || remote.modifiedTime > s.lastMemorySync)) {
        const entries = parseMemoryMarkdown(remote.content);
        if (entries.length) update((st) => { st.memory = entries; });
      } else {
        syncMemoryUp();
      }
    } catch (e) { console.warn(e); }
    await syncVault();
  } catch (e) {
    toast(e.message, 7000);
  }
  renderSettingsStatus();
}

async function syncVault() {
  try {
    await drive.ensureConnected(getState().settings.driveClientId);
    renderSettingsStatus();
    const found = await drive.fetchVaultTasks();
    update((s) => {
      const have = new Set(s.tasks.filter((t) => t.source === 'vault').map((t) => t.vaultFileName + '::' + t.vaultLine));
      for (const v of found) {
        const key = v.vaultFileName + '::' + v.vaultLine;
        if (!have.has(key)) s.tasks.push(makeTask({ ...v, source: 'vault' }));
      }
    });
    rerank();
    toast(`Vault synced — ${found.length} open checkbox${found.length === 1 ? '' : 'es'} found`);
  } catch (e) { toast(e.message, 7000); }
}

async function syncJira() {
  const s = getState();
  if (!jiraConfigured(s.settings.jira)) { toast('Configure Jira in settings first.'); return; }
  try {
    const issues = await getJiraAdapter(s.settings.jira).fetchIssues();
    update((st) => {
      const have = new Set(st.tasks.filter((t) => t.jiraKey && !t.completedAt).map((t) => t.jiraKey));
      for (const i of issues) {
        if (!have.has(i.key)) {
          st.tasks.push(makeTask({ title: `${i.key} — ${i.summary}`, source: 'jira', jiraKey: i.key, category: 'work', due: i.due, estimatedMinutes: /high/i.test(i.priority) ? 60 : 45 }));
        }
      }
    });
    rerank();
    toast(`Jira synced — ${issues.length} open issue${issues.length === 1 ? '' : 's'}`);
  } catch (e) { toast(e.message, 7000); }
}

// ---------- settings dialog ----------
function bindSettings() {
  const dlg = $('#settings');
  $('#gear').addEventListener('click', () => { fillSettings(); dlg.showModal(); });
  $('#settings-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  const bind = (sel, path, { on = 'change', map = (v) => v } = {}) => {
    $(sel).addEventListener(on, (e) => {
      const v = map(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      update((s) => {
        const keys = path.split('.');
        let o = s.settings;
        for (const k of keys.slice(0, -1)) o = o[k];
        o[keys.at(-1)] = v;
      });
      applyChrome();
    });
  };

  bind('#set-mode', 'mode');
  bind('#set-theme', 'theme');
  bind('#set-scheme', 'scheme');
  bind('#set-layout', 'layout');
  bind('#set-apikey', 'apiKey', { on: 'input' });
  bind('#set-model', 'model');
  bind('#set-clientid', 'driveClientId', { on: 'input' });
  bind('#set-jira-site', 'jira.site', { on: 'input' });
  bind('#set-jira-email', 'jira.email', { on: 'input' });
  bind('#set-jira-token', 'jira.token', { on: 'input' });
  bind('#set-jira-transport', 'jira.transport');
  bind('#set-jira-proxy', 'jira.proxyUrl', { on: 'input' });

  $('#set-demo').addEventListener('change', (e) => {
    if (e.target.checked) actions.enableDemo();
    else update((s) => { s.settings.demo = false; });
  });
  $('#btn-drive-connect').addEventListener('click', connectDriveFlow);
  $('#btn-vault-sync').addEventListener('click', syncVault);
  $('#btn-jira-sync').addEventListener('click', syncJira);
  $('#btn-retro-now').addEventListener('click', () => { $('#settings').close(); startRetro({ mock: getState().settings.demo && !aiConfigured(getState()) }); });
  $('#btn-reset').addEventListener('click', () => {
    if (confirm('Erase all Second Brain data in this browser? (Your vault and Jira are untouched.)')) { resetStore(); location.reload(); }
  });
}

function fillSettings() {
  const s = getState().settings;
  $('#set-mode').value = s.mode;
  $('#set-theme').value = s.theme;
  $('#set-scheme').value = s.scheme;
  $('#set-layout').value = s.layout;
  $('#set-demo').checked = s.demo;
  $('#set-apikey').value = s.apiKey;
  $('#set-model').value = s.model;
  $('#set-clientid').value = s.driveClientId;
  $('#set-jira-site').value = s.jira.site;
  $('#set-jira-email').value = s.jira.email;
  $('#set-jira-token').value = s.jira.token;
  $('#set-jira-transport').value = s.jira.transport;
  $('#set-jira-proxy').value = s.jira.proxyUrl;
  renderSettingsStatus();
}

function renderSettingsStatus() {
  const s = getState();
  $('#drive-status').textContent = drive.driveConnected() ? 'connected' : 'not connected';
  $('#mem-count').textContent = String(s.memory.length);
  document.documentElement.dataset.mode = s.settings.mode;
}

// ---------- cards above the list ----------
function renderCards() {
  const s = getState();
  const wrap = $('#cards');
  wrap.replaceChildren();
  const adv = s.settings.mode === 'advanced';

  if (s.briefing && s.briefing.date === todayStr()) {
    wrap.append(el('section', { class: 'card briefing' },
      el('div', { class: 'card-kicker' }, s.briefing.source === 'ai' ? 'Morning briefing' : 'Morning briefing (demo)'),
      el('p', {}, s.briefing.text),
    ));
  }

  for (const q of s.questions) {
    const t = s.tasks.find((x) => x.id === q.taskId);
    if (!t || t.completedAt) continue;
    const input = el('input', { type: 'text', placeholder: 'Answer in a few words…' });
    wrap.append(el('section', { class: 'card question' },
      el('div', { class: 'card-kicker' }, 'Quick question'),
      el('p', {}, q.question),
      el('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); answerQuestion(q.id, input.value); toast('Got it — noted on the task'); } },
        input, el('button', { class: 'primary', type: 'submit' }, 'Answer'),
        el('button', { class: 'ghostbtn', type: 'button', onclick: () => answerQuestion(q.id, '') }, 'Skip'),
      ),
    ));
  }

  if (adv) {
    for (const sug of s.suggestions) {
      wrap.append(el('section', { class: 'card suggestion' },
        el('div', { class: 'card-kicker' }, 'Automation'),
        el('p', {}, sug.suggestion),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => acceptSuggestion(sug) }, 'Set it up'),
          el('button', { class: 'ghostbtn', onclick: () => update((st) => { st.suggestions = st.suggestions.filter((x) => x.id !== sug.id); }) }, 'Dismiss'),
        ),
      ));
    }

    if (retroDue(s) && !ctx.retroRunning) {
      wrap.append(el('section', { class: 'card retro' },
        el('div', { class: 'card-kicker' }, 'Weekly retrospective'),
        el('p', {}, "A week of data is in — want me to look for ways to improve how I plan your days?"),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => startRetro({ mock: s.settings.demo && !aiConfigured(s) }) }, 'Run retro'),
          el('button', { class: 'ghostbtn', onclick: () => update((st) => { st.lastRetro = todayStr(); }) }, 'Not now'),
        ),
      ));
    }
    if (ctx.retroRunning) {
      wrap.append(el('section', { class: 'card retro' }, el('p', {}, 'Reviewing your week…')));
    }

    if (s.retro) {
      wrap.append(el('section', { class: 'card retro' },
        el('div', { class: 'card-kicker' }, 'Retro — what I noticed'),
        el('ul', {}, s.retro.observations.map((o) => el('li', {}, o))),
        ...s.retro.changes.map((c) => el('div', { class: 'retro-change' },
          el('p', {}, c.description),
          el('div', { class: 'row' },
            el('button', { class: 'primary', disabled: c.valid ? null : '', title: c.valid ? '' : 'Malformed patch — cannot apply', onclick: () => acceptRetroChange(c) }, 'Accept'),
            el('button', { class: 'ghostbtn', onclick: () => dismissRetroChange(c) }, 'Dismiss'),
          ),
        )),
      ));
    }
  }
}

// ---------- toolbar ----------
function renderToolbar() {
  const s = getState();
  const bar = $('#toolbar');
  bar.replaceChildren();
  const adv = s.settings.mode === 'advanced';

  const planBtn = el('button', { class: 'planbtn', disabled: ctx.planning ? '' : null, onclick: () => plan() },
    ctx.planning ? 'Planning…' : (aiConfigured(s) ? '✦ Plan my day' : s.settings.demo ? '✦ Plan (demo)' : '↻ Re-rank'));
  bar.append(planBtn);

  if (adv) {
    const pills = el('div', { class: 'pills', role: 'tablist' },
      LAYOUTS.map((l) => el('button', {
        class: 'pill' + (s.settings.layout === l.id ? ' on' : ''),
        role: 'tab', 'aria-selected': s.settings.layout === l.id ? 'true' : 'false',
        onclick: () => { update((st) => { st.settings.layout = l.id; }); },
      }, l.label)),
    );
    bar.append(pills);
  }
}

// ---------- chrome (theme/scheme/mode) ----------
function applyChrome() {
  const s = getState().settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.scheme = s.scheme;
  root.dataset.mode = s.mode;
  const themeColor = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (themeColor) $('meta[name=theme-color]')?.setAttribute('content', themeColor);
}

// ---------- render ----------
function render() {
  renderToolbar();
  renderCards();
  const main = $('#view');
  main.replaceChildren(renderView(getState(), actions, ctx));
}

// ---------- boot ----------
function boot() {
  initStore();
  applyChrome();
  bindSettings();
  setupCapture();
  spawnRecurring();
  rerank();
  subscribe(() => { applyChrome(); render(); });
  render();

  // Auto-plan once per day when intelligence is available (key or demo).
  const s = getState();
  const planned = s.briefing && s.briefing.date === todayStr();
  if (!planned && (aiConfigured(s) || s.settings.demo) && activeTasks(s).length) {
    plan({ silent: true });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
