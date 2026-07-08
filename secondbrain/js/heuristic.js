// heuristic.js — no-API ranking. Produces the same plan shape as the AI call so the
// rest of the app has a single code path.

import { activeTasks, todayStr } from './store.js';

export function heuristicPlan(state) {
  const now = new Date();
  const today = todayStr(now);
  const weights = state.patterns.weights || {};

  const scored = activeTasks(state, now).map((t) => {
    let score = 0;
    const why = [];

    if (t.due) {
      const d = t.due.slice(0, 10);
      if (d < today) { score += 60; why.push('overdue'); }
      else if (d === today) { score += 45; why.push('due today'); }
      else { score += 10; why.push(`due ${d}`); }
    }
    if (t.source === 'jira') { score += 18; why.push('open Jira issue'); }
    if (t.source === 'vault' && /daily_tasks/i.test(t.vaultFileName || '')) { score += 14; why.push('daily routine'); }

    const ageDays = (now - new Date(t.createdAt)) / 86400000;
    if (ageDays > 5) { score += Math.min(20, ageDays * 2); why.push(`waiting ${Math.floor(ageDays)}d`); }

    if ((t.deferrals || 0) >= 2) { score += t.deferrals * 6; why.push(`deferred ${t.deferrals}x`); }

    if ((t.estimatedMinutes || 30) <= 15) { score += 8; if (!why.length) why.push(`quick win (~${t.estimatedMinutes}m)`); }

    const w = weights[t.category];
    if (w && w !== 1) { score *= w; if (w > 1) why.push(`${t.category} boosted by your patterns`); }

    if (!why.length) why.push(ageDays < 1 ? 'fresh capture' : 'default order');
    return { t, score, why };
  });

  scored.sort((a, b) => b.score - a.score || a.t.createdAt.localeCompare(b.t.createdAt));

  return {
    briefing: null, // heuristic mode has no prose briefing; the list speaks for itself
    ranked_tasks: scored.map((x, i) => ({
      id: x.t.id,
      rank: i + 1,
      reason: x.why.slice(0, 2).join(', '),
      estimated_minutes: x.t.estimatedMinutes || 30,
    })),
    questions: [],
    automation_suggestions: [],
  };
}
