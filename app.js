/* ════════════════════════════════════════════════════════════════════════════
   Live Slides · host screen + phone viewers   — no build step
   Sync: Firebase Realtime Database (FIREBASE_URL below). No server of your own.

   slideRooms/<CODE>/meta                 { title, count, aspect, ready, createdAt }
   slideRooms/<CODE>/state                { phase: 'lobby' | 'live', idx }
   slideRooms/<CODE>/images/<i>           slide i as a JPEG data URL
   slideRooms/<CODE>/ink/<i>/<strokeId>   { s: 'pen|#hex', p: { k00000: 'x,y,x,y,…' } }   x,y = 0…10000 across the slide
   slideRooms/<CODE>/laser                { x, y } or null
   slideRooms/<CODE>/viewers/<device>     true while that phone is connected
   slideRoomIndex/<CODE>                  created time (rooms older than ROOM_TTL_MS are deleted when a new room is made)
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ════ CONFIG ════════════════════════════════════════════════════════════════ */
// Your Firebase Realtime Database URL. This is the Our City database; the slides live under their own
// paths (slideRooms/, slideRoomIndex/) so they never touch the game's data. Swap in a new project's URL if you prefer.
const FIREBASE_URL = 'https://zoolanders-gcks-default-rtdb.firebaseio.com/';
const APP_NAME = 'Zoolanders';

const ROOT = 'slideRooms', INDEX = 'slideRoomIndex';
const ROOM_TTL_MS = 48 * 3600 * 1000;   // rooms are cleaned up after two days
const SLIDE_PX = 1920;                  // long edge of each slide image
const JPEG_Q = 0.82;
const MAX_SLIDES = 150;
const COLORS = ['#e5383b', '#ffd23f', '#8dc63f', '#29abe2', '#ffffff', '#26262a'];
const PEN_W = 0.0045, HL_W = 0.024;     // line widths as a fraction of slide width, so they look the same on every screen
const ERASE_R = 0.018;
const FLUSH_MS = 45;                    // how often a stroke in progress is sent to phones
const LASER_MS = 40;

const FB_APP = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
const FB_DB = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const QRJS = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

/* ════ HELPERS ═══════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const baseURL = () => location.origin + location.pathname.replace(/index\.html$/, '');
const joinURL = code => baseURL() + '?room=' + code;
const shortBase = () => baseURL().replace(/^https?:\/\//, '').replace(/\/$/, '');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  prev: svg('<path d="M15 18l-6-6 6-6"/>'),
  next: svg('<path d="M9 6l6 6-6 6"/>'),
  pen: svg('<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>'),
  hl: svg('<path d="M15 4l5 5-8 8H7v-5z"/><path d="M4 21h16"/>'),
  eraser: svg('<path d="M8 20h12"/><path d="M5.6 15.4l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H8.4z"/><path d="M9.5 10.5l4 4"/>'),
  laser: svg('<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7.5" opacity=".55"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  clear: svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/>'),
  fs: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>'),
  end: svg('<path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>')
};

const scripts = {};
function loadScript(src) {
  if (!scripts[src]) scripts[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete scripts[src]; rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return scripts[src];
}
function withTimeout(p, ms, msg) {
  let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg || 'timeout')), ms); })]).finally(() => clearTimeout(t));
}
function friendlyError(err) {
  const m = String(err && (err.code || err.message) || err);
  if (/permission/i.test(m)) return 'The database refused access. In the Firebase console, open Realtime Database → Rules and add the rules from database.rules.json.';
  if (/timeout|reach/i.test(m)) return 'Could not reach the database. Check FIREBASE_URL in app.js and your internet connection.';
  return m;
}
function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'fixed left-1/2 -translate-x-1/2 top-6 z-[100] px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl pop max-w-[92vw] text-center ' +
    (kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white');
  t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
let lastWriteErr = 0;
const writeErr = err => { if (Date.now() - lastWriteErr > 5000) { lastWriteErr = Date.now(); toast(friendlyError(err), 'error'); } };

/** Keep the screen awake so phones don't dim or lock mid-talk, whether or not they're in full screen.
    Uses the Wake Lock API where the browser has it. On iPhone and iPad it also loops a tiny silent video,
    the long-standing way to stop iOS from sleeping, because Wake Lock there is missing on older versions
    and unreliable from home-screen icons. Both are re-armed on every tap and whenever the page comes back. */
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const NOSLEEP_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMrbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAThzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMACDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAApAAAAKQAAAABhzdHRzAAAAAAAAAAEAAAACAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAAChgAAAAoAAAAUc3RjbwAAAAAAAAABAAADWwAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAAKYbWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAOZYiEBb///w9FAAFPf4AAAAAGQZo4CvqA';
function keepAwake() {
  let lock = null, asking = false, stopped = false, vid = null;
  const loopVideo = () => {
    if (!vid) {
      vid = document.createElement('video');
      vid.className = 'vfs-video'; vid.muted = true; vid.loop = true; vid.playsInline = true;
      vid.setAttribute('muted', ''); vid.setAttribute('playsinline', ''); vid.setAttribute('aria-hidden', 'true');
      vid.src = NOSLEEP_MP4;
      document.body.appendChild(vid);
    }
    if (vid.paused) vid.play().catch(() => {});
  };
  const grab = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    if (IS_IOS || !('wakeLock' in navigator)) loopVideo();
    if ('wakeLock' in navigator && !lock && !asking) {
      asking = true;
      try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      catch { loopVideo(); }   // refused (e.g. needs a tap first): fall back to the video until the next try
      finally { asking = false; }
    }
  };
  const onVis = () => { if (document.visibilityState === 'visible') grab(); };
  document.addEventListener('visibilitychange', onVis);
  document.addEventListener('pointerdown', grab, true);   // a tap counts as permission on browsers that need one
  const recheck = setInterval(grab, 15000);
  grab();
  return () => {
    stopped = true; clearInterval(recheck);
    document.removeEventListener('visibilitychange', onVis); document.removeEventListener('pointerdown', grab, true);
    try { lock && lock.release(); } catch {}
    if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); vid.remove(); }
  };
}

