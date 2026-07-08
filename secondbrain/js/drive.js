// drive.js — Google Drive vault sync via Google Identity Services (client-side OAuth)
// and the Drive v3 REST API. The GIS script is loaded on demand so the app stays
// self-contained offline. Token lives in memory only; client ID in localStorage settings.

const VAULT_PATH = ['Work MacBook Pro', '2026 Vault'];
const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let accessToken = null;
let tokenClient = null;

export function driveConnected() { return Boolean(accessToken); }

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

export async function connectDrive(clientId) {
  if (!clientId) throw new Error('Enter your Google OAuth client ID first.');
  await loadGIS();
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        resolve();
      },
    });
    tokenClient.requestAccessToken();
  });
}

export function disconnectDrive() { accessToken = null; }

async function gfetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { accessToken = null; throw new Error('Google session expired — reconnect Drive.'); }
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
  // Try searching for 2026 Vault directly (works even if parent folder hierarchy isn't visible)
  const q = `name = '2026 Vault' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await gfetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  const data = await res.json();
  if (data.files?.length) {
    vaultId = data.files[0].id;
    return vaultId;
  }
  // Fallback: try the known vault ID directly
  try {
    const testRes = await gfetch(`${API}/files/1JZDW2u4PfBfmrn9Vx-RW1zIUTR_brT8Q?fields=id`);
    if (testRes.ok) {
      vaultId = '1JZDW2u4PfBfmrn9Vx-RW1zIUTR_brT8Q';
      return vaultId;
    }
  } catch {}
  // Fallback to path-based search
  let parent = 'root';
  for (const name of VAULT_PATH) {
    const f = await findChild(parent, name, true);
    if (!f) throw new Error(`Could not find vault. If you have a 2026 Vault folder in your Drive, please share it or check permissions.`);
    parent = f.id;
  }
  vaultId = parent;
  return vaultId;
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
