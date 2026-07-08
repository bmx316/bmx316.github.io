// drive.js — Google Drive vault sync via Google Identity Services (client-side OAuth)
// and the Drive v3 REST API. The GIS script is loaded on demand so the app stays
// self-contained offline. The access token is kept in sessionStorage so reloads within
// the same tab don't force a re-consent; sync silently refreshes it when it expires.

const VAULT_NAME = '2026 Vault';
const KNOWN_VAULT_ID = '1JZDW2u4PfBfmrn9Vx-RW1zIUTR_brT8Q';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'secondbrain.gtoken';

let accessToken = null;
let tokenExpiry = 0;

// Restore a still-valid token from this tab's session so a reload doesn't disconnect.
try {
  const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
  if (saved && saved.expiry - 60000 > Date.now()) { accessToken = saved.token; tokenExpiry = saved.expiry; }
} catch {}

export function driveConnected() { return Boolean(accessToken) && tokenExpiry - 60000 > Date.now(); }

function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in script (offline?).'));
    document.head.appendChild(s);
  });
}

// silent: true asks Google for a token without any popup — works once the user has
// consented before and is still signed in. Falls back to the consent popup otherwise.
async function requestToken(clientId, { silent = false } = {}) {
  await loadGIS();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return finish(reject, new Error(resp.error_description || resp.error));
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiry: tokenExpiry })); } catch {}
        finish(resolve);
      },
      error_callback: (e) => finish(reject, new Error(e?.message || 'Google sign-in was closed or failed.')),
    });
    client.requestAccessToken(silent ? { prompt: '' } : {});
    if (silent) setTimeout(() => finish(reject, new Error('Silent sign-in timed out.')), 8000);
  });
}

export async function connectDrive(clientId) {
  if (!clientId) throw new Error('Enter your Google OAuth client ID first.');
  await requestToken(clientId);
}

// Called before any sync: reuses the current token, silently refreshes an expired one,
// and only falls back to the consent popup as a last resort.
export async function ensureConnected(clientId) {
  if (driveConnected()) return;
  if (!clientId) throw new Error('Enter your Google OAuth client ID and click Connect Drive first.');
  try { await requestToken(clientId, { silent: true }); }
  catch { await requestToken(clientId); }
}

export function disconnectDrive() {
  accessToken = null; tokenExpiry = 0;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

async function gfetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { disconnectDrive(); throw new Error('Google session expired — reconnect Drive.'); }
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text().catch(() => '')}`);
  return res;
}

const esc = (s) => s.replace(/'/g, "\\'");

async function findChild(parentId, name, isFolder) {
  const q = [
    `name = '${esc(name)}'`,
    `'${parentId}' in parents`,
    'trashed = false',
    isFolder ? "mimeType = 'application/vnd.google-apps.folder'" : null,
  ].filter(Boolean).join(' and ');
  const res = await gfetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&pageSize=5`);
  const data = await res.json();
  return data.files[0] || null;
}

let vaultId = null;
async function getVaultId() {
  if (vaultId) return vaultId;
  // Search by name anywhere in Drive — works no matter which folder the vault lives in.
  try {
    const q = `name = '${esc(VAULT_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await gfetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
    const data = await res.json();
    if (data.files?.length) { vaultId = data.files[0].id; return vaultId; }
  } catch {}
  // Fallback: the folder ID we've seen before.
  try {
    await gfetch(`${API}/files/${KNOWN_VAULT_ID}?fields=id`);
    vaultId = KNOWN_VAULT_ID;
    return vaultId;
  } catch {}
  throw new Error(`Could not find a "${VAULT_NAME}" folder in this Google account's Drive.`);
}

async function readFile(fileId) {
  const res = await gfetch(`${API}/files/${fileId}?alt=media`);
  return res.text();
}

async function writeFile(fileId, content) {
  await gfetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'content-type': 'text/markdown' },
    body: content,
  });
}

async function createFile(parentId, name, content) {
  const meta = { name, parents: [parentId], mimeType: 'text/markdown' };
  const boundary = 'sb' + Math.random().toString(36).slice(2);
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta),
    `--${boundary}`, 'Content-Type: text/markdown', '', content, `--${boundary}--`, '',
  ].join('\r\n');
  const res = await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

async function ensureFolder(parentId, name) {
  const existing = await findChild(parentId, name, true);
  if (existing) return existing.id;
  const res = await gfetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await res.json()).id;
}

// ---------- vault task sync ----------

const CHECKBOX_RE = /^(\s*)- \[ \] (.+)$/;

function parseCheckboxes(content) {
  const out = [];
  for (const line of content.split('\n')) {
    const m = line.match(CHECKBOX_RE);
    if (m) out.push({ line, text: m[2].trim() });
  }
  return out;
}

// Strip wikilink brackets for display; the raw line is preserved for write-back.
export function displayTitle(raw) {
  return raw.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => inner.split('|').pop()).trim();
}

// Pull tasks from Daily/ (last 7 notes), Daily_Tasks.md, 📥 Jira Inbox.md, 📥 Inbox.md.
export async function fetchVaultTasks() {
  const vid = await getVaultId();
  const sources = [];

  for (const name of ['Daily_Tasks.md', '📥 Jira Inbox.md', '📥 Inbox.md']) {
    const f = await findChild(vid, name, false);
    if (f) sources.push(f);
  }
  const daily = await findChild(vid, 'Daily', true);
  if (daily) {
    const res = await gfetch(`${API}/files?q=${encodeURIComponent(`'${daily.id}' in parents and trashed = false and name contains '.md'`)}&fields=files(id,name)&orderBy=name desc&pageSize=7`);
    const data = await res.json();
    for (const f of data.files) sources.push({ ...f, name: `Daily/${f.name}` });
  }

  const tasks = [];
  for (const f of sources) {
    const content = await readFile(f.id);
    for (const cb of parseCheckboxes(content)) {
      tasks.push({ vaultFileId: f.id, vaultFileName: f.name, vaultLine: cb.line, title: displayTitle(cb.text) });
    }
  }
  return tasks;
}

// Flip the task's exact line from "- [ ]" to "- [x]" — wikilinks untouched.
export async function completeInVault(task) {
  if (!task.vaultFileId || !task.vaultLine) return false;
  const content = await readFile(task.vaultFileId);
  if (!content.includes(task.vaultLine)) return false;
  const done = task.vaultLine.replace('- [ ]', '- [x]');
  await writeFile(task.vaultFileId, content.replace(task.vaultLine, done));
  return true;
}

// Quick-adds get written back to the capture inbox.
export async function appendToInbox(title) {
  const vid = await getVaultId();
  const inbox = await findChild(vid, '📥 Inbox.md', false);
  if (!inbox) return false;
  const content = await readFile(inbox.id);
  await writeFile(inbox.id, content.replace(/\n*$/, '\n') + `- [ ] ${title}\n`);
  return true;
}

// ---------- memory file (2026 Vault/Second Brain/memory.md) ----------

export async function loadMemoryFile() {
  const vid = await getVaultId();
  const folder = await findChild(vid, 'Second Brain', true);
  if (!folder) return null;
  const f = await findChild(folder.id, 'memory.md', false);
  if (!f) return null;
  return { content: await readFile(f.id), modifiedTime: f.modifiedTime };
}

export async function saveMemoryFile(markdown) {
  const vid = await getVaultId();
  const folderId = await ensureFolder(vid, 'Second Brain');
  const f = await findChild(folderId, 'memory.md', false);
  if (f) await writeFile(f.id, markdown);
  else await createFile(folderId, 'memory.md', markdown);
}