const fsRoot = document.documentElement;
const canFS = !!((fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
/* iPhone Safari has no full screen for web pages, only for videos. So on iPhone the slide is drawn into a canvas,
   turned into a live video stream, and played in iPhone's own full-screen video player. */
const canVideoFS = !canFS && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype
  && typeof HTMLVideoElement !== 'undefined' && 'webkitEnterFullscreen' in HTMLVideoElement.prototype;
const VIDEO_PX = 1600;   // long edge of the iPhone full-screen video
const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function toggleFS() {
  try {
    if (isFS()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const p = (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen).call(fsRoot);
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

/* Everything a screen sets up is undone here before the next screen is drawn. */
let teardown = [];
function cleanup() { teardown.splice(0).forEach(f => { try { f(); } catch {} }); document.body.className = ''; }
function onEl(el, ev, fn, opt) { el.addEventListener(ev, fn, opt); teardown.push(() => el.removeEventListener(ev, fn, opt)); }

/* ════ FIREBASE ══════════════════════════════════════════════════════════════ */
let db = null;
async function getDB() {
  if (db) return db;
  await loadScript(FB_APP); await loadScript(FB_DB);
  const fa = firebase.apps.length ? firebase.app() : firebase.initializeApp({ databaseURL: FIREBASE_URL });
  db = firebase.database(fa);
  return db;
}
const R = (code, p) => db.ref(ROOT + '/' + code + (p ? '/' + p : ''));
const once = (ref, ms = 15000) => withTimeout(ref.once('value'), ms, 'timeout').then(s => s.val());
function listen(ref, cb, onErr) {
  const h = s => cb(s.val());
  ref.on('value', h, err => onErr && onErr(err));
  teardown.push(() => ref.off('value', h));
}
/** Calls cb(true/false) as the device goes on/offline and shows a small pill while it is offline. */
function watchConnection(cb) {
  const ref = db.ref('.info/connected');
  let pill = null, seen = false, t = 0;
  const h = s => {
    const on = !!s.val();
    if (on) seen = true;
    clearTimeout(t);
    if (on) { pill && pill.remove(); pill = null; }
    else if (seen) t = setTimeout(() => {   // brief blips are normal, only show it if it lasts
      if (!pill) { pill = document.createElement('div'); pill.className = 'conn-pill pop'; pill.textContent = 'Reconnecting…'; document.body.appendChild(pill); }
    }, 1500);
    cb && cb(on);
  };
  ref.on('value', h);
  teardown.push(() => { ref.off('value', h); clearTimeout(t); pill && pill.remove(); });
}

/* Slide images: each one is downloaded once per device and kept in memory. */
const slideCache = new Map();
function getSlide(code, i) {
  const k = code + '/' + i;
  if (!slideCache.has(k)) {
    const p = once(R(code, 'images/' + i), 60000).then(v => { if (!v) throw new Error('missing slide'); return v; });
    p.catch(() => slideCache.delete(k));
    slideCache.set(k, p);
  }
  return slideCache.get(k);
}
function primeSlides(code, images) { images.forEach((d, i) => slideCache.set(code + '/' + i, Promise.resolve(d))); }
/** Download every slide, starting at `from`, two at a time. */
function preloadAll(code, count, from, onProgress) {
  let alive = true; teardown.push(() => { alive = false; });
  const order = []; for (let k = 0; k < count; k++) order.push((from + k) % count);
  let done = 0;
  const worker = async () => {
    while (alive && order.length) {
      const i = order.shift();
      try { await getSlide(code, i); } catch {}
      done++; if (alive && onProgress) onProgress(done, count);
    }
  };
  return Promise.all([worker(), worker()]);
}

/* ════ TURNING A CANVA EXPORT INTO SLIDE IMAGES ══════════════════════════════ */
const isPDF = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImg = f => /^image\/(png|jpe?g|webp)$/i.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);

function canvasToJpeg(drawFn, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  return Promise.resolve(drawFn(x, c)).then(() => { const url = c.toDataURL('image/jpeg', JPEG_Q); c.width = c.height = 0; return url; });
}
async function slidesFromFiles(files, onProg) {
  const pdf = files.find(isPDF);
  const out = []; let aspect = 16 / 9;
  if (pdf) {
    await loadScript(PDFJS);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjsLib.getDocument({ data: await pdf.arrayBuffer() }).promise;
    const n = Math.min(doc.numPages, MAX_SLIDES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: SLIDE_PX / Math.max(v1.width, v1.height) });
      const w = Math.round(vp.width), h = Math.round(vp.height);
      if (i === 1) aspect = w / h;
      out.push(await canvasToJpeg(x => page.render({ canvasContext: x, viewport: vp }).promise, w, h));
      page.cleanup(); onProg(i, n);
    }
    doc.destroy();
  } else {
    const imgs = files.filter(isImg).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, MAX_SLIDES);
    if (!imgs.length) throw new Error('Choose a PDF, or PNG / JPG images of your slides.');
    for (let i = 0; i < imgs.length; i++) {
      const url = URL.createObjectURL(imgs[i]);
      try {
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read ' + imgs[i].name)); im.src = url; });
        const s = Math.min(1, SLIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        if (i === 0) aspect = w / h;
        out.push(await canvasToJpeg(x => x.drawImage(img, 0, 0, w, h), w, h));
      } finally { URL.revokeObjectURL(url); }
      onProg(i + 1, imgs.length);
    }
  }
  if (!out.length) throw new Error('That file has no pages.');
  return { images: out, aspect };
}

/** Delete rooms older than ROOM_TTL_MS so the database stays small. */
async function sweepOldRooms() {
  try {
    const idx = await once(db.ref(INDEX)) || {}, now = Date.now(), ups = {};
    for (const [c, t] of Object.entries(idx)) if (typeof t !== 'number' || now - t > ROOM_TTL_MS) { ups[ROOT + '/' + c] = null; ups[INDEX + '/' + c] = null; }
    if (Object.keys(ups).length) await db.ref().update(ups);
  } catch {}
}
async function createRoom(title, deck, onProg, iphoneFS = true) {
  await getDB();
  await sweepOldRooms();
  let code = null;
  for (let t = 0; t < 12 && !code; t++) { const c = randCode(); if ((await once(db.ref(INDEX + '/' + c))) == null) code = c; }
  if (!code) throw new Error('Could not find a free room code. Try again.');
  const TS = firebase.database.ServerValue.TIMESTAMP, n = deck.images.length;
  await withTimeout(db.ref().update({
    [INDEX + '/' + code]: TS,
    [ROOT + '/' + code + '/meta']: { title, count: n, aspect: deck.aspect, iphoneFS: !!iphoneFS, ready: false, createdAt: TS },
    [ROOT + '/' + code + '/state']: { phase: 'lobby', idx: 0 }
  }), 20000, 'timeout');
  let done = 0;
  await Promise.all(deck.images.map((d, i) => R(code, 'images/' + i).set(d).then(() => onProg(++done, n))));
  await R(code, 'meta/ready').set(true);
  return code;
}
function rememberHosted(code, add = true) {
  const list = store.get('ls:hosted', []).filter(c => c !== code);
  if (add) list.unshift(code);
  store.set('ls:hosted', list.slice(0, 5));
}

/* ════ THE SLIDE STAGE (shared by host and phones) ══════════════════════════ */
function parseStrokes(val) {
  return Object.keys(val || {}).sort().map(id => {
    const v = val[id] || {};
    const [mode, col] = String(v.s || 'pen|' + COLORS[0]).split('|');
    const ch = v.p || {};
    const nums = Object.keys(ch).sort().map(k => ch[k]).join(',').split(',').filter(Boolean).map(Number);
    const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] / 1e4, nums[i + 1] / 1e4]);
    return { id, mode: mode === 'hl' ? 'hl' : 'pen', color: /^#[0-9a-f]{3,8}$/i.test(col) ? col : COLORS[0], pts };
  });
}

