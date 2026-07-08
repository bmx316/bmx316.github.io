// jira.js — Jira Cloud behind a small adapter so the transport can change without
// touching the rest of the app.
//
// Known constraint (documented honestly in the UI): Jira Cloud does not send CORS
// headers for browser requests authenticated with email + API token, so the "direct"
// transport is expected to fail in a normal browser. The reliable path is the "proxy"
// transport — a tiny Cloudflare Worker (code in README.md) that forwards requests and
// adds the Authorization header server-side. "demo" needs nothing.

import { DEMO_JIRA_ISSUES } from './demo.js';

function basicAuth(email, token) {
  return 'Basic ' + btoa(`${email}:${token}`);
}

const JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC';

function restAdapter(baseUrl, headers) {
  const call = async (path, opts = {}) => {
    let res;
    try {
      res = await fetch(baseUrl + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    } catch (e) {
      throw new Error('Jira request failed before reaching the server — with the "direct" transport this is almost always the browser blocking CORS. Use the proxy transport (see README).');
    }
    if (res.status === 401 || res.status === 403) throw new Error('Jira rejected the credentials — check email + API token.');
    if (!res.ok) throw new Error(`Jira API error ${res.status}`);
    return res.status === 204 ? null : res.json();
  };

  return {
    async fetchIssues() {
      const data = await call(`/rest/api/3/search/jql?jql=${encodeURIComponent(JQL)}&maxResults=50&fields=summary,status,priority,duedate`);
      return (data.issues || []).map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name || '',
        priority: i.fields.priority?.name || '',
        due: i.fields.duedate || null,
      }));
    },
    async transitionDone(key) {
      const data = await call(`/rest/api/3/issue/${key}/transitions`);
      const done = (data.transitions || []).find((t) => /done|complete|resolve|closed/i.test(t.name)) || (data.transitions || [])[0];
      if (!done) throw new Error(`No available transition for ${key}.`);
      await call(`/rest/api/3/issue/${key}/transitions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transition: { id: done.id } }),
      });
      return done.name;
    },
    async addComment(key, text) {
      await call(`/rest/api/3/issue/${key}/comment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }),
      });
    },
  };
}

const demoAdapter = {
  async fetchIssues() { return DEMO_JIRA_ISSUES.map((i) => ({ ...i, due: null })); },
  async transitionDone(key) { return 'Done'; },
  async addComment() {},
};

export function getJiraAdapter(jiraSettings) {
  const { site, email, token, transport, proxyUrl } = jiraSettings;
  if (transport === 'demo') return demoAdapter;
  if (transport === 'proxy') {
    if (!proxyUrl) throw new Error('Set the proxy URL in settings (see README for the Worker).');
    // The proxy holds no secrets: credentials travel as headers it forwards upstream.
    return restAdapter(proxyUrl.replace(/\/$/, ''), {
      'x-jira-site': site,
      'x-jira-auth': basicAuth(email, token),
    });
  }
  // direct — honest about the CORS reality in the error path above.
  if (!site || !email || !token) throw new Error('Fill in Jira site, email, and API token first.');
  return restAdapter(site.replace(/\/$/, ''), { Authorization: basicAuth(email, token) });
}

export function jiraConfigured(jiraSettings) {
  if (jiraSettings.transport === 'demo') return true;
  if (jiraSettings.transport === 'proxy') return Boolean(jiraSettings.proxyUrl && jiraSettings.site && jiraSettings.email && jiraSettings.token);
  return Boolean(jiraSettings.site && jiraSettings.email && jiraSettings.token);
}
