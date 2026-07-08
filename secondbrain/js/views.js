// views.js — the five layouts. Same data, same actions in all five.
// Each renderer returns a DOM element; app.js swaps it into <main>.

import { rankedActive, laterTasks, doneToday, todayStr } from './store.js';

export const LAYOUTS = [
  { id: 'focus', label: 'Focus' },
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'dashboard', label: 'Dashboard' },
];

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}

const SOURCE_ICON = { manual: '✎', vault: '◈', jira: '⬒' };

function estChip(t) {
  return el('span', { class: 'chip est' }, `~${t.estimatedMinutes || 30}m`);
}

function sourceTag(t) {
  return el('span', { class: `chip src src-${t.source}`, title: t.vaultFileName || t.jiraKey || 'added here' },
    `${SOURCE_ICON[t.source] || ''} ${t.jiraKey ? t.jiraKey : t.source}`);
}

// The complete flow: first tap swaps buttons for actual-time chips (self-improvement log).
function taskActions(t, actions) {
  const wrap = el('div', { class: 'actions' });
  const askTime = () => {
    wrap.replaceChildren(
      el('span', { class: 'took-label' }, 'took:'),
      ...[['5m', 5], ['15m', 15], ['30m', 30], ['1h+', 75]].map(([lbl, min]) =>
        el('button', { class: 'chipbtn', onclick: () => actions.complete(t.id, min) }, lbl)),
      el('button', { class: 'chipbtn ghost', onclick: () => actions.complete(t.id, null) }, 'skip'),
    );
  };
  wrap.append(
    el('button', { class: 'act done', title: 'Done', 'aria-label': `Complete ${t.title}`, onclick: askTime }, '✓'),
    el('button', { class: 'act', title: 'Snooze to tomorrow', 'aria-label': `Snooze ${t.title}`, onclick: () => actions.snooze(t.id) }, '☾'),
    el('button', { class: 'act', title: 'Move to Later', 'aria-label': `Later: ${t.title}`, onclick: () => actions.later(t.id) }, '→'),
  );
  return wrap;
}

function taskRow(t, actions, { showRank = true } = {}) {
  return el('article', { class: 'task', dataset: { id: t.id } },
    showRank && t.rank ? el('div', { class: 'rank' }, String(t.rank)) : null,
    el('div', { class: 'body' },
      el('div', { class: 'title' }, t.title),
      el('div', { class: 'meta' },
        t.reason ? el('span', { class: 'reason' }, t.reason) : null,
        estChip(t), sourceTag(t),
        (t.deferrals || 0) >= 2 ? el('span', { class: 'chip warn' }, `deferred ${t.deferrals}x`) : null,
      ),
    ),
    taskActions(t, actions),
  );
}

function emptyState(actions) {
  return el('div', { class: 'empty' },
    el('p', {}, 'Nothing here yet. Add a task above —'),
    el('p', { class: 'dim' }, 'or load sample data to see how planning works.'),
    el('button', { class: 'primary', onclick: actions.enableDemo }, 'Try with demo data'),
  );
}

// ---------- 1. Focus — one task at a time ----------
function renderFocus(state, actions, ctx) {
  const tasks = rankedActive(state);
  if (!tasks.length) return emptyState(actions);
  const i = Math.min(ctx.focusIndex || 0, tasks.length - 1);
  const t = tasks[i];
  return el('div', { class: 'view-focus' },
    el('div', { class: 'focus-count' }, `${i + 1} of ${tasks.length}`),
    el('div', { class: 'focus-card' },
      el('h2', { class: 'focus-title' }, t.title),
      t.reason ? el('p', { class: 'focus-reason' }, t.reason) : null,
      el('div', { class: 'meta center' }, estChip(t), sourceTag(t)),
      taskActions(t, actions),
    ),
    el('div', { class: 'focus-nav' },
      el('button', { class: 'ghostbtn', disabled: i === 0 ? '' : null, onclick: () => actions.focusMove(-1) }, '‹ prev'),
      el('button', { class: 'ghostbtn', disabled: i >= tasks.length - 1 ? '' : null, onclick: () => actions.focusMove(1) }, 'next ›'),
    ),
  );
}

// ---------- 2. List — classic ranked list ----------
function renderList(state, actions) {
  const tasks = rankedActive(state);
  const later = laterTasks(state);
  const done = doneToday(state);
  if (!tasks.length && !later.length && !done.length) return emptyState(actions);
  return el('div', { class: 'view-list' },
    el('section', {}, tasks.map((t) => taskRow(t, actions))),
    later.length ? el('details', { class: 'bucket' },
      el('summary', {}, `Later · ${later.length}`),
      later.map((t) => el('div', { class: 'task dim-row' },
        el('div', { class: 'body' }, el('div', { class: 'title' }, t.title)),
        el('button', { class: 'chipbtn', onclick: () => actions.bringBack(t.id) }, 'bring back'),
      )),
    ) : null,
    done.length ? el('details', { class: 'bucket' },
      el('summary', {}, `Done today · ${done.length}`),
      done.map((t) => el('div', { class: 'task done-row' }, el('div', { class: 'body' }, el('div', { class: 'title strike' }, t.title)))),
    ) : null,
  );
}