function createStage(parent) {
  parent.insertAdjacentHTML('beforeend', `
    <div class="stage-wrap"><div class="stage">
      <img class="stage-img" alt="" draggable="false"><canvas class="stage-ink"></canvas><div class="laser" hidden></div>
      <div class="stage-msg" hidden></div>
    </div></div>`);
  const wrap = parent.lastElementChild, st = $('.stage', wrap), img = $('.stage-img', wrap), cv = $('canvas', wrap),
    ctx = cv.getContext('2d'), laser = $('.laser', wrap), msg = $('.stage-msg', wrap);
  let aspect = 16 / 9, W = 0, H = 0, dpr = 1, strokes = [], local = null, raf = 0, token = 0, laserP = null, imgReady = false;
  const watchers = new Set(), changed = () => watchers.forEach(f => f());

  function fit() {
    const vw = wrap.clientWidth, vh = wrap.clientHeight; if (!vw || !vh) return;
    let w = vw, h = vw / aspect; if (h > vh) { h = vh; w = vh * aspect; }
    W = Math.floor(w); H = Math.floor(h);
    st.style.width = W + 'px'; st.style.height = H + 'px';
    st.style.setProperty('--ls', Math.max(10, W * 0.013) + 'px');
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    draw();
  }
  function paint(s, c = ctx, W_ = W, H_ = H) {
    const p = s.pts; if (!p.length) return;
    const ctx = c, W = W_, H = H_;
    const lw = (s.mode === 'hl' ? HL_W : PEN_W) * W;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lw;
    ctx.strokeStyle = ctx.fillStyle = s.color; ctx.globalAlpha = s.mode === 'hl' ? 0.38 : 1;
    ctx.beginPath();
    if (p.length === 1) { ctx.arc(p[0][0] * W, p[0][1] * H, lw / 2, 0, Math.PI * 2); ctx.fill(); }
    else {   // one path per stroke so highlighter never darkens where it overlaps itself
      ctx.moveTo(p[0][0] * W, p[0][1] * H);
      for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0] * W, p[i][1] * H, (p[i][0] + p[i + 1][0]) / 2 * W, (p[i][1] + p[i + 1][1]) / 2 * H);
      const l = p[p.length - 1]; ctx.lineTo(l[0] * W, l[1] * H); ctx.stroke();
    }
    ctx.restore();
  }
  function draw() {
    raf = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const s of strokes) if (!local || s.id !== local.id) paint(s);
    if (local) paint(local);
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const ro = new ResizeObserver(fit); ro.observe(wrap);
  teardown.push(() => { ro.disconnect(); cancelAnimationFrame(raf); });

  return {
    el: st,
    get aspect() { return aspect; },
    setAspect(a) { if (a > 0 && isFinite(a)) { aspect = a; fit(); } },
    async show(promise) {
      const t = ++token;
      img.style.visibility = 'hidden'; imgReady = false; changed();
      const slow = setTimeout(() => { if (t === token) { msg.textContent = 'Loading slide…'; msg.hidden = false; } }, 350);
      try {
        const src = await promise; if (t !== token) return;
        img.src = src;
        try { await img.decode(); } catch {}
        if (t !== token) return;
        img.style.visibility = ''; msg.hidden = true; imgReady = true; changed();
      } catch {
        if (t === token) { msg.textContent = 'This slide could not load. It will retry on the next change.'; msg.hidden = false; }
      } finally { clearTimeout(slow); }
    },
    setStrokes(list) { strokes = list; redraw(); changed(); },
    setLocal(s) { local = s; redraw(); changed(); },
    /** Draw the whole slide (image, drawings, laser) onto another canvas: used for the iPhone video. */
    compose(c, w, h) {
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      if (imgReady && img.naturalWidth) c.drawImage(img, 0, 0, w, h);
      for (const s of strokes) paint(s, c, w, h);
      if (laserP) {
        const r = Math.max(6, w * 0.0065), x = laserP[0] * w, y = laserP[1] * h;
        c.save(); c.fillStyle = '#ff2b2b'; c.shadowColor = 'rgba(255,43,43,.85)'; c.shadowBlur = r * 2.6;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.restore();
      }
    },
    onChange(f) { watchers.add(f); return () => watchers.delete(f); },
    setLaser(p) {
      laserP = p; changed();
      if (!p) { laser.hidden = true; return; }
      laser.hidden = false; laser.style.left = p[0] * 100 + '%'; laser.style.top = p[1] * 100 + '%';
    },
    toNorm(e) { const r = st.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; }
  };
}

/* ════ SCREENS ═══════════════════════════════════════════════════════════════ */
const loadingScreen = text => `
  <div class="min-h-[100dvh] bg-grid grid place-items-center px-6">
    <div class="text-center"><div class="wordmark text-slate-600 text-2xl">${esc(APP_NAME)}</div>
    <p class="text-slate-500 font-semibold mt-4">${esc(text)}<span class="dot-a">.</span><span class="dot-b">.</span><span class="dot-c">.</span></p></div>
  </div>`;

