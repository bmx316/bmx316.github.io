/* TaskScore — time-scored task list with bang-for-the-buck prioritization.
   Works fully offline via impact÷time formula; a Claude API key unlocks AI
   prioritization, follow-up questions, and automation suggestions. */

"use strict";

// ---------- scoring table ----------
const SCORES = [
  { v: 1,  label: "Instant" },
  { v: 2,  label: "Under 1 min" },
  { v: 3,  label: "1–2 min" },
  { v: 4,  label: "2–5 min" },
  { v: 5,  label: "5–10 min" },
  { v: 6,  label: "10–30 min" },
  { v: 7,  label: "30–60 min" },
  { v: 8,  label: "1–3 hours" },
  { v: 9,  label: "3–8 hours" },
  { v: 10, label: "1 day" },
  { v: 20, label: "2 days" },
  { v: 30, label: "3 days" },
  { v: 40, label: "4 days" },
  { v: 50, label: "5 days" },
];
const SCORE_VALUES = SCORES.map(s => s.v);

function scoreLabel(v) {
  const s = SCORES.find(s => s.v === v);
  return s ? s.label : "?";
}
function scoreIndex(v) { return SCORE_VALUES.indexOf(v); }
function bucketClass(v) {
  if (v == null) return "";
  if (v <= 3) return "bucket-green";
  if (v <= 5) return "bucket-lime";
  if (v <= 7) return "bucket-yellow";
  if (v <= 9) return "bucket-orange";
  return "bucket-red";
}

// ---------- state ----------
const LS_STATE = "taskScoring.v1";
const LS_HISTORY = "taskScoring.history.v1";