// ---------- 3. Board — Now / Next / Later / Done ----------
function renderBoard(state, actions) {
  const tasks = rankedActive(state);
  if (!tasks.length && !laterTasks(state).length && !doneToday(state).length) return emptyState(actions);
  const cols = [
    ['Now', tasks.slice(0, 3)],
    ['Next', tasks.slice(3)],
    ['Later', laterTasks(state)],
    ['Done', doneToday(state)],
  ];
  return el('div', { class: 'view-board' },
    cols.map(([name, list]) => el('div', { class: 'col' },
      el('h3', {}, `${name} · ${list.length}`),
      list.map((t) => name === 'Done'
        ? el('div', { class: 'card done-row' }, el('div', { class: 'title strike' }, t.title))
        : name === 'Later'
          ? el('div', { class: 'card' }, el('div', { class: 'title' }, t.title),
              el('button', { class: 'chipbtn', onclick: () => actions.bringBack(t.id) }, 'bring back'))
          : el('div', { class: 'card' },
              el('div', { class: 'title' }, t.title),
              t.reason ? el('div', { class: 'reason' }, t.reason) : null,
              el('div', { class: 'meta' }, estChip(t), sourceTag(t)),
              taskActions(t, actions))),
    )),
  );
}

// ---------- 4. Timeline — agenda built from estimates ----------
function renderTimeline(state, actions) {
  const tasks = rankedActive(state);
  if (!tasks.length) return emptyState(actions);
  let cursor = new Date();
  cursor.setSeconds(0, 0);
  const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return el('div', { class: 'view-timeline' },
    el('p', { class: 'dim tl-note' }, 'If you worked the list top to bottom, starting now:'),
    tasks.map((t) => {
      const start = new Date(cursor);
      cursor = new Date(cursor.getTime() + (t.estimatedMinutes || 30) * 60000);
      return el('div', { class: 'slot' },
        el('div', { class: 'time' }, fmt(start)),
        el('div', { class: 'tick' }),
        taskRow(t, actions, { showRank: false }),
      );
    }),
    el('p', { class: 'dim tl-note' }, `Done around ${fmt(cursor)}.`),
  );
}

// ---------- 5. Dashboard — stats + top three ----------
function renderDashboard(state, actions) {
  const tasks = rankedActive(state);
  const done = doneToday(state);
  const hist = state.history.filter((h) => h.estimated && h.actual);
  const ratio = hist.length >= 3
    ? (hist.slice(-30).reduce((a, h) => a + h.actual / h.estimated, 0) / Math.min(hist.length, 30))
    : null;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const week = state.history.filter((h) => h.completedAt >= weekAgo);
  const mostDeferred = state.tasks.filter((t) => !t.completedAt).sort((a, b) => (b.deferrals || 0) - (a.deferrals || 0))[0];

  const stat = (label, value, note) => el('div', { class: 'stat' },
    el('div', { class: 'stat-num' }, value),
    el('div', { class: 'stat-label' }, label),
    note ? el('div', { class: 'stat-note' }, note) : null,
  );

  return el('div', { class: 'view-dash' },
    el('div', { class: 'stats' },
      stat('done today', `${done.length}/${done.length + tasks.length}`),
      stat('this week', String(week.length)),
      stat('estimate accuracy', ratio ? `${ratio.toFixed(1)}x` : '—', ratio ? (ratio > 1.2 ? 'things run long' : ratio < 0.8 ? 'you overestimate' : 'well calibrated') : 'complete a few tasks with times'),
      stat('most avoided', mostDeferred && (mostDeferred.deferrals || 0) >= 2 ? `${mostDeferred.deferrals}x` : '—', mostDeferred && (mostDeferred.deferrals || 0) >= 2 ? mostDeferred.title : 'nothing lingering'),
    ),
    el('h3', {}, 'Top three right now'),
    tasks.length ? el('section', {}, tasks.slice(0, 3).map((t) => taskRow(t, actions))) : emptyState(actions),
  );
}

const RENDERERS = { focus: renderFocus, list: renderList, board: renderBoard, timeline: renderTimeline, dashboard: renderDashboard };

export function renderView(state, actions, ctx) {
  const fn = RENDERERS[state.settings.layout] || renderList;
  return fn(state, actions, ctx);
}