/* ---- Home: host a deck or join with a code ---- */
function showLanding(notice, prefill = '') {
  cleanup();
  document.title = APP_NAME;
  const resume = store.get('ls:hosted', [])[0] || null;
  app.innerHTML = `
  <div class="min-h-[100dvh] bg-grid flex flex-col">
    <main class="flex-1 grid place-items-center px-4 py-8">
      <div class="w-full max-w-xl">
        <h1 class="wordmark text-3xl md:text-5xl text-slate-600 text-center mb-6">${esc(APP_NAME)}</h1>
        ${notice ? `<div class="mb-5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 pop" role="alert">${esc(notice)}</div>` : ''}
        <section class="panel p-6 md:p-8">
          <h2 class="text-2xl md:text-3xl font-semibold text-white leading-tight">Host a presentation</h2>
          <p class="text-slate-300 mt-3 leading-relaxed">Upload your Canva deck. Project this screen, and everyone who scans the code follows along on their phone, including anything you draw.</p>
          <label class="lbl !text-slate-300 mt-6" for="hTitle">Presentation title</label>
          <input id="hTitle" class="field" maxlength="60" placeholder="State of the City 2026" autocomplete="off">
          <div class="mt-4">
            <input type="file" id="hFile" class="sr-only" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" multiple>
            <label for="hFile" id="hDrop" class="dropzone">
              ${I.upload}
              <span id="hInfo" class="font-semibold text-white">Choose your slides</span>
              <span id="hSub" class="text-xs text-slate-300">PDF from Canva, or PNG / JPG images (one per slide). You can also drop them here.</span>
            </label>
          </div>
          <label class="flex items-start gap-3 mt-5 cursor-pointer select-none">
            <input type="checkbox" id="hIphone" class="check mt-0.5" ${store.get('ls:iphoneFS', true) ? 'checked' : ''}>
            <span><span class="block font-semibold text-white">Full screen on iPhones</span>
            <span class="block text-xs text-slate-300 mt-0.5 leading-relaxed">Gives iPhone viewers a full-screen button that plays the slides in iPhone’s video player. You can change this later on the join screen.</span></span>
          </label>
          <div id="hProg" class="mt-5" hidden>
            <div class="h-2 rounded-full bg-white/15 overflow-hidden"><div id="hBar" class="h-full rounded-full" style="width:0;background:var(--accent);transition:width .2s"></div></div>
            <div id="hProgTxt" class="text-sm text-slate-300 font-semibold mt-2" aria-live="polite"></div>
          </div>
          <div id="hErr" class="mt-4 rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3" role="alert" hidden></div>
          <div class="pt-6 space-y-3">
            <button data-act="create" class="btn btn-green w-full !text-lg !py-4" disabled>Create room</button>
            ${resume ? `<button data-act="resume" class="btn btn-ghost w-full">Resume room <span class="num font-bold tracking-widest">${esc(resume)}</span></button>` : ''}
          </div>
        </section>
        <section class="card p-5 md:p-6 mt-5">
          <h2 class="text-lg font-semibold text-slate-700">Join a presentation</h2>
          <p class="text-sm text-slate-500 mt-1">Type the four-letter code shown on the big screen.</p>
          <div class="flex gap-2 mt-3">
            <input id="jCode" class="field num !text-xl font-bold tracking-[.4em] uppercase text-center" maxlength="4" placeholder="ABCD" value="${esc(prefill)}"
              autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Room code">
            <button data-act="join" class="btn btn-dark !px-6">Join</button>
          </div>
        </section>
      </div>
    </main>
  </div>`;

  let files = null, busy = false;
  const fileIn = $('#hFile'), drop = $('#hDrop'), createBtn = $('[data-act=create]'), err = $('#hErr');
  const setFiles = list => {
    const arr = [...list], pdf = arr.find(isPDF), imgs = arr.filter(isImg);
    files = pdf ? [pdf] : imgs.length ? imgs : null;
    $('#hInfo').textContent = !arr.length ? 'Choose your slides' : files ? (pdf ? pdf.name : imgs.length + (imgs.length === 1 ? ' image' : ' images')) : 'That file type won’t work';
    $('#hSub').textContent = files ? 'Click to choose a different file.' : 'Use a PDF from Canva, or PNG / JPG images.';
    drop.classList.toggle('has-file', !!files);
    createBtn.disabled = !files || busy;
    err.hidden = true;
  };
  onEl(fileIn, 'change', () => setFiles(fileIn.files));
  onEl(drop, 'dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  onEl(drop, 'dragleave', () => drop.classList.remove('over'));
  onEl(drop, 'drop', e => { e.preventDefault(); drop.classList.remove('over'); if (!busy) setFiles(e.dataTransfer.files); });

  const setProg = (txt, f) => { $('#hProg').hidden = false; $('#hProgTxt').textContent = txt; $('#hBar').style.width = Math.round(f * 100) + '%'; };
  async function create() {
    if (!files || busy) return;
    busy = true; createBtn.disabled = true; err.hidden = true; fileIn.disabled = true;
    const title = $('#hTitle').value.trim() || 'Presentation';
    try {
      setProg('Connecting', 0.02);
      await withTimeout(getDB(), 20000, 'timeout');
      const deck = await slidesFromFiles(files, (i, n) => setProg(`Preparing slide ${i} of ${n}`, 0.05 + 0.45 * i / n));
      const iphoneFS = $('#hIphone').checked; store.set('ls:iphoneFS', iphoneFS);
      const code = await createRoom(title, deck, (i, n) => setProg(`Uploading slide ${i} of ${n}`, 0.5 + 0.5 * i / n), iphoneFS);
      primeSlides(code, deck.images);
      rememberHosted(code);
      history.pushState(null, '', '?host=' + code);
      showHost(code);
    } catch (e) {
      busy = false; fileIn.disabled = false; createBtn.disabled = !files;
      $('#hProg').hidden = true; err.textContent = friendlyError(e); err.hidden = false;
    }
  }
  const join = () => {
    const c = cleanCode($('#jCode').value);
    if (c.length !== 4) { $('#jCode').focus(); toast('Room codes have four letters.'); return; }
    history.pushState(null, '', '?room=' + c); showViewer(c);
  };
  onEl(app, 'click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'create') create();
    else if (b.dataset.act === 'join') join();
    else if (b.dataset.act === 'resume') { history.pushState(null, '', '?host=' + resume); showHost(resume); }
  });
  onEl($('#jCode'), 'input', e => { e.target.value = cleanCode(e.target.value); });
  onEl($('#jCode'), 'keydown', e => { if (e.key === 'Enter') join(); });
}

