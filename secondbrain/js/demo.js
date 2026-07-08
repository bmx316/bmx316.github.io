// demo.js — demo mode: sample vault + Jira data and deterministic mock AI responses,
// so every flow (plan, questions, automations, retro) works with zero credentials.

import { makeTask, activeTasks, todayStr } from './store.js';
import { heuristicPlan } from './heuristic.js';

export const DEMO_VAULT_FILES = {
  'Daily_Tasks.md': '# Daily tasks\n\n- [ ] Review [[📥 Inbox]] and clear to zero\n- [ ] 20 minute walk\n- [ ] Water plants',
  '📥 Inbox.md': '# Inbox\n\n- [ ] Book dentist appointment for the kids\n- [ ] Renew car registration (due Friday)\n- [ ] Read that article about [[PKM workflows]]',
  '📥 Jira Inbox.md': '# Jira inbox\n\n- [ ] PLAT-812 Fix login redirect loop\n- [ ] PLAT-799 Write Q3 capacity plan',
  'Daily/': '- [ ] Reply to Sarah about the offsite\n- [ ] stuff for the deck',
};

export const DEMO_JIRA_ISSUES = [
  { key: 'PLAT-812', summary: 'Fix login redirect loop', status: 'In Progress', priority: 'High' },
  { key: 'PLAT-799', summary: 'Write Q3 capacity plan', status: 'To Do', priority: 'Medium' },
  { key: 'PLAT-901', summary: 'Review dependency upgrade PR', status: 'To Do', priority: 'Low' },
];

export function seedDemoTasks(update, state) {
  if (state.tasks.some((t) => t.source === 'vault' || t.source === 'jira')) return; // already seeded
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const friday = nextWeekday(5);
  const seeds = [
    makeTask({ title: 'Review 📥 Inbox and clear to zero', source: 'vault', vaultFileName: 'Daily_Tasks.md', vaultLine: '- [ ] Review [[📥 Inbox]] and clear to zero', category: 'routine', estimatedMinutes: 10 }),
    makeTask({ title: '20 minute walk', source: 'vault', vaultFileName: 'Daily_Tasks.md', vaultLine: '- [ ] 20 minute walk', category: 'personal', estimatedMinutes: 20 }),
    makeTask({ title: 'Water plants', source: 'vault', vaultFileName: 'Daily_Tasks.md', vaultLine: '- [ ] Water plants', category: 'routine', estimatedMinutes: 5 }),
    makeTask({ title: 'Book dentist appointment for the kids', source: 'vault', vaultFileName: '📥 Inbox.md', vaultLine: '- [ ] Book dentist appointment for the kids', category: 'personal', createdAt: twoDaysAgo, deferrals: 3, estimatedMinutes: 15 }),
    makeTask({ title: 'Renew car registration', source: 'vault', vaultFileName: '📥 Inbox.md', vaultLine: '- [ ] Renew car registration (due Friday)', category: 'personal', due: friday, estimatedMinutes: 15 }),
    makeTask({ title: 'Reply to Sarah about the offsite', source: 'vault', vaultFileName: `Daily/${todayStr()}.md`, vaultLine: '- [ ] Reply to Sarah about the offsite', category: 'work', estimatedMinutes: 10 }),
    makeTask({ title: 'stuff for the deck', source: 'vault', vaultFileName: `Daily/${todayStr()}.md`, vaultLine: '- [ ] stuff for the deck', category: 'work' }),
    ...DEMO_JIRA_ISSUES.map((i) => makeTask({ title: `${i.key} — ${i.summary}`, source: 'jira', jiraKey: i.key, category: 'work', estimatedMinutes: i.key === 'PLAT-799' ? 90 : 45 })),
  ];
  update((s) => { s.tasks.push(...seeds); });
}

function nextWeekday(dow) {
  const d = new Date();
  const diff = (dow - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString();
}

// Mock AI plan: heuristic order + canned briefing/question/automation, deterministic.
export function mockPlan(state) {
  const base = heuristicPlan(state);
  const tasks = activeTasks(state);
  const byTitle = (re) => tasks.find((t) => re.test(t.title));

  const vague = tasks.find((t) => t.title.trim().split(/\s+/).length <= 4 && /stuff|things|misc|\?$/i.test(t.title));
  const recurringish = byTitle(/water plants|walk/i);
  const jiraInProgress = byTitle(/PLAT-812/);
  const deferred = tasks.filter((t) => (t.deferrals || 0) >= 3).sort((a, b) => b.deferrals - a.deferrals)[0];

  const briefingBits = [
    `You have ${tasks.length} things on deck and roughly ${Math.round(tasks.reduce((a, t) => a + (t.estimatedMinutes || 30), 0) / 60)}h of estimated work — so today is about picking, not finishing everything.`,
    jiraInProgress ? `${jiraInProgress.title.split(' — ')[0]} is already in progress and blocks the release, so close it out first.` : 'Lead with the highest-impact work item while your energy is fresh.',
    deferred ? `You've pushed "${deferred.title}" ${deferred.deferrals} times now — it takes ${deferred.estimatedMinutes} minutes, just do it after lunch.` : 'Nothing is badly overdue, which is a good place to be.',
    'Keep the quick personal items between meetings; they protect the evening.',
  ];

  const questions = vague ? [{ task_id: vague.id, question: `What does "${vague.title}" actually involve — is it prep for this week's deck review?` }] : [];
  const automation_suggestions = recurringish ? [{
    task_id: recurringish.id,
    suggestion: `"${recurringish.title}" shows up every day — want me to make it a recurring task so you never re-enter it?`,
    setup_action: 'make_recurring:daily',
  }] : [];

  return {
    ...base,
    briefing: briefingBits.join(' '),
    ranked_tasks: base.ranked_tasks.map((r) => ({
      ...r,
      reason: sharpenReason(r, state),
    })),
    questions,
    automation_suggestions,
  };
}

function sharpenReason(r, state) {
  const t = state.tasks.find((x) => x.id === r.id);
  if (!t) return r.reason;
  if (t.jiraKey === 'PLAT-812') return 'in progress, blocks the release';
  if ((t.deferrals || 0) >= 3) return `you've deferred this ${t.deferrals} times`;
  if (t.due) return r.reason;
  if ((t.estimatedMinutes || 30) <= 10) return `~${t.estimatedMinutes}m — clears headspace`;
  return r.reason;
}

// Mock weekly retrospective.
export function mockRetro(state) {
  const week = state.history.slice(-30);
  const personalDone = week.filter((h) => h.category === 'personal').length;
  return {
    observations: [
      `You completed ${week.length} tasks this week; ${personalDone} were personal — work is ${week.length - personalDone >= personalDone ? 'winning the tug-of-war' : 'in balance'}.`,
      'Your 15-minute estimates run long: quick tasks average roughly double their estimate.',
      'You complete routine tasks reliably before 10am but almost never after 2pm.',
    ],
    proposed_changes: [
      {
        description: 'Boost personal tasks 20% in ranking so they stop losing to work by default.',
        patch: JSON.stringify({ weights: { personal: 1.2 }, summary: 'Personal tasks get a 1.2x ranking boost — they were consistently losing to work items. Quick-task estimates should be doubled. Routine tasks belong in the morning.' }),
      },
      {
        description: 'Assume quick tasks take 2x their estimate when planning the day.',
        patch: JSON.stringify({ weights: {}, summary: '' }),
      },
    ],
  };
}
