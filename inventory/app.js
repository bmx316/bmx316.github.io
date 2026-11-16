/* Stockwise — camera inventory. Everything runs on-device. */
(() => {
  'use strict';

  // ---------- Categories ----------
  const CATEGORIES = {
    'Furniture': { color: '#f59e0b', labels: ['chair', 'couch', 'bed', 'dining table', 'bench', 'toilet'] },
    'Electronics': { color: '#3b82f6', labels: ['tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone'] },
    'Appliances': { color: '#8b5cf6', labels: ['microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'hair drier'] },
    'Kitchen & Dining': { color: '#14b8a6', labels: ['bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl'] },
    'Food': { color: '#84cc16', labels: ['banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake'] },
    'Home & Decor': { color: '#ec4899', labels: ['potted plant', 'clock', 'vase', 'teddy bear', 'toothbrush'] },
    'Office & Books': { color: '#06b6d4', labels: ['book', 'scissors'] },
    'Bags & Accessories': { color: '#f97316', labels: ['backpack', 'umbrella', 'handbag', 'tie', 'suitcase'] },
    'Sports & Recreation': { color: '#22c55e', labels: ['frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket'] },
    'Vehicles': { color: '#ef4444', labels: ['bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat'] },
    'Outdoor': { color: '#a3a3a3', labels: ['traffic light', 'fire hydrant', 'stop sign', 'parking meter'] },
    'Animals': { color: '#d97706', labels: ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'] },
    'People': { color: '#64748b', labels: ['person'] },
    'Other': { color: '#94a3b8', labels: [] },
  };
  const LABEL_CAT = {};
  for (const [cat, def] of Object.entries(CATEGORIES)) def.labels.forEach(l => { LABEL_CAT[l] = cat; });
  const catOf = label => LABEL_CAT[label] || 'Other';
  const colorOf = cat => (CATEGORIES[cat] || CATEGORIES.Other).color;

  // ---------- State ----------
  const KEY = 'stockwise.v1';
  const DEFAULTS = {
    items: [],
    rooms: ['Living room', 'Kitchen', 'Bedroom', 'Office', 'Garage'],
    room: '',
    settings: { threshold: 0.55, ignorePeople: true, ignoreAnimals: false, hiAcc: false },
  };
  let state = load();
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && Array.isArray(raw.items)) {
        return { ...DEFAULTS, ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
      }
    } catch (e) { /* fall through to defaults */ }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // Storage full: drop thumbnails and retry so the inventory itself survives.
      try {
        const slim = { ...state, items: state.items.map(i => ({ ...i, thumb: '' })) };
        localStorage.setItem(KEY, JSON.stringify(slim));
      } catch (e2) { /* storage unavailable (private mode) — keep working in memory */ }
    }
  }
  window.addEventListener('pagehide', saveNow);

  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const roomName = r => r || 'Unassigned';
  const totalQty = () => state.items.reduce((n, i) => n + i.qty, 0);
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- Inventory mutations ----------
  function addDetection(label, score, thumb) {
    let item = state.items.find(i => i.label === label && i.room === state.room);
    const now = Date.now();
    if (!item) {
      item = { id: uid(), label, name: label, category: catOf(label), room: state.room, qty: 0, conf: 0, thumb: '', notes: '', created: now, updated: now };
      state.items.push(item);
    }
    item.qty += 1;
    item.updated = now;
    if (score > item.conf) {
      item.conf = score;
      if (thumb) item.thumb = thumb;
    }
    save();
    return item;
  }
  function allowed(label) {
    const cat = catOf(label);
    if (cat === 'People' && state.settings.ignorePeople) return false;
    if (cat === 'Animals' && state.settings.ignoreAnimals) return false;
    return true;
  }

  // ---------- Model ----------
  const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const COCO_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';
  let model = null, modelBase = '', modelPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = res;
      s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureModel() {
    const base = state.settings.hiAcc ? 'mobilenet_v2' : 'lite_mobilenet_v2';
    if (model && modelBase === base) return Promise.resolve(model);
    if (modelPromise && modelBase === base) return modelPromise;
    modelBase = base;
    model = null;
    modelPromise = (async () => {
      if (!window.tf) await loadScript(TF_URL);
      if (!window.cocoSsd) await loadScript(COCO_URL);
      await window.tf.ready();
      const m = await window.cocoSsd.load({ base });
      if (modelBase === base) model = m;
      return m;
    })();
    modelPromise.catch(() => { modelPromise = null; });
    return modelPromise;
  }

  // ---------- Camera + scanning ----------
  const video = $('video'), overlay = $('overlay'), stage = $('stage');
  const ctx = overlay.getContext('2d');
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropCanvas.height = 96;
  const cropCtx = cropCanvas.getContext('2d');

  let stream = null, facing = 'environment', scanning = false, runId = 0, wakeLock = null;
  let tracks = [], nextTrack = 1, session = {}, sessionCount = 0;

  function setStatus(text, cls) {
    $('statusText').textContent = text;
    $('status').className = 'status' + (cls ? ' ' + cls : '');
  }
  function showCamError(msg) {
    const e = $('camError');
    e.textContent = msg; e.hidden = !msg;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot access the camera. Open the page over HTTPS in Safari or Chrome.');
    }
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    await video.play();
    stage.classList.add('live');
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    stage.classList.remove('live');
  }
  function camErrorText(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'Camera access was blocked. Allow camera permission for this site in your browser settings, then try again.';
    if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) return 'No camera was found on this device. You can still scan a photo using the picture button above.';
    if (e && e.name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
    return (e && e.message) || 'Could not start the camera.';
  }

  async function startScan() {
    if (scanning) return;
    const btn = $('scanBtn');
    btn.disabled = true;
    showCamError('');
    try {
      setStatus('Starting camera…', 'busy');
      const modelLoading = ensureModel();
      modelLoading.catch(() => {});
      if (!stream) await startCamera();
      if (!model) setStatus('Loading detector…', 'busy');
      await modelLoading;
    } catch (e) {
      const camFail = !stream;
      stopCamera();
      setStatus(camFail ? 'Camera unavailable' : 'Detector unavailable', 'bad');
      showCamError(camFail ? camErrorText(e) : 'Could not download the detection model. Check your connection and try again.');
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    scanning = true;
    tracks = []; session = {}; sessionCount = 0;
    renderLive();
    btn.classList.add('on');
    btn.setAttribute('aria-label', 'Stop scanning');
    stage.classList.add('scanning');
    setStatus('Scanning — pan slowly', 'on');
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
    loop(++runId);
  }
  function stopScan(keepCamera) {
    const was = scanning;
    scanning = false;
    runId++;
    tracks = [];
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const btn = $('scanBtn');
    btn.classList.remove('on');
    btn.setAttribute('aria-label', 'Start scanning');
    stage.classList.remove('scanning');
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (!keepCamera) stopCamera();
    setStatus(stream ? 'Paused' : 'Ready', '');
    if (was) {
      saveNow();
      renderAll();
      if (sessionCount) toast(`Added ${sessionCount} item${sessionCount === 1 ? '' : 's'} to ${roomName(state.room)}`);
    }
  }

  async function loop(id) {
    while (scanning && id === runId) {
      if (video.readyState >= 2 && video.videoWidth) {
        let dets = [];
        try {
          dets = await model.detect(video, 25, state.settings.threshold);
        } catch (e) {
          console.error(e);
          stopScan(true);
          setStatus('Detector error', 'bad');
          return;
        }
        if (!scanning || id !== runId) return;
        track(dets.filter(d => allowed(d.class)));
        draw();
      }
      await new Promise(r => requestAnimationFrame(r));
    }
  }

  // Multi-object tracker so an object seen across many frames is counted once.
  // Lost tracks linger as "ghosts" that drift with the estimated camera motion, so an
  // object that flickers out or slides partly off-screen is re-identified, not recounted.
  const CONFIRM_HITS = 3, CONFIRM_MS = 350, GHOST_MS = 2500;
  function overlap(a, b) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const aa = a[2] * a[3], ab = b[2] * b[3];
    return { iou: inter / (aa + ab - inter || 1), min: inter / (Math.min(aa, ab) || 1) };
  }
  function affinity(a, b) {
    const o = overlap(a, b);
    const sa = Math.sqrt(a[2] * a[3]), sb = Math.sqrt(b[2] * b[3]);
    const dx = a[0] + a[2] / 2 - (b[0] + b[2] / 2), dy = a[1] + a[3] / 2 - (b[1] + b[3] / 2);
    const near = 1 - Math.hypot(dx, dy) / (0.7 * (sa + sb) / 2);
    const ratio = sa > sb ? sa / sb : sb / sa;
    // A box mostly inside the other is the same object changing shape at the frame edge.
    if (o.min > 0.6) return o.min + Math.max(0, near) * 0.5;
    if (ratio > 2.2 || (o.iou < 0.2 && near <= 0)) return 0;
    return o.iou + Math.max(0, near) * 0.5;
  }
  function dedupe(dets) {
    const out = [];
    dets.slice().sort((a, b) => b.score - a.score).forEach(d => {
      const dup = out.some(k => {
        if (k.class !== d.class) return false;
        const o = overlap(k.bbox, d.bbox);
        return o.iou > 0.55 || o.min > 0.85;
      });
      if (!dup) out.push(d);
    });
    return out;
  }
  function track(dets) {
    dets = dedupe(dets);
    const now = performance.now();
    const pairs = [];
    dets.forEach((d, di) => tracks.forEach((t, ti) => {
      if (t.label !== d.class) return;
      const a = affinity(d.bbox, t.bbox);
      if (a > 0) pairs.push([a, di, ti]);
    }));
    pairs.sort((p, q) => q[0] - p[0]);
    const usedD = new Set(), usedT = new Set(), moves = [];
    for (const [, di, ti] of pairs) {
      if (usedD.has(di) || usedT.has(ti)) continue;
      usedD.add(di); usedT.add(ti);
      const t = tracks[ti], d = dets[di];
      if (t.fresh) moves.push([d.bbox[0] + d.bbox[2] / 2 - (t.bbox[0] + t.bbox[2] / 2), d.bbox[1] + d.bbox[3] / 2 - (t.bbox[1] + t.bbox[3] / 2)]);
      t.bbox = d.bbox; t.score = d.score; t.best = Math.max(t.best, d.score);
      t.hits++; t.seen = now; t.fresh = true;
    }
    // Estimated camera motion = median shift of the objects we kept hold of.
    const median = i => { const v = moves.map(m => m[i]).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };
    const mx = median(0), my = median(1);
    tracks.forEach((t, ti) => {
      if (usedT.has(ti)) return;
      t.fresh = false;
      t.bbox = [t.bbox[0] + mx, t.bbox[1] + my, t.bbox[2], t.bbox[3]];
    });
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      tracks.push({ id: nextTrack++, label: d.class, bbox: d.bbox, score: d.score, best: d.score, hits: 1, born: now, seen: now, fresh: true, counted: false });
    });
    // Unconfirmed blips are dropped quickly; counted objects are remembered longer.
    tracks = tracks.filter(t => now - t.seen < (t.counted ? GHOST_MS : 700));
    let added = false;
    for (const t of tracks) {
      if (!t.counted && t.fresh && t.hits >= CONFIRM_HITS && now - t.born >= CONFIRM_MS) {
        t.counted = true;
        addDetection(t.label, t.best, crop(video, video.videoWidth, video.videoHeight, t.bbox));
        session[t.label] = (session[t.label] || 0) + 1;
        sessionCount++;
        added = true;
      }
    }
    if (added) {
      if (navigator.vibrate) navigator.vibrate(12);
      renderLive();
      renderCounts();
    }
  }
  function crop(src, sw, sh, [x, y, w, h]) {
    try {
      const side = Math.min(Math.max(w, h) * 1.1, sw, sh);
      const sx = Math.min(Math.max(0, x + w / 2 - side / 2), sw - side);
      const sy = Math.min(Math.max(0, y + h / 2 - side / 2), sh - side);
      cropCtx.drawImage(src, sx, sy, side, side, 0, 0, 96, 96);
      return cropCanvas.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  }

  function draw() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (overlay.width !== vw || overlay.height !== vh) { overlay.width = vw; overlay.height = vh; }
    ctx.clearRect(0, 0, vw, vh);
    // The canvas is scaled by CSS object-fit: cover; convert CSS px to canvas px.
    const k = 1 / Math.max(stage.clientWidth / vw, stage.clientHeight / vh);
    ctx.font = `600 ${13 * k}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const t of tracks) {
      if (!t.fresh) continue;
      const [x, y, w, h] = t.bbox;
      const color = colorOf(catOf(t.label));
      ctx.lineWidth = 2.5 * k;
      ctx.strokeStyle = color;
      ctx.setLineDash(t.counted ? [] : [8 * k, 6 * k]);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10 * k); else ctx.rect(x, y, w, h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (t.counted) { ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1; }
      const text = `${t.label} ${Math.round(t.score * 100)}%`;
      const tw = ctx.measureText(text).width + 14 * k, th = 22 * k;
      const lx = Math.max(0, Math.min(x, vw - tw));
      const ly = Math.min(vh - th, y - th - 4 * k < 0 ? Math.max(0, y) + 4 * k : y - th - 4 * k);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx, ly, tw, th, 6 * k); else ctx.rect(lx, ly, tw, th);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, lx + 7 * k, ly + th / 2 + k);
    }
  }

  function renderLive() {
    const entries = Object.entries(session).sort((a, b) => b[1] - a[1]);
    $('liveChips').innerHTML = entries.map(([label, n]) =>
      `<span class="chip"><i style="background:${colorOf(catOf(label))}"></i>${esc(label)} <b>×${n}</b></span>`).join('');
    $('sessCount').textContent = sessionCount;
  }

  // Still-photo fallback (also handy for a quick one-off shot).
  async function scanPhoto(file) {
    if (!file) return;
    if (scanning) stopScan(true);
    setStatus('Analyzing photo…', 'busy');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const m = await ensureModel();
      const dets = (await m.detect(img, 40, state.settings.threshold)).filter(d => allowed(d.class));
      dets.forEach(d => addDetection(d.class, d.score, crop(img, img.naturalWidth, img.naturalHeight, d.bbox)));
      saveNow();
      renderAll();
      setStatus(stream ? 'Paused' : 'Ready', '');
      toast(dets.length ? `Found ${dets.length} item${dets.length === 1 ? '' : 's'} in the photo` : 'No recognizable items in that photo');
    } catch (e) {
      console.error(e);
      setStatus('Could not analyze photo', 'bad');
      toast('Could not analyze that photo');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- Rendering ----------
  let filterCat = 'All', query = '';

  function renderCounts() {
    const total = totalQty();
    $('totalCount').textContent = total;
    const badge = $('tabBadge');
    badge.textContent = total > 999 ? '999+' : total;
    badge.hidden = !total;
  }
  function groupByCat(items) {
    const groups = {};
    for (const i of items) (groups[i.category] = groups[i.category] || []).push(i);
    const order = Object.keys(CATEGORIES);
    return Object.entries(groups)
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
      .map(([cat, list]) => [cat, list.sort((a, b) => a.name.localeCompare(b.name) || roomName(a.room).localeCompare(roomName(b.room)))]);
  }
  function renderInventory() {
    const total = totalQty();
    $('invSub').textContent = total ? `${total} item${total === 1 ? '' : 's'} · ${state.items.length} type${state.items.length === 1 ? '' : 's'}` : 'No items yet';
    const cats = [...new Set(state.items.map(i => i.category))];
    if (filterCat !== 'All' && !cats.includes(filterCat)) filterCat = 'All';
    $('filters').innerHTML = cats.length > 1
      ? ['All', ...groupByCat(state.items).map(g => g[0])].map(c => `<button class="pill${c === filterCat ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')
      : '';
    const q = query.trim().toLowerCase();
    const items = state.items.filter(i =>
      (filterCat === 'All' || i.category === filterCat) &&
      (!q || `${i.name} ${i.category} ${roomName(i.room)} ${i.notes}`.toLowerCase().includes(q)));
    const list = $('invList');
    if (!items.length) {
      list.innerHTML = `<div class="empty"><svg class="ico"><use href="#i-box"/></svg><b>${state.items.length ? 'No matches' : 'Your inventory is empty'}</b>${state.items.length ? 'Try a different search or filter.' : 'Start a scan to detect items, or add one manually.'}</div>`;
      return;
    }
    list.innerHTML = groupByCat(items).map(([cat, rows]) => `
      <div class="group">
        <div class="group-head"><i style="background:${colorOf(cat)}"></i>${esc(cat)}<em>${rows.reduce((n, i) => n + i.qty, 0)}</em></div>
        <div class="group-body">${rows.map(i => `
          <div class="item" data-id="${esc(i.id)}">
            ${i.thumb ? `<img class="thumb" src="${esc(i.thumb)}" alt="">` : `<div class="thumb">${esc(i.name.charAt(0))}</div>`}
            <button class="item-main" data-act="edit">
              <div class="item-name">${esc(i.name)}</div>
              <div class="item-meta">${esc(roomName(i.room))}${i.conf ? ` · ${Math.round(i.conf * 100)}% match` : ' · added manually'}${i.notes ? ' · ' + esc(i.notes) : ''}</div>
            </button>
            <div class="stepper">
              <button data-act="dec" aria-label="Decrease"><svg class="ico"><use href="#i-minus"/></svg></button>
              <b>${i.qty}</b>
              <button data-act="inc" aria-label="Increase"><svg class="ico"><use href="#i-plus"/></svg></button>
            </div>
          </div>`).join('')}
        </div>
      </div>`).join('');
  }
  function renderExport() {
    const total = totalQty();
    const groups = groupByCat(state.items).map(([cat, rows]) => [cat, rows.reduce((n, i) => n + i.qty, 0)]).sort((a, b) => b[1] - a[1]);
    $('kItems').textContent = total;
    $('kTypes').textContent = state.items.length;
    $('kCats').textContent = groups.length;
    $('kRooms').textContent = new Set(state.items.map(i => i.room)).size;
    const max = groups.length ? groups[0][1] : 1;
    $('breakdown').innerHTML = groups.length
      ? groups.map(([cat, n]) => `<div class="bar-row"><span>${esc(cat)}</span><div class="bar"><i style="width:${Math.max(4, n / max * 100)}%;background:${colorOf(cat)}"></i></div><b>${n}</b></div>`).join('')
      : '<p class="sub">Nothing to summarize yet — scan a space first.</p>';
  }
  function renderRoom() {
    $('roomLabel').textContent = roomName(state.room);
    $('roomList').innerHTML = state.rooms.map(r => `<option value="${esc(r)}">`).join('');
  }
  function renderAll() { renderCounts(); renderInventory(); renderExport(); renderRoom(); }

  // ---------- Navigation ----------
  function show(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    if (view !== 'scan') stopScan(false);
    if (view === 'inventory') renderInventory();
    if (view === 'export') renderExport();
  }
  document.querySelector('.tabbar').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (t) show(t.dataset.view);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(false); });

  // ---------- Sheets ----------
  let openSheet = null;
  function sheet(id) {
    closeSheet();
    openSheet = $(id);
    openSheet.hidden = false;
    $('scrim').hidden = false;
  }
  function closeSheet() {
    if (openSheet) openSheet.hidden = true;
    openSheet = null;
    $('scrim').hidden = true;
  }
  $('scrim').addEventListener('click', closeSheet);
  document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // Item editor
  const itemForm = $('itemForm');
  let editingId = null;
  itemForm.category.innerHTML = Object.keys(CATEGORIES).map(c => `<option>${esc(c)}</option>`).join('');
  function editItem(id) {
    const item = state.items.find(i => i.id === id);
    editingId = item ? id : null;
    $('itemTitle').textContent = item ? 'Edit item' : 'Add item';
    $('itemDelete').hidden = !item;
    itemForm.name.value = item ? item.name : '';
    itemForm.category.value = item ? item.category : 'Other';
    itemForm.qty.value = item ? item.qty : 1;
    itemForm.room.value = item ? item.room : state.room;
    itemForm.notes.value = item ? item.notes : '';
    sheet('itemSheet');
    if (!item) itemForm.name.focus();
  }
  itemForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = itemForm.name.value.trim();
    if (!name) return;
    const room = itemForm.room.value.trim();
    const data = {
      name, room,
      category: itemForm.category.value,
      qty: Math.min(99999, Math.max(1, parseInt(itemForm.qty.value, 10) || 1)),
      notes: itemForm.notes.value.trim(),
      updated: Date.now(),
    };
    if (room && !state.rooms.includes(room)) state.rooms.push(room);
    const item = state.items.find(i => i.id === editingId);
    if (item) Object.assign(item, data);
    else state.items.push({ id: uid(), label: null, conf: 0, thumb: '', created: Date.now(), ...data });
    saveNow();
    closeSheet();
    renderAll();
    toast(item ? 'Item updated' : 'Item added');
  });
  $('itemDelete').addEventListener('click', () => {
    state.items = state.items.filter(i => i.id !== editingId);
    saveNow(); closeSheet(); renderAll();
    toast('Item deleted');
  });
  $('addBtn').addEventListener('click', () => editItem(null));

  $('invList').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.item');
    if (!btn || !row) return;
    const item = state.items.find(i => i.id === row.dataset.id);
    if (!item) return;
    const act = btn.dataset.act;
    if (act === 'edit') return editItem(item.id);
    if (act === 'inc') item.qty++;
    if (act === 'dec') {
      if (item.qty <= 1) {
        if (!confirm(`Remove "${item.name}" from the inventory?`)) return;
        state.items = state.items.filter(i => i !== item);
      } else item.qty--;
    }
    item.updated = Date.now();
    save();
    renderAll();
  });
  $('filters').addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (p) { filterCat = p.dataset.cat; renderInventory(); }
  });
  $('search').addEventListener('input', e => { query = e.target.value; renderInventory(); });

  // Location picker
  function renderRoomChoices() {
    const counts = {};
    state.items.forEach(i => { counts[i.room] = (counts[i.room] || 0) + i.qty; });
    $('roomChoices').innerHTML = ['', ...state.rooms].map(r =>
      `<button class="room-opt${r === state.room ? ' active' : ''}" data-room="${esc(r)}">${esc(roomName(r))}<small>${counts[r] ? counts[r] + ' items' : ''}</small></button>`).join('');
  }
  function setRoom(r) {
    if (scanning) stopScan(true); // close out the current scan before switching location
    state.room = r;
    saveNow(); renderRoom(); closeSheet();
    toast('Location: ' + roomName(r));
  }
  $('roomBtn').addEventListener('click', () => { renderRoomChoices(); sheet('roomSheet'); });
  $('roomChoices').addEventListener('click', e => {
    const b = e.target.closest('.room-opt');
    if (b) setRoom(b.dataset.room);
  });
  $('roomForm').addEventListener('submit', e => {
    e.preventDefault();
    const r = e.target.room.value.trim();
    if (!r) return;
    if (!state.rooms.includes(r)) state.rooms.push(r);
    e.target.reset();
    setRoom(r);
  });

  // Settings
  const thr = $('thr');
  function syncSettings() {
    thr.value = Math.round(state.settings.threshold * 100);
    $('thrOut').textContent = thr.value + '%';
    $('ignorePeople').checked = state.settings.ignorePeople;
    $('ignoreAnimals').checked = state.settings.ignoreAnimals;
    $('hiAcc').checked = state.settings.hiAcc;
  }
  $('settingsBtn').addEventListener('click', () => { syncSettings(); sheet('settingsSheet'); });
  thr.addEventListener('input', () => { state.settings.threshold = thr.value / 100; $('thrOut').textContent = thr.value + '%'; save(); });
  $('ignorePeople').addEventListener('change', e => { state.settings.ignorePeople = e.target.checked; save(); });
  $('ignoreAnimals').addEventListener('change', e => { state.settings.ignoreAnimals = e.target.checked; save(); });
  $('hiAcc').addEventListener('change', e => {
    if (scanning) stopScan(true);
    state.settings.hiAcc = e.target.checked; save();
  });
  $('clearAll').addEventListener('click', () => {
    if (!state.items.length) return toast('Inventory is already empty');
    if (!confirm(`Delete all ${state.items.length} inventory entries? This cannot be undone.`)) return;
    state.items = [];
    saveNow(); closeSheet(); renderAll();
    toast('Inventory cleared');
  });

  // Scan controls
  $('scanBtn').addEventListener('click', () => (scanning ? stopScan(true) : startScan()));
  $('flipBtn').addEventListener('click', async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    if (!stream) return toast(facing === 'user' ? 'Front camera selected' : 'Rear camera selected');
    const resume = scanning;
    if (scanning) stopScan(true);
    try {
      await startCamera();
      if (resume) startScan();
    } catch (e) {
      setStatus('Camera unavailable', 'bad');
      showCamError(camErrorText(e));
    }
  });
  $('photoInput').addEventListener('change', e => { scanPhoto(e.target.files[0]); e.target.value = ''; });

  // ---------- Export ----------
  const stamp = () => new Date().toISOString().slice(0, 10);
  const fmtDate = ms => (ms ? new Date(ms).toLocaleString() : '');
  const sorted = () => groupByCat(state.items).flatMap(g => g[1]);
  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv() {
    const rows = [['Item', 'Category', 'Location', 'Quantity', 'Confidence', 'Notes', 'First recorded', 'Last updated']];
    sorted().forEach(i => rows.push([i.name, i.category, roomName(i.room), i.qty, i.conf ? Math.round(i.conf * 100) + '%' : 'Manual', i.notes, fmtDate(i.created), fmtDate(i.updated)]));
    rows.push([], ['Total items', '', '', totalQty()]);
    return '﻿' + rows.map(r => r.map((c, n) => (n === 3 ? c : csvCell(c))).join(',')).join('\r\n');
  }
  function buildJson() {
    return JSON.stringify({
      app: 'Stockwise', exported: new Date().toISOString(), totalItems: totalQty(),
      items: sorted().map(i => ({ name: i.name, category: i.category, location: roomName(i.room), quantity: i.qty, confidence: i.conf || null, notes: i.notes, created: new Date(i.created).toISOString(), updated: new Date(i.updated).toISOString() })),
    }, null, 2);
  }
  function buildText() {
    const lines = [`Inventory — ${new Date().toLocaleDateString()}`, `${totalQty()} items, ${state.items.length} types`, ''];
    groupByCat(state.items).forEach(([cat, rows]) => {
      lines.push(`${cat} (${rows.reduce((n, i) => n + i.qty, 0)})`);
      rows.forEach(i => lines.push(`  ${i.qty} × ${i.name} — ${roomName(i.room)}${i.notes ? ' — ' + i.notes : ''}`));
      lines.push('');
    });
    return lines.join('\n').trim();
  }
  function download(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function buildReport() {
    const groups = groupByCat(state.items);
    $('printArea').innerHTML = `
      <div class="rp-head"><h1>Inventory Report</h1><p>Generated ${esc(new Date().toLocaleString())}<br>Stockwise</p></div>
      <div class="rp-kpis"><span><b>${totalQty()}</b>items</span><span><b>${state.items.length}</b>item types</span><span><b>${groups.length}</b>categories</span><span><b>${new Set(state.items.map(i => i.room)).size}</b>locations</span></div>
      ${groups.map(([cat, rows]) => `
        <h2>${esc(cat)} — ${rows.reduce((n, i) => n + i.qty, 0)}</h2>
        <table><thead><tr><th style="width:38px"></th><th>Item</th><th>Location</th><th>Notes</th><th class="n">Qty</th></tr></thead><tbody>
        ${rows.map(i => `<tr><td>${i.thumb ? `<img src="${esc(i.thumb)}" alt="">` : ''}</td><td>${esc(i.name)}</td><td>${esc(roomName(i.room))}</td><td class="note">${esc(i.notes)}</td><td class="n">${i.qty}</td></tr>`).join('')}
        </tbody></table>`).join('')}`;
  }
  async function doExport(kind) {
    if (!state.items.length) return toast('Nothing to export yet — scan or add items first');
    const base = `inventory-${stamp()}`;
    if (kind === 'csv') { download(base + '.csv', 'text/csv;charset=utf-8', buildCsv()); toast('Spreadsheet downloaded'); }
    else if (kind === 'json') { download(base + '.json', 'application/json', buildJson()); toast('JSON downloaded'); }
    else if (kind === 'pdf') { buildReport(); setTimeout(() => window.print(), 50); }
    else if (kind === 'copy') {
      try { await navigator.clipboard.writeText(buildText()); toast('Summary copied'); }
      catch (e) { download(base + '.txt', 'text/plain', buildText()); toast('Summary downloaded'); }
    } else if (kind === 'share') {
      const file = new File([buildCsv()], base + '.csv', { type: 'text/csv' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Inventory', text: `Inventory — ${totalQty()} items` });
        else if (navigator.share) await navigator.share({ title: 'Inventory', text: buildText() });
        else { download(base + '.csv', 'text/csv;charset=utf-8', buildCsv()); toast('Sharing not supported here — downloaded instead'); }
      } catch (e) {
        if (e.name !== 'AbortError') { download(base + '.csv', 'text/csv;charset=utf-8', buildCsv()); toast('Downloaded instead'); }
      }
    }
  }
  $('view-export').addEventListener('click', e => {
    const b = e.target.closest('[data-export]');
    if (b) doExport(b.dataset.export);
  });

  renderAll();
})();