/* ---- Host: lobby with QR, then the full-screen presenter ---- */
async function showHost(code) {
  cleanup();
  app.innerHTML = loadingScreen('Opening room ' + code);
  let meta;
  try { await withTimeout(getDB(), 20000, 'timeout'); meta = await once(R(code, 'meta')); }
  catch (e) { return showLanding(friendlyError(e)); }
  if (!meta) { rememberHosted(code, false); history.replaceState(null, '', baseURL()); return showLanding(`Room ${code} has ended. Create a new one.`); }
  rememberHosted(code);
  document.title = meta.title + ' | ' + APP_NAME;
  document.body.classList.add('host');

  const count = Math.max(1, meta.count | 0);
  let phase = 'lobby', idx = -1, strokes = [], viewers = 0, tool = 'none', color = COLORS[0], qrOpen = false, ovMode = null;

  app.innerHTML = `<div id="hStage"></div><div id="hOverlay"></div>
    <div id="tb" class="tb" role="toolbar" aria-label="Presenter controls" hidden>
      <button class="tb-btn" data-act="prev" title="Previous slide (←)" aria-label="Previous slide">${I.prev}</button>
      <div class="tb-count num" id="tbCount" aria-live="polite"></div>
      <button class="tb-btn" data-act="next" title="Next slide (→ or Space)" aria-label="Next slide">${I.next}</button>
      <span class="tb-sep"></span>
      <button class="tb-btn" data-tool="pen" title="Pen (P)" aria-label="Pen" aria-pressed="false">${I.pen}</button>
      <button class="tb-btn" data-tool="hl" title="Highlighter (H)" aria-label="Highlighter" aria-pressed="false">${I.hl}</button>
      <button class="tb-btn" data-tool="eraser" title="Eraser (E)" aria-label="Eraser" aria-pressed="false">${I.eraser}</button>
      <button class="tb-btn" data-tool="laser" title="Laser pointer (L)" aria-label="Laser pointer" aria-pressed="false">${I.laser}</button>
      <span class="tb-sep"></span>
      ${COLORS.map(c => `<button class="sw" data-color="${c}" style="background:${c}" title="Ink color" aria-label="Ink color ${c}" aria-pressed="false"></button>`).join('')}
      <span class="tb-sep"></span>
      <button class="tb-btn" data-act="undo" title="Undo last drawing (Z)" aria-label="Undo">${I.undo}</button>
      <button class="tb-btn" data-act="clear" title="Clear drawings on this slide (C)" aria-label="Clear drawings on this slide">${I.clear}</button>
      <span class="tb-sep"></span>
      <span class="tb-viewers" title="Phones connected">${I.users}<span id="tbViewers" class="num">0</span></span>
      <button class="tb-btn" data-act="qr" title="Show join code (Q)" aria-label="Show join code">${I.qr}</button>
      ${canFS ? `<button class="tb-btn" data-act="fs" title="Full screen (F)" aria-label="Full screen">${I.fs}</button>` : ''}
      <button class="tb-btn" data-act="end" title="End presentation" aria-label="End presentation">${I.end}</button>
    </div>`;
  const stage = createStage($('#hStage'));
  stage.setAspect(meta.aspect);
  const tb = $('#tb'), ov = $('#hOverlay');
  teardown.push(keepAwake());
  watchConnection();
  preloadAll(code, count, 0);

  /* --- sync --- */
  let inkRef = null, inkH = null;
  const watchInk = i => {
    if (inkRef) inkRef.off('value', inkH);
    inkRef = R(code, 'ink/' + i);
    inkH = s => { if (i === idx) { strokes = parseStrokes(s.val()); stage.setStrokes(strokes); } };
    inkRef.on('value', inkH);
  };
  teardown.push(() => inkRef && inkRef.off('value', inkH));
  listen(R(code, 'state'), v => {
    v = v || {};
    phase = v.phase === 'live' ? 'live' : 'lobby';
    const ni = clamp(v.idx | 0, 0, count - 1);
    if (ni !== idx) { idx = ni; strokes = []; stage.setStrokes([]); stage.show(getSlide(code, idx)); watchInk(idx); }
    render();
  }, writeErr);
  listen(R(code, 'viewers'), v => {
    const n = v ? Object.keys(v).length : 0, grew = n > viewers; viewers = n;
    $('#tbViewers').textContent = n;
    const oc = $('#ovCount'); if (oc) { oc.textContent = n; if (grew) { oc.parentElement.classList.remove('bump'); void oc.offsetWidth; oc.parentElement.classList.add('bump'); } }
  });
  listen(R(code, 'meta'), v => {
    if (!v) { if (idx >= 0) { rememberHosted(code, false); history.replaceState(null, '', baseURL()); showLanding('This room was ended.'); } return; }
    meta.iphoneFS = v.iphoneFS !== false;
    const cb = $('#ovIphone'); if (cb) cb.checked = meta.iphoneFS;
  });

  /* --- render --- */
  function render() {
    tb.hidden = phase !== 'live';
    $('#tbCount').textContent = `${idx + 1} / ${count}`;
    $('[data-act=prev]', tb).disabled = idx <= 0;
    $('[data-act=next]', tb).disabled = idx >= count - 1;
    $$('[data-tool]', tb).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    $$('[data-color]', tb).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
    stage.el.className = 'stage tool-' + tool;
    renderOverlay();
  }
  function renderOverlay() {
    const mode = phase === 'lobby' ? 'lobby' : qrOpen ? 'qr' : null;
    if (mode !== ovMode) {
      ovMode = mode;
      if (!mode) { ov.innerHTML = ''; return; }
      const lobby = mode === 'lobby';
      ov.innerHTML = `
      <div class="join-ov bg-grid fade-in" role="dialog" aria-label="Join this presentation">
        <div class="join-inner">
          <header class="flex flex-wrap items-center justify-between gap-4">
            <div class="lobby-title wordmark text-slate-600 min-w-0">${esc(meta.title)}</div>
            <div class="flex items-center gap-2 ml-auto">
              ${canFS ? `<button data-act="fs" class="btn btn-ghost !py-3 !px-3" title="Full screen (F)" aria-label="Full screen">${I.fs}</button>` : ''}
              ${lobby ? `<button data-act="end" class="btn btn-ghost !py-3">End</button>` : ''}
              <button data-act="${lobby ? 'start' : 'closeqr'}" class="btn btn-green !text-lg md:!text-2xl !py-4 !px-7 md:!px-10 !rounded-2xl">${lobby ? 'Start presentation' : 'Back to slides'}</button>
            </div>
          </header>
          <div class="join-grid">
            <div class="join-left">
              <div class="inline-flex items-center gap-4 rounded-2xl bg-white border border-slate-200 px-5 py-3 shadow-sm">
                <span class="live-dot"></span>
                <span class="text-sm md:text-base font-semibold text-slate-500">Phones joined</span>
                <span id="ovCount" class="num text-4xl md:text-5xl font-bold text-emerald-600 leading-none">${viewers}</span>
              </div>
              <label class="mt-4 flex items-center gap-3 rounded-2xl bg-white border border-slate-200 px-5 py-3 shadow-sm cursor-pointer select-none">
                <input type="checkbox" id="ovIphone" class="check" ${meta.iphoneFS !== false ? 'checked' : ''}>
                <span class="text-sm md:text-base font-semibold text-slate-600">Full screen on iPhones</span>
              </label>
            </div>
            <div class="join-center">
              <div class="text-3xl md:text-5xl font-semibold text-slate-700 text-center">Scan to join</div>
              <div class="card p-3 md:p-4"><div id="ovQr" class="qr-box"></div></div>
              <div class="text-slate-500 text-sm md:text-lg text-center max-w-xl">Or go to <b class="text-slate-700 break-all">${esc(shortBase())}</b> and enter code
                <span class="num font-bold text-slate-900 tracking-[.25em] text-2xl md:text-4xl align-middle ml-2 whitespace-nowrap">${esc(code)}</span></div>
            </div>
            <div class="join-right w-full max-w-[18rem]">
              <figure class="card p-2">
                <img id="ovThumb" alt="" class="block w-full rounded-lg bg-slate-100" style="aspect-ratio:${meta.aspect || 16 / 9}">
                <figcaption id="ovCap" class="text-sm font-semibold text-slate-500 px-1 pt-2"></figcaption>
              </figure>
            </div>
          </div>
        </div>
      </div>`;
      const box = $('#ovQr');
      loadScript(QRJS).then(() => {
        if (!box.isConnected) return;
        new QRCode(box, { text: joinURL(code), width: 560, height: 560, colorDark: '#2a2b2c', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      }).catch(() => { box.innerHTML = '<div class="text-sm text-slate-400 text-center px-4">QR code unavailable. Use the link and code below.</div>'; });
    }
    if (mode) {
      const cap = $('#ovCap'), th = $('#ovThumb');
      cap.textContent = mode === 'lobby' ? `First slide of ${count}` : `Now on slide ${idx + 1} of ${count}`;
      const want = idx;
      getSlide(code, idx).then(src => { if (want === idx && th.isConnected) th.src = src; }).catch(() => {});
    }
  }

  /* --- actions --- */
  const go = i => {
    i = clamp(i, 0, count - 1); if (i === idx) return;
    endStroke(); if (tool === 'laser') sendLaser(null);
    R(code, 'state').update({ idx: i }).catch(writeErr);
  };
  const start = () => R(code, 'state').update({ phase: 'live' }).catch(writeErr);
  const setTool = t => {
    const next = tool === t ? 'none' : t;
    if (tool === 'laser' && next !== 'laser') sendLaser(null);
    tool = next; render();
  };
  const setColor = c => { color = c; if (tool !== 'pen' && tool !== 'hl') tool = 'pen'; render(); };
  const undo = () => { const last = strokes[strokes.length - 1]; if (last) R(code, `ink/${idx}/${last.id}`).remove().catch(writeErr); };
  const clearSlide = () => { if (strokes.length) R(code, 'ink/' + idx).remove().catch(writeErr); };
  const setQR = v => { qrOpen = v; render(); };
  async function endRoom() {
    if (!confirm('End the presentation for everyone? This deletes the room and its slides.')) return;
    try { await db.ref().update({ [ROOT + '/' + code]: null, [INDEX + '/' + code]: null }); } catch (e) { return writeErr(e); }
    rememberHosted(code, false);
    history.replaceState(null, '', baseURL());
    showLanding();
  }
  onEl(app, 'change', e => {
    if (e.target.id !== 'ovIphone') return;
    const on = e.target.checked; meta.iphoneFS = on; store.set('ls:iphoneFS', on);
    R(code, 'meta/iphoneFS').set(on).catch(writeErr);
  });
  onEl(app, 'click', e => {
    const b = e.target.closest('[data-act],[data-tool],[data-color]'); if (!b) return;
    if (b.dataset.tool) return setTool(b.dataset.tool);
    if (b.dataset.color) return setColor(b.dataset.color);
    ({ prev: () => go(idx - 1), next: () => go(idx + 1), undo, clear: clearSlide, qr: () => setQR(!qrOpen), closeqr: () => setQR(false),
       fs: toggleFS, end: endRoom, start })[b.dataset.act]?.();
  });

  /* --- drawing, erasing, laser --- */
  let drawing = null, pending = [], chunk = 0, flushT = 0, erasing = false, erased = new Set();
  function flush() {
    if (!drawing || !pending.length) return;
    const str = pending.map(p => Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4)).join(',');
    pending = [];
    const upd = { ['p/k' + String(chunk++).padStart(5, '0')]: str };
    if (chunk === 1) upd.s = drawing.mode + '|' + drawing.color;
    R(code, `ink/${drawing.idx}/${drawing.id}`).update(upd).catch(writeErr);
  }
  function endStroke() {
    if (!drawing) return;
    clearInterval(flushT); flush(); drawing = null; stage.setLocal(null);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / stage.aspect);
  function eraseAt(p) {
    for (const s of strokes) {
      if (erased.has(s.id)) continue;
      if (s.pts.some(q => dist(p, q) < ERASE_R + (s.mode === 'hl' ? HL_W / 2 : PEN_W / 2))) {
        erased.add(s.id); R(code, `ink/${idx}/${s.id}`).remove().catch(writeErr);
      }
    }
  }
  let laserPending = null, laserTimer = 0, laserLast = 0;
  function pushLaser() {
    clearTimeout(laserTimer); laserTimer = 0; laserLast = performance.now();
    const p = laserPending;
    R(code, 'laser').set(p ? { x: Math.round(p[0] * 1e4), y: Math.round(p[1] * 1e4) } : null).catch(writeErr);
  }
  function sendLaser(p) {
    stage.setLaser(p); laserPending = p;
    const wait = LASER_MS - (performance.now() - laserLast);
    if (!p || wait <= 0) pushLaser(); else if (!laserTimer) laserTimer = setTimeout(pushLaser, wait);
  }
  teardown.push(() => { clearInterval(flushT); clearTimeout(laserTimer); });

  const st = stage.el;
  onEl(st, 'pointerdown', e => {
    if (phase !== 'live' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (tool === 'none') { go(idx + 1); return; }
    const p = stage.toNorm(e);
    if (tool === 'laser') { sendLaser(p); return; }
    e.preventDefault();
    try { st.setPointerCapture(e.pointerId); } catch {}
    hideToolbar();
    if (tool === 'eraser') { erasing = true; erased = new Set(); eraseAt(p); return; }
    drawing = { id: R(code, 'ink/' + idx).push().key, idx, mode: tool, color, pts: [p] };
    pending = [p]; chunk = 0;
    stage.setLocal(drawing); flush();
    flushT = setInterval(flush, FLUSH_MS);
  });
  onEl(st, 'pointermove', e => {
    if (phase !== 'live') return;
    if (tool === 'laser') { sendLaser(stage.toNorm(e)); return; }
    if (erasing) { eraseAt(stage.toNorm(e)); return; }
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = stage.toNorm(ev), last = drawing.pts[drawing.pts.length - 1];
      if (dist(p, last) < 0.0012) continue;
      drawing.pts.push(p); pending.push(p);
    }
    stage.setLocal(drawing);
  });
  const up = () => { endStroke(); erasing = false; };
  onEl(st, 'pointerup', up); onEl(st, 'pointercancel', up);
  onEl(st, 'pointerleave', () => { if (tool === 'laser') sendLaser(null); });
  onEl(st, 'contextmenu', e => e.preventDefault());

  /* --- toolbar and cursor hide when the mouse rests --- */
  let idleT = 0;
  function hideToolbar() { clearTimeout(idleT); tb.classList.add('tb-hide'); }
  function poke() {
    tb.classList.remove('tb-hide'); document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      if (tb.matches(':hover') || tb.querySelector(':focus-visible')) return poke();
      tb.classList.add('tb-hide');
      if (tool === 'none' && phase === 'live') document.body.classList.add('idle');
    }, 2600);
  }
  onEl(document, 'pointermove', () => { if (!drawing && !erasing) poke(); });
  teardown.push(() => clearTimeout(idleT));
  poke();

  /* --- keyboard and presentation clickers (they send PageDown / PageUp) --- */
  const NEXT = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'], PREV = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
  onEl(document, 'keydown', e => {
    if (e.target.closest('input, textarea') || e.metaKey || e.altKey) return;
    const k = e.key;
    if ((k === ' ' || k === 'Enter') && e.target.closest('button, label')) return;
    if (e.ctrlKey) { if (k.toLowerCase() === 'z' && phase === 'live') { e.preventDefault(); undo(); } return; }
    if (k === 'f' || k === 'F') { toggleFS(); return; }
    if (phase === 'lobby') { if (NEXT.includes(k)) { e.preventDefault(); start(); } return; }
    if (NEXT.includes(k)) { e.preventDefault(); if (qrOpen) setQR(false); go(idx + 1); }
    else if (PREV.includes(k)) { e.preventDefault(); if (qrOpen) setQR(false); go(idx - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(count - 1);
    else if (k === 'Escape') { if (qrOpen) setQR(false); else if (tool !== 'none') setTool(tool); }
    else {
      const a = { p: () => setTool('pen'), h: () => setTool('hl'), e: () => setTool('eraser'), l: () => setTool('laser'),
                  z: undo, c: clearSlide, q: () => setQR(!qrOpen) }[k.toLowerCase()];
      if (a) { a(); }
    }
    poke();
  });
  render();
}

/* ---- Phone (or any second screen): follows the host ---- */
async function showViewer(code) {
  cleanup();
  app.innerHTML = loadingScreen('Joining ' + code);
  let meta;
  try { await withTimeout(getDB(), 20000, 'timeout'); meta = await once(R(code, 'meta')); }
  catch (e) { return showLanding(friendlyError(e), code); }
  if (!meta) { history.replaceState(null, '', baseURL()); return showLanding(`No presentation is using code ${code}. Check the code on the big screen.`, code); }
  document.title = meta.title + ' | ' + APP_NAME;
  history.replaceState(null, '', '?room=' + code);

  const count = Math.max(1, meta.count | 0);
  let phase = null, idx = -1, iphoneFS = meta.iphoneFS !== false;
  const fsOK = () => canFS || (canVideoFS && iphoneFS);
  app.innerHTML = `<div id="vStage"></div><div id="vWait"></div>
    ${canFS || canVideoFS ? `<button id="vFs" class="fs-btn gone">Fullscreen ${I.fs}</button>` : ''}
    <div id="vHint" class="hint gone"></div>`;
  const stage = createStage($('#vStage'));
  stage.setAspect(meta.aspect);
  teardown.push(keepAwake());

  /* presence, so the host can see how many phones are connected */
  let dev = sessionStorage.getItem('ls:dev');
  if (!dev) { dev = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('ls:dev', dev); }
  const me = R(code, 'viewers/' + dev);
  watchConnection(on => { if (on) { me.onDisconnect().remove(); me.set(true).catch(() => {}); } });
  teardown.push(() => { me.onDisconnect().cancel().catch(() => {}); me.remove().catch(() => {}); });

  let loaded = 0;
  const showProgress = () => {
    const bar = $('#vBar'), txt = $('#vLoad'); if (!bar) return;
    bar.style.width = Math.round(loaded / count * 100) + '%';
    txt.textContent = loaded >= count ? 'All slides ready' : `Getting slides ready (${loaded} of ${count})`;
  };
  const waitForReady = async () => {   // the host may still be uploading when someone scans
    for (let t = 0; t < 120; t++) { if ((await once(R(code, 'meta/ready')).catch(() => false))) return; await new Promise(r => setTimeout(r, 1500)); }
  };

  function renderWait() {
    const w = $('#vWait');
    if (phase !== 'lobby') { w.innerHTML = ''; return; }
    if (w.firstChild) return;
    w.innerHTML = `
    <div class="fixed inset-0 z-40 bg-grid overflow-y-auto fade-in">
      <div class="min-h-full grid place-items-center px-5 py-8">
        <div class="w-full max-w-md text-center">
          <div class="wordmark text-slate-600 text-xl md:text-2xl">${esc(meta.title)}</div>
          <section class="card p-7 mt-6">
            <div class="check-pop mx-auto grid place-items-center w-16 h-16 rounded-full text-white" style="background:var(--accent-dark)"><span class="w-9 h-9 block">${I.check}</span></div>
            <h1 class="text-2xl font-semibold text-slate-800 mt-4">You’re in</h1>
            <p class="text-slate-500 mt-2 leading-relaxed">The slides will appear here as soon as the presentation starts. Keep this screen open.</p>
            <div class="mt-6">
              <div class="h-2 rounded-full bg-slate-100 overflow-hidden"><div id="vBar" class="h-full rounded-full" style="width:0;background:var(--accent);transition:width .25s"></div></div>
              <div id="vLoad" class="text-xs font-semibold text-slate-500 mt-2" aria-live="polite"></div>
            </div>
          </section>
          <p class="text-sm text-slate-500 mt-5">${fsOK() ? 'Once the slides appear, tap Fullscreen in the top right corner.' : 'Turn your phone sideways during the talk for bigger slides.'}</p>
        </div>
      </div>
    </div>`;
    showProgress();
  }

  /* Fullscreen button: always showing during the talk unless the phone is already in full screen.
     Where full screen isn't available (iPhone with the option off), a one-time hint suggests turning sideways. */
  const fsBtn = $('#vFs'), hint = $('#vHint');
  let hinted = false;
  const updateFsBtn = () => { if (fsBtn) fsBtn.classList.toggle('gone', !(phase === 'live' && fsOK() && !isFS())); };
  onEl(document, 'fullscreenchange', updateFsBtn);
  onEl(document, 'webkitfullscreenchange', updateFsBtn);
  const maybeHint = () => {
    if (hinted || phase !== 'live' || fsOK() || innerWidth > 900 || meta.aspect < 1.2 || innerWidth > innerHeight) return;
    hinted = true; hint.textContent = 'Turn your phone sideways for bigger slides'; hint.classList.remove('gone'); setTimeout(() => hint.classList.add('gone'), 5000);
  };

  /* iPhone full screen: a hidden video plays a live copy of the slide, then goes full screen when tapped.
     It's started as soon as the talk is live so it's ready the moment someone taps the button. */
  let vfs = null;
  function vfsStart() {
    if (vfs || !canVideoFS) return vfs;
    const a = stage.aspect, cv = document.createElement('canvas');
    cv.width = a >= 1 ? VIDEO_PX : Math.round(VIDEO_PX * a);
    cv.height = a >= 1 ? Math.round(VIDEO_PX / a) : VIDEO_PX;
    const c = cv.getContext('2d');
    const paint = () => stage.compose(c, cv.width, cv.height);
    paint();
    let stream;
    try { stream = cv.captureStream(30); } catch { return null; }
    const video = document.createElement('video');
    video.className = 'vfs-video'; video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-hidden', 'true');
    video.srcObject = stream;
    document.body.appendChild(video);
    video.play().catch(() => {});
    let raf = 0;
    const offChange = stage.onChange(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); });
    const tick = setInterval(paint, 1000);   // a fresh frame every second keeps the stream from stalling
    const resume = () => { video.play().catch(() => {}); };
    video.addEventListener('pause', resume);           // the player's pause button would freeze the slides
    video.addEventListener('webkitendfullscreen', resume);
    vfs = {
      video,
      stop() {
        offChange(); clearInterval(tick); cancelAnimationFrame(raf);
        video.removeEventListener('pause', resume);
        try { if (video.webkitDisplayingFullscreen) video.webkitExitFullscreen(); } catch {}
        stream.getTracks().forEach(t => t.stop()); video.srcObject = null; video.remove();
      }
    };
    return vfs;
  }
  const vfsStop = () => { if (vfs) { vfs.stop(); vfs = null; } };
  teardown.push(vfsStop);
  const syncVideoFS = () => { if (canVideoFS && iphoneFS && phase === 'live') vfsStart(); else vfsStop(); };
  function enterVideoFS() {
    const v = vfsStart(); if (!v) return;
    const go = () => { try { v.video.webkitEnterFullscreen(); } catch { toast('Full screen didn’t start. Tap the button again.'); } };
    if (v.video.readyState >= 1) go();
    else { v.video.play().catch(() => {}); v.video.addEventListener('loadedmetadata', go, { once: true }); }
  }
  if (fsBtn) onEl(fsBtn, 'click', e => {
    e.stopPropagation();
    if (canFS) toggleFS(); else if (canVideoFS && iphoneFS) enterVideoFS();
  });

  /* sync */
  let inkRef = null, inkH = null;
  const watchInk = i => {
    if (inkRef) inkRef.off('value', inkH);
    inkRef = R(code, 'ink/' + i);
    inkH = s => { if (i === idx) stage.setStrokes(parseStrokes(s.val())); };
    inkRef.on('value', inkH);
  };
  teardown.push(() => inkRef && inkRef.off('value', inkH));
  listen(R(code, 'state'), v => {
    v = v || {};
    const was = phase;
    phase = v.phase === 'live' ? 'live' : 'lobby';
    const ni = clamp(v.idx | 0, 0, count - 1);
    if (ni !== idx) { idx = ni; stage.setStrokes([]); stage.setLaser(null); stage.show(getSlide(code, idx)); watchInk(idx); }
    renderWait();
    updateFsBtn();
    if (phase === 'live' && was !== 'live') maybeHint();
    syncVideoFS();
  });
  listen(R(code, 'laser'), v => stage.setLaser(v && typeof v.x === 'number' ? [v.x / 1e4, v.y / 1e4] : null));
  listen(R(code, 'meta'), v => {
    if (!v) { showEnded(meta.title); return; }
    iphoneFS = v.iphoneFS !== false;
    updateFsBtn();
    syncVideoFS();
  });

  waitForReady().then(() => preloadAll(code, count, Math.max(0, idx), (d) => { loaded = d; showProgress(); }));
}