let state = loadJSON(LS_STATE, {
  tasks: [],
  settings: { apiKey: "", model: "claude-opus-4-8", activeSection: "work" },
  aiOrder: null, // { section, stale }
});
let history = loadJSON(LS_HISTORY, []);

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? Object.assign(structuredClone(fallback), JSON.parse(raw)) : fallback;
  } catch { return fallback; }
}
function save() {
  localStorage.setItem(LS_STATE, JSON.stringify(state));
  localStorage.setItem(LS_HISTORY, JSON.stringify(history));
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- learning / calibration ----------
function titleKeywords(title) {
  const stop = new Set(["the","and","for","with","that","this","from","have","will","your","about","into","then","them","get","make","take"]);
  return (title.toLowerCase().match(/[a-z][a-z']{2,}/g) || []).filter(w => !stop.has(w));
}

// Aggregates history into estimation-bias signals.
function calibration() {
  const tracked = history.filter(h => h.estimated != null && h.actual != null);
  let globalSum = 0;
  const kw = new Map();      // word -> {sum, n}    bucket-index delta (actual - estimated)
  const early = new Map();   // word -> {early, n}  completed while ranked top-2
  for (const h of tracked) {
    const delta = scoreIndex(h.actual) - scoreIndex(h.estimated);
    globalSum += delta;
    for (const w of h.keywords || []) {
      const e = kw.get(w) || { sum: 0, n: 0 };
      e.sum += delta; e.n++;
      kw.set(w, e);
    }
  }
  for (const h of history) {
    if (h.rank == null || h.listSize == null || h.listSize < 3) continue;
    for (const w of h.keywords || []) {
      const e = early.get(w) || { early: 0, n: 0 };
      if (h.rank <= 2) e.early++;
      e.n++;
      early.set(w, e);
    }
  }
  return {
    n: tracked.length,
    globalBias: tracked.length ? globalSum / tracked.length : 0,
    kwBias: kw,
    kwEarly: early,
  };
}

let cal = calibration();

// Effective time score: the user's guess corrected by their measured bias.
function effectiveScore(task) {
  const base = task.score ?? 6; // unknown → assume 10–30 min
  let idx = scoreIndex(base);
  const words = titleKeywords(task.title);
  let adj = null;
  for (const w of words) {
    const e = cal.kwBias.get(w);
    if (e && e.n >= 2) { adj = e.sum / e.n; break; }
  }
  if (adj == null && cal.n >= 3) adj = cal.globalBias;
  if (adj) idx = Math.min(SCORES.length - 1, Math.max(0, idx + Math.round(adj)));
  return SCORE_VALUES[idx];
}

// Impact default learns from what the user actually does first.
function impactDefault(task) {
  for (const w of titleKeywords(task.title)) {
    const e = cal.kwEarly.get(w);
    if (e && e.n >= 3 && e.early / e.n > 0.6) return 4;
  }
  return 3;
}

function priorityValue(task) {
  const impact = task.impact ?? impactDefault(task);
  return impact / effectiveScore(task);
}

function sortedOpenTasks(section = state.settings.activeSection) {
  const open = state.tasks.filter(t => !t.done && t.section === section);
  const ai = state.aiOrder;
  if (ai && !ai.stale && ai.section === section) {
    return open.slice().sort((a, b) => (a.aiRank ?? 999) - (b.aiRank ?? 999));
  }
  return open.slice().sort((a, b) => {
    const pd = priorityValue(b) - priorityValue(a);
    if (Math.abs(pd) > 1e-9) return pd;
    const sd = effectiveScore(a) - effectiveScore(b); // quick wins first on ties
    if (sd !== 0) return sd;
    return a.createdAt - b.createdAt;
  });
}

function markStale() {
  if (state.aiOrder && state.aiOrder.section === state.settings.activeSection) {
    state.aiOrder.stale = true;
  }
}

// ---------- rendering ----------
const $ = sel => document.querySelector(sel);

function render() {
  cal = calibration();
  // tabs
  document.querySelectorAll(".tab").forEach(el =>
    el.classList.toggle("active", el.dataset.section === state.settings.activeSection));

  // stale notice
  const ai = state.aiOrder;
  $("#stale-notice").hidden = !(ai && ai.stale && ai.section === state.settings.activeSection);

  // open tasks
  const open = sortedOpenTasks();
  $("#task-list").innerHTML = open.map(taskCard).join("");
  $("#empty-msg").hidden = open.length > 0;

  // done tasks
  const done = state.tasks
    .filter(t => t.done && t.section === state.settings.activeSection)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  $("#done-count").textContent = done.length;
  $("#done-list").innerHTML = done.map(doneCard).join("");

  // stats footer
  $("#stats").innerHTML = statsLine();
  save();
}

function scoreSelect(task) {
  const opts = SCORES.map(s =>
    `<option value="${s.v}" ${task.score === s.v ? "selected" : ""}>⏱ ${s.v} · ${esc(s.label)}</option>`).join("");
  return `<select class="inline-select" data-action="set-score" data-id="${task.id}">
    <option value="">⏱ time?</option>${opts}</select>`;
}
function impactSelect(task) {
  const opts = [1,2,3,4,5].map(v =>
    `<option value="${v}" ${task.impact === v ? "selected" : ""}>🎯 ${v}</option>`).join("");
  return `<select class="inline-select" data-action="set-impact" data-id="${task.id}">
    <option value="">🎯 impact?</option>${opts}</select>`;
}

function taskCard(task) {
  const eff = effectiveScore(task);
  const corrected = task.score != null && eff !== task.score;
  const meta = [];
  if (task.score != null) {
    meta.push(`<span class="chip chip-score ${bucketClass(task.score)}">⏱ ${task.score} · ${esc(scoreLabel(task.score))}</span>`);
    if (corrected) meta.push(`<span class="chip chip-warn" title="Adjusted from your completion history">≈ ${eff} for you</span>`);
  } else {
    meta.push(`<span class="chip chip-warn">needs estimate</span>`);
  }
  meta.push(scoreSelect(task), impactSelect(task));
  if (task.aiRank != null && state.aiOrder && !state.aiOrder.stale) {
    meta.push(`<span class="chip chip-ai">✨ AI #${task.aiRank}</span>`);
  }

  let extras = "";
  if (task.aiRationale) extras += `<div class="task-rationale">${esc(task.aiRationale)}</div>`;
  if (task.aiQuestion) {
    extras += `<div class="task-question">❓ ${esc(task.aiQuestion)}`;
    if (task.aiAnswer) {
      extras += `<div class="task-answer">↳ ${esc(task.aiAnswer)}</div>`;
    } else {
      extras += `<input type="text" placeholder="Answer to help prioritize… (Enter to save)"
        data-action="answer" data-id="${task.id}">`;
    }
    extras += `</div>`;
  }
  if (task.aiAutomation) {
    extras += `<div class="task-automation">
      <button type="button" class="automation-toggle" data-action="toggle-automation" data-id="${task.id}">
        ⚙️ This could be automated — ${task.showAutomation ? "hide" : "show"} setup</button>
      ${task.showAutomation ? `<div class="automation-body">${esc(task.aiAutomation)}</div>` : ""}
    </div>`;
  }
  if (task.awaitingActual) {
    extras += `<div class="actual-prompt">
      <p>✅ Nice! How long did it actually take? <em>(improves future priorities)</em></p>
      <div class="actual-chips">
        ${SCORES.map(s => `<button type="button" data-action="actual" data-id="${task.id}" data-v="${s.v}">${esc(s.label)}</button>`).join("")}
        <button type="button" data-action="actual" data-id="${task.id}" data-v="">skip</button>
      </div>
    </div>`;
  }

  return `<li class="task-card ${bucketClass(eff)}" data-id="${task.id}">
    <div class="task-main">
      <input type="checkbox" class="task-check" data-action="complete" data-id="${task.id}"
        ${task.awaitingActual ? "checked" : ""} title="Mark complete">
      <div class="task-body">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-meta">${meta.join("")}</div>
        ${extras}
      </div>
      <button class="task-delete" data-action="delete" data-id="${task.id}" title="Delete">✕</button>
    </div>
  </li>`;
}

function doneCard(task) {
  return `<li class="task-card ${bucketClass(task.score)}" data-id="${task.id}">
    <div class="task-main">
      <div class="task-body">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-meta">
          ${task.score != null ? `<span class="chip chip-score ${bucketClass(task.score)}">⏱ est ${esc(scoreLabel(task.score))}</span>` : ""}
          ${task.actualScore != null ? `<span class="chip">took ${esc(scoreLabel(task.actualScore))}</span>` : ""}
        </div>
      </div>
      <button class="task-delete" data-action="restore" data-id="${task.id}" title="Restore">↩</button>
      <button class="task-delete" data-action="delete" data-id="${task.id}" title="Delete">✕</button>
    </div>
  </li>`;
}

function statsLine() {
  if (cal.n < 2) return "Complete tasks and log actual times — the app learns and prioritizes better the more you use it.";
  const b = cal.globalBias;
  const dir = b > 0.15 ? "low (things take longer than you guess)" : b < -0.15 ? "high (you finish faster than you guess)" : "spot on";
  const mag = Math.abs(b).toFixed(1);
  return `📈 Your estimates run ${Math.abs(b) <= 0.15 ? "" : "~" + mag + " time-bucket(s) "}${dir} · based on ${cal.n} tracked completion${cal.n === 1 ? "" : "s"}.`;
}

// ---------- toast ----------
let toastTimer;
function toast(msg, isError) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

// ---------- AI ----------
const AI_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          rank: { type: "integer" },
          score: { type: "integer", enum: SCORE_VALUES },
          impact: { type: "integer", enum: [1, 2, 3, 4, 5] },
          rationale: { type: "string" },
          question: { type: ["string", "null"] },
          automation: { type: ["string", "null"] },
        },
        required: ["id", "rank", "score", "impact", "rationale", "question", "automation"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

function buildPrompt(openTasks) {
  const legend = SCORES.map(s => `${s.v} = ${s.label}`).join(", ");
  const digest = history.slice(-50).map(h => {
    const parts = [`"${h.title || (h.keywords || []).join(" ")}"`, h.section];
    if (h.estimated != null && h.actual != null)
      parts.push(`estimated ${scoreLabel(h.estimated)}, actually took ${scoreLabel(h.actual)}`);
    if (h.rank != null && h.listSize != null)
      parts.push(`done while ranked ${h.rank}/${h.listSize}`);
    return "- " + parts.join(" · ");
  }).join("\n");

  const taskJson = JSON.stringify(openTasks.map(t => ({
    id: t.id,
    title: t.title,
    time_score_guess: t.score,
    impact_guess: t.impact,
    clarifying_answer: t.aiAnswer || null,
  })), null, 1);

  return `You are the prioritization engine of a task list app. Every task gets a TIME SCORE from this table (${legend}) and an IMPACT rating 1–5. The objective is maximum bang for the buck: tasks where impact is high relative to time should be done first (rank 1 = do first). Prefer high-impact quick wins; long low-impact tasks go last.

The user's completion history (use it to calibrate — if they consistently underestimate certain kinds of tasks, adjust scores accordingly; if they consistently do certain kinds of tasks first, weight impact up):
${digest || "(no history yet)"}

Open tasks in the "${state.settings.activeSection}" section:
${taskJson}

For EVERY task return: rank, your best time score from the table, impact 1–5, a one-sentence rationale, a clarifying question ONLY if the task is too vague to prioritize confidently (else null), and an automation suggestion with brief setup steps ONLY if the task could realistically be automated (else null). Respect the user's guesses unless the history or task content suggests otherwise. If a clarifying_answer is present, use it.`;
}

async function aiPrioritize() {
  const { apiKey, model } = state.settings;
  if (!apiKey) {
    $("#settings-hint").hidden = false;
    openSettings();
    return;
  }
  const open = state.tasks.filter(t => !t.done && t.section === state.settings.activeSection);
  if (open.length === 0) { toast("No open tasks to prioritize."); return; }

  const btn = $("#ai-btn");
  btn.classList.add("loading");
  btn.textContent = "✨ Thinking…";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        output_config: { format: { type: "json_schema", schema: AI_SCHEMA } },
        messages: [{ role: "user", content: buildPrompt(open) }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(res.status === 401 ? "Invalid API key — check Settings." : msg);
    }
    const text = (data.content || []).find(b => b.type === "text")?.text;
    if (!text) throw new Error("Empty response from the model.");
    const result = JSON.parse(text);

    for (const r of result.tasks) {
      const t = state.tasks.find(t => t.id === r.id);
      if (!t) continue;
      t.aiRank = r.rank;
      t.score = r.score;
      t.impact = r.impact;
      t.aiRationale = r.rationale;
      t.aiQuestion = r.question || null;
      if (r.question && t.aiAnswer && t.aiQuestion !== r.question) t.aiAnswer = null;
      t.aiAutomation = r.automation || null;
    }
    state.aiOrder = { section: state.settings.activeSection, stale: false };
    render();
    const q = result.tasks.filter(r => r.question).length;
    const a = result.tasks.filter(r => r.automation).length;
    toast(`✨ Prioritized ${result.tasks.length} tasks` +
      (q ? ` · ${q} need${q === 1 ? "s" : ""} clarification` : "") +
      (a ? ` · ${a} automatable` : ""));
  } catch (err) {
    toast("AI error: " + err.message, true);
  } finally {
    btn.classList.remove("loading");
    btn.textContent = "✨ AI Prioritize";
  }
}

// ---------- Markdown export (Obsidian-friendly) ----------
function exportMarkdown() {
  const day = ts => new Date(ts).toISOString().slice(0, 10);
  let md = `# TaskScore — ${day(Date.now())}\n`;
  for (const section of ["work", "personal"]) {
    const label = section === "work" ? "💼 Work" : "🏠 Personal";
    const open = sortedOpenTasks(section);
    const done = state.tasks
      .filter(t => t.done && t.section === section)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    if (!open.length && !done.length) continue;
    md += `\n## ${label}\n`;
    for (const t of open) {
      const bits = [];
      if (t.score != null) bits.push(`⏱ ${scoreLabel(t.score)} (score ${t.score})`);
      if (t.impact != null) bits.push(`🎯 impact ${t.impact}`);
      if (t.aiQuestion && !t.aiAnswer) bits.push(`❓ ${t.aiQuestion}`);
      md += `- [ ] ${t.title}${bits.length ? " — " + bits.join(" · ") : ""}\n`;
    }
    if (done.length) {
      md += `\n### Done\n`;
      for (const t of done) {
        const took = t.actualScore != null ? ` — took ${scoreLabel(t.actualScore)}` : "";
        const when = t.completedAt ? ` ✅ ${day(t.completedAt)}` : "";
        md += `- [x] ${t.title}${took}${when}\n`;
      }
    }
  }
  return md;
}

async function handleExport() {
  const md = exportMarkdown();
  try {
    await navigator.clipboard.writeText(md);
    toast("📋 Markdown copied — paste it into an Obsidian note.");
  } catch {
    // clipboard blocked (permissions / non-secure context) → download instead
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `taskscore-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("⬇️ Markdown file downloaded — drop it into your Obsidian vault.");
  }
}

// ---------- actions ----------
function addTask(title, score, impact) {
  state.tasks.push({
    id: uid(),
    title: title.trim(),
    section: state.settings.activeSection,
    score: score || null,
    impact: impact || null,
    done: false,
    createdAt: Date.now(),
  });
  markStale();
  render();
}

function completeTask(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  const ranked = sortedOpenTasks();
  t.rankAtCompletion = ranked.findIndex(x => x.id === id) + 1;
  t.listSizeAtCompletion = ranked.length;
  t.awaitingActual = true;
  render();
}

function recordActual(id, actual) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  delete t.awaitingActual;
  t.done = true;
  t.completedAt = Date.now();
  if (actual) t.actualScore = actual;
  history.push({
    title: t.title.slice(0, 120),
    keywords: titleKeywords(t.title),
    section: t.section,
    estimated: t.score ?? null,
    actual: actual || null,
    rank: t.rankAtCompletion ?? null,
    listSize: t.listSizeAtCompletion ?? null,
    completedAt: t.completedAt,
  });
  if (history.length > 500) history = history.slice(-500);
  markStale();
  render();
}

function openSettings() {
  $("#api-key").value = state.settings.apiKey;
  $("#model-select").value = state.settings.model;
  $("#settings-dialog").showModal();
}

// ---------- events ----------
document.addEventListener("DOMContentLoaded", () => {
  // populate selects & legend
  $("#new-score").innerHTML = `<option value="">⏱ time guess</option>` +
    SCORES.map(s => `<option value="${s.v}">⏱ ${s.v} · ${esc(s.label)}</option>`).join("");
  $("#legend-body").innerHTML = SCORES.map(s =>
    `<tr><td>${esc(s.label)}</td><td class="score-cell" style="color:var(--c-${bucketClass(s.v).slice(7)})">${s.v}</td></tr>`).join("");

  $("#quick-add").addEventListener("submit", e => {
    e.preventDefault();
    const title = $("#new-title").value.trim();
    if (!title) return;
    addTask(title, Number($("#new-score").value) || null, Number($("#new-impact").value) || null);
    $("#new-title").value = "";
    $("#new-score").value = "";
    $("#new-impact").value = "";
    $("#new-title").focus();
  });

  document.querySelectorAll(".tab").forEach(el => el.addEventListener("click", () => {
    state.settings.activeSection = el.dataset.section;
    render();
  }));

  $("#ai-btn").addEventListener("click", aiPrioritize);
  $("#export-btn").addEventListener("click", handleExport);
  $("#stale-rerun").addEventListener("click", aiPrioritize);
  $("#settings-btn").addEventListener("click", () => { $("#settings-hint").hidden = true; openSettings(); });

  $("#settings-dialog").addEventListener("close", () => {
    if ($("#settings-dialog").returnValue === "save") {
      state.settings.apiKey = $("#api-key").value.trim();
      state.settings.model = $("#model-select").value;
      save();
      toast("Settings saved.");
    }
  });

  $("#clear-data").addEventListener("click", () => {
    if (!confirm("Delete ALL tasks, history, and settings from this browser?")) return;
    localStorage.removeItem(LS_STATE);
    localStorage.removeItem(LS_HISTORY);
    location.reload();
  });

  // delegated task actions
  document.body.addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const { action, id } = el.dataset;
    const t = state.tasks.find(t => t.id === id);
    switch (action) {
      case "complete":
        if (t && t.awaitingActual) { delete t.awaitingActual; render(); } // uncheck cancels
        else completeTask(id);
        break;
      case "actual":
        recordActual(id, Number(el.dataset.v) || null);
        break;
      case "delete":
        state.tasks = state.tasks.filter(t => t.id !== id);
        markStale();
        render();
        break;
      case "restore":
        if (t) { t.done = false; delete t.completedAt; delete t.actualScore; markStale(); render(); }
        break;
      case "toggle-automation":
        if (t) { t.showAutomation = !t.showAutomation; render(); }
        break;
    }
  });

  document.body.addEventListener("change", e => {
    const el = e.target.closest("select[data-action]");
    if (!el) return;
    const t = state.tasks.find(t => t.id === el.dataset.id);
    if (!t) return;
    const v = Number(el.value) || null;
    if (el.dataset.action === "set-score") t.score = v;
    if (el.dataset.action === "set-impact") t.impact = v;
    markStale();
    render();
  });

  document.body.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const el = e.target.closest("input[data-action='answer']");
    if (!el) return;
    e.preventDefault();
    const t = state.tasks.find(t => t.id === el.dataset.id);
    if (t && el.value.trim()) {
      t.aiAnswer = el.value.trim();
      render();
      toast("Answer saved — it'll be used on the next AI prioritization.");
    }
  });

  render();
  $("#new-title").focus();
});