function showEnded(title) {
  cleanup();
  history.replaceState(null, '', baseURL());
  app.innerHTML = `
  <div class="min-h-[100dvh] bg-grid grid place-items-center px-5">
    <div class="w-full max-w-md text-center pop">
      <div class="wordmark text-slate-600 text-xl md:text-2xl">${esc(title || APP_NAME)}</div>
      <section class="card p-7 mt-6">
        <h1 class="text-2xl font-semibold text-slate-800">The presentation has ended</h1>
        <p class="text-slate-500 mt-2">Thanks for following along.</p>
        <button data-act="home" class="btn btn-dark w-full mt-6">Join another presentation</button>
      </section>
    </div>
  </div>`;
  onEl(app, 'click', e => { if (e.target.closest('[data-act=home]')) showLanding(); });
}

/* ════ ROUTING ═══════════════════════════════════════════════════════════════
   ?host=ABCD  presenter screen     ?room=ABCD  phone (this is what the QR code opens)     no query  home   */
function route() {
  const q = new URLSearchParams(location.search);
  const h = cleanCode(q.get('host')), r = cleanCode(q.get('room') || q.get('code'));
  if (h.length === 4) showHost(h);
  else if (r.length === 4) showViewer(r);
  else showLanding();
}
window.addEventListener('popstate', route);
route();
