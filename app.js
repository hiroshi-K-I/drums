/**
 * Drum Kit — app.js
 *
 * Audio: Web Audio API synthesis, no external files.
 * Latency: lazy AudioContext init, pre-allocated noise buffer, currentTime scheduling.
 * Views: PAD (grid) and KIT (SVG drum kit diagram), toggled by tabs.
 */

'use strict';

// =====================================================================
// PAD DEFINITIONS
// =====================================================================
const PADS = [
  { id: 'crash',   label: 'CRASH',     defaultKey: 'q' },
  { id: 'tom-h',   label: 'TOM\nHI',   defaultKey: 't' },
  { id: 'tom-m',   label: 'TOM\nMID',  defaultKey: 'y' },
  { id: 'tom-l',   label: 'TOM\nLO',   defaultKey: 'u' },
  { id: 'ride',    label: 'RIDE',      defaultKey: 'p' },
  { id: 'hihat-c', label: 'HI-HAT\nC', defaultKey: 'a' },
  { id: 'hihat-o', label: 'HI-HAT\nO', defaultKey: 's' },
  { id: 'snare',   label: 'SNARE',     defaultKey: 'd' },
  { id: 'kick',    label: 'KICK',      defaultKey: 'f' },
  { id: 'clap',    label: 'CLAP',      defaultKey: 'g' },
];

const SPACE_ID   = 'kick';
const STORAGE_KEY = 'drumkit-v1-bindings';

// Accent colours — mirrors CSS --ac values per pad
const PAD_COLORS = {
  'crash':   '#eab308',
  'tom-h':   '#a855f7',
  'tom-m':   '#9333ea',
  'tom-l':   '#7c3aed',
  'ride':    '#fbbf24',
  'hihat-c': '#06b6d4',
  'hihat-o': '#22d3ee',
  'snare':   '#f97316',
  'kick':    '#ef4444',
  'clap':    '#22c55e',
};

// SVG drum kit layout — top-down schematic view (viewBox 0 0 560 360)
// labelDir: 0 = inside shape, 1 = below, -1 = above
const KIT_LAYOUT = [
  { id: 'crash',   cx:  88, cy:  52, rx: 65, ry: 13, type: 'cymbal', labelDir:  1 },
  { id: 'ride',    cx: 462, cy:  60, rx: 65, ry: 13, type: 'cymbal', labelDir:  1 },
  { id: 'hihat-c', cx:  76, cy: 138, rx: 52, ry: 11, type: 'cymbal', labelDir: -1 },
  { id: 'hihat-o', cx:  76, cy: 162, rx: 52, ry: 11, type: 'cymbal', labelDir:  1 },
  { id: 'tom-h',   cx: 200, cy: 122, rx: 44, ry: 44, type: 'drum',   labelDir:  0 },
  { id: 'tom-m',   cx: 305, cy: 112, rx: 44, ry: 44, type: 'drum',   labelDir:  0 },
  { id: 'tom-l',   cx: 434, cy: 210, rx: 52, ry: 52, type: 'drum',   labelDir:  0 },
  { id: 'kick',    cx: 274, cy: 226, rx: 82, ry: 71, type: 'kick',   labelDir:  0 },
  { id: 'snare',   cx: 136, cy: 228, rx: 46, ry: 46, type: 'drum',   labelDir:  0 },
  { id: 'clap',    cx: 155, cy: 308, rx: 40, ry: 22, type: 'clap',   labelDir:  0 },
];

// =====================================================================
// AUDIO ENGINE
// =====================================================================

let ctx        = null;  // AudioContext (lazy)
let noiseBuf   = null;  // shared 2 s white-noise buffer
let openHatEnv = null;  // GainNode for open hi-hat choke group
let masterOut  = null;  // DynamicsCompressor master bus

function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Master compressor — evens out the mix so quieter low-freq sounds
  // are more audible relative to the snappier mid/high sounds
  masterOut = ctx.createDynamicsCompressor();
  masterOut.threshold.value = -20;
  masterOut.knee.value      =   8;
  masterOut.ratio.value     =   3;
  masterOut.attack.value    = 0.003;
  masterOut.release.value   = 0.12;
  masterOut.connect(ctx.destination);

  buildNoiseBuf();
}

function buildNoiseBuf() {
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
}

function mkNoise() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

// ------------------------------------------------------------------
// Synth functions — all route to masterOut
// ------------------------------------------------------------------

function synthKick(v) {
  const t = ctx.currentTime;

  // Main body: sine with rapid pitch sweep
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.08);
  env.gain.setValueAtTime(v * 1.5, t);   // increased for audibility
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(env);
  env.connect(masterOut);
  osc.start(t);
  osc.stop(t + 0.52);

  // Click transient — short noise burst for punch on small speakers
  const click    = mkNoise();
  const clickHpf = ctx.createBiquadFilter();
  const clickEnv = ctx.createGain();
  clickHpf.type = 'highpass';
  clickHpf.frequency.value = 80;
  clickEnv.gain.setValueAtTime(v * 0.4, t);
  clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
  click.connect(clickHpf);
  clickHpf.connect(clickEnv);
  clickEnv.connect(masterOut);
  click.start(t);
  click.stop(t + 0.03);
}

function synthSnare(v) {
  const t = ctx.currentTime;

  const src = mkNoise();
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 260;
  bpf.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * 0.75, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
  src.connect(bpf);
  bpf.connect(ng);
  ng.connect(masterOut);
  src.start(t);
  src.stop(t + 0.21);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const tg = ctx.createGain();
  osc.frequency.setValueAtTime(210, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.1);
  tg.gain.setValueAtTime(v * 0.48, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(tg);
  tg.connect(masterOut);
  osc.start(t);
  osc.stop(t + 0.15);
}

function synthHiHatClosed(v) {
  const t = ctx.currentTime;
  chokeOpenHat(t);

  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 7500;
  hpf.Q.value = 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.32, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
  src.connect(hpf);
  hpf.connect(env);
  env.connect(masterOut);
  src.start(t);
  src.stop(t + 0.055);
}

function synthHiHatOpen(v) {
  const t = ctx.currentTime;

  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 7500;
  hpf.Q.value = 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.32, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
  src.connect(hpf);
  hpf.connect(env);
  env.connect(masterOut);
  src.start(t);
  src.stop(t + 0.52);

  openHatEnv = env;
}

function chokeOpenHat(t) {
  if (!openHatEnv) return;
  try {
    openHatEnv.gain.cancelScheduledValues(t);
    openHatEnv.gain.setValueAtTime(0.2, t);
    openHatEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
  } catch (_) {}
  openHatEnv = null;
}

function synthCrash(v) {
  const t = ctx.currentTime;
  const src = mkNoise();
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.55, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
  [380, 760, 1520].forEach(freq => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = freq;
    bpf.Q.value = 3.5;
    src.connect(bpf);
    bpf.connect(env);
  });
  env.connect(masterOut);
  src.start(t);
  src.stop(t + 2.7);
}

function synthRide(v) {
  const t = ctx.currentTime;
  const src = mkNoise();
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.45, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
  [560, 1120, 2240].forEach(freq => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = freq;
    bpf.Q.value = 6;
    src.connect(bpf);
    bpf.connect(env);
  });
  env.connect(masterOut);
  src.start(t);
  src.stop(t + 2.0);
}

function synthTom(baseHz, endHz, duration, v) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseHz, t);
  osc.frequency.exponentialRampToValueAtTime(endHz, t + duration);
  env.gain.setValueAtTime(v * 1.2, t);   // increased for audibility
  env.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(env);
  env.connect(masterOut);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function synthClap(v) {
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const off = i * 0.013;
    const src = mkNoise();
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 1100;
    bpf.Q.value = 0.75;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, t + off);
    env.gain.linearRampToValueAtTime(v * 0.82, t + off + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.065);
    src.connect(bpf);
    bpf.connect(env);
    env.connect(masterOut);
    src.start(t + off);
    src.stop(t + off + 0.09);
  }
}

const SYNTHS = {
  'kick':    synthKick,
  'snare':   synthSnare,
  'hihat-c': synthHiHatClosed,
  'hihat-o': synthHiHatOpen,
  'crash':   synthCrash,
  'ride':    synthRide,
  'tom-h':   v => synthTom(300, 148, 0.30, v),
  'tom-m':   v => synthTom(200,  96, 0.36, v),
  'tom-l':   v => synthTom(118,  56, 0.52, v),
  'clap':    synthClap,
};

function trigger(id, velocity = 0.85) {
  ensureAudio();
  const fn = SYNTHS[id];
  if (!fn) return;
  const v = Math.min(1.0, velocity * (0.88 + Math.random() * 0.24));
  fn(v);
  flashPad(id);
}

// =====================================================================
// KEY BINDINGS
// =====================================================================

let bindings = {};
let listening = null;

function defaultBindings() {
  return Object.fromEntries(PADS.map(p => [p.id, p.defaultKey]));
}

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    bindings = { ...defaultBindings(), ...(raw ? JSON.parse(raw) : {}) };
  } catch (_) {
    bindings = defaultBindings();
  }
}

function saveBindings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch (_) {}
}

function idForKey(key) {
  if (key === ' ') return SPACE_ID;
  for (const [id, k] of Object.entries(bindings)) {
    if (k === key) return id;
  }
  return null;
}

// =====================================================================
// INPUT HANDLERS
// =====================================================================

function onKeyDown(e) {
  if (e.repeat) return;
  if (listening !== null) { handleAssign(e); return; }
  const id = idForKey(e.key);
  if (id) { e.preventDefault(); trigger(id); }
}

function onPadPointerDown(e) {
  e.preventDefault();
  trigger(e.currentTarget.dataset.id);
}

function onBadgePointerDown(e) { e.stopPropagation(); }

function onBadgeClick(e) {
  e.stopPropagation();
  startListening(e.currentTarget.dataset.id);
}

function handleAssign(e) {
  e.preventDefault();
  if (e.key === 'Escape') { stopListening(); return; }

  const id  = listening;
  const key = e.key;

  for (const [otherId, k] of Object.entries(bindings)) {
    if (k === key && otherId !== id) {
      bindings[otherId] = null;
      refreshBadge(otherId);
    }
  }
  bindings[id] = key;
  saveBindings();
  refreshBadge(id);
  stopListening();
}

// =====================================================================
// VIEW MANAGEMENT
// =====================================================================

function switchView(view) {
  document.getElementById('kit-grid').classList.toggle('hidden', view !== 'pad');
  document.getElementById('kit-view').classList.toggle('hidden', view !== 'kit');
  document.querySelectorAll('.view-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view)
  );
}

// =====================================================================
// SVG KIT VIEW
// =====================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function buildKitView() {
  const svg = svgEl('svg', {
    viewBox: '0 0 560 360',
    id: 'kit-svg',
    role: 'group',
    'aria-label': 'Drum kit layout',
  });

  for (const item of KIT_LAYOUT) {
    const pad    = PADS.find(p => p.id === item.id);
    const label  = pad.label.replace('\n', ' ');
    const keyTxt = keyLabel(bindings[item.id]);

    const g = svgEl('g', {
      class: 'kit-item',
      'data-id': item.id,
      tabindex: '0',
      role: 'button',
      'aria-label': `${label}: ${keyTxt}`,
    });
    g.style.setProperty('--ac', PAD_COLORS[item.id]);

    // --- shape ---
    if (item.type === 'cymbal') {
      g.append(
        svgEl('ellipse', { cx: item.cx, cy: item.cy, rx: item.rx, ry: item.ry, class: 'cymbal-body' }),
        svgEl('ellipse', { cx: item.cx, cy: item.cy, rx: Math.round(item.ry * 1.6), ry: Math.round(item.ry * 0.72), class: 'cymbal-bell' }),
      );
    } else if (item.type === 'drum' || item.type === 'kick') {
      const pad = item.type === 'kick' ? 8 : 6;
      g.append(
        svgEl('ellipse', { cx: item.cx, cy: item.cy, rx: item.rx, ry: item.ry, class: 'drum-outer' }),
        svgEl('ellipse', { cx: item.cx, cy: item.cy, rx: item.rx - pad, ry: item.ry - pad, class: 'drum-head' }),
        svgEl('circle',  { cx: item.cx, cy: item.cy, r: Math.round(Math.min(item.rx, item.ry) * 0.14), class: 'drum-dot' }),
      );
    } else { // clap
      g.append(svgEl('rect', {
        x: item.cx - item.rx, y: item.cy - item.ry,
        width: item.rx * 2, height: item.ry * 2,
        rx: 6, class: 'clap-shape',
      }));
    }

    // --- label position ---
    let nameY, badgeY;
    if (item.labelDir === 0) {
      nameY  = item.cy - 5;
      badgeY = item.cy + 9;
    } else if (item.labelDir === 1) {
      nameY  = item.cy + item.ry + 14;
      badgeY = item.cy + item.ry + 27;
    } else {
      nameY  = item.cy - item.ry - 17;
      badgeY = item.cy - item.ry - 5;
    }

    const nameEl = svgEl('text', { x: item.cx, y: nameY, class: 'kit-name', 'text-anchor': 'middle' });
    nameEl.textContent = label;

    // badge (clickable for key reassignment)
    const bw = Math.max(22, keyTxt.length * 7 + 10);
    const bh = 14;
    const badgeBg = svgEl('rect', {
      x: item.cx - bw / 2, y: badgeY - bh / 2 + 1,
      width: bw, height: bh, rx: 3,
      class: 'kit-badge-bg', 'data-id': item.id,
    });
    const badgeTxt = svgEl('text', {
      x: item.cx, y: badgeY + 1,
      class: 'kit-badge-text', 'data-id': item.id,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
    });
    badgeTxt.textContent = keyTxt;

    const badgeG = svgEl('g', { class: 'kit-badge-group', 'data-id': item.id });
    badgeG.append(badgeBg, badgeTxt);

    g.append(nameEl, badgeG);
    svg.append(g);
  }

  return svg;
}

function initKitView() {
  const container = document.getElementById('kit-view');
  const svg = buildKitView();
  container.append(svg);

  svg.addEventListener('pointerdown', e => {
    const badgeG = e.target.closest('.kit-badge-group');
    if (badgeG) {
      e.preventDefault();
      e.stopPropagation();
      startListening(badgeG.dataset.id);
      return;
    }
    const item = e.target.closest('.kit-item');
    if (item) {
      e.preventDefault();
      trigger(item.dataset.id);
    }
  });

  svg.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.kit-item');
    if (item) { e.preventDefault(); trigger(item.dataset.id); }
  });
}

// =====================================================================
// DOM — PAD VIEW
// =====================================================================

function keyLabel(key) {
  if (!key) return '—';
  const a = {
    ' ': 'SPACE', 'ArrowLeft': '←', 'ArrowRight': '→',
    'ArrowUp': '↑', 'ArrowDown': '↓', 'Enter': '↵',
    'Tab': 'TAB', 'Backspace': '⌫', 'Delete': 'DEL',
    'Escape': 'ESC', 'Control': 'CTRL', 'Shift': '⇧',
    'Alt': 'ALT', 'Meta': '⌘', 'CapsLock': 'CAPS',
  };
  return a[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

function buildPads() {
  const grid = document.getElementById('kit-grid');
  for (const p of PADS) {
    const div = document.createElement('div');
    div.className = 'pad';
    div.id = `pad-${p.id}`;
    div.dataset.id = p.id;
    div.addEventListener('pointerdown', onPadPointerDown);

    const name = document.createElement('span');
    name.className = 'pad-name';
    name.textContent = p.label;

    const badge = document.createElement('button');
    badge.className = 'key-badge';
    badge.dataset.id = p.id;
    badge.setAttribute('aria-label', `Assign key for ${p.label}`);
    badge.textContent = keyLabel(bindings[p.id]);
    badge.addEventListener('pointerdown', onBadgePointerDown);
    badge.addEventListener('click', onBadgeClick);

    div.append(name, badge);
    grid.append(div);
  }
}

function refreshBadge(id) {
  const label = keyLabel(bindings[id]);

  // Pad view
  const pb = document.querySelector(`.key-badge[data-id="${id}"]`);
  if (pb) pb.textContent = label;

  // Kit view — update text and resize badge rect
  const kt = document.querySelector(`#kit-svg .kit-badge-text[data-id="${id}"]`);
  if (kt) {
    kt.textContent = label;
    const kr = document.querySelector(`#kit-svg .kit-badge-bg[data-id="${id}"]`);
    if (kr) {
      const bw = Math.max(22, label.length * 7 + 10);
      const cx = parseFloat(kt.getAttribute('x'));
      kr.setAttribute('x', cx - bw / 2);
      kr.setAttribute('width', bw);
    }
    const g = kt.closest('.kit-item');
    if (g) {
      const p = PADS.find(p => p.id === id);
      g.setAttribute('aria-label', `${p.label.replace('\n', ' ')}: ${label}`);
    }
  }
}

function flashPad(id) {
  // Pad view — reflow trick restarts @keyframes on rapid hits
  const padEl = document.getElementById(`pad-${id}`);
  if (padEl) {
    padEl.classList.remove('active');
    void padEl.offsetWidth;
    padEl.classList.add('active');
  }
  // Kit view — getBoundingClientRect() forces reflow on SVG elements
  const kitEl = document.querySelector(`#kit-svg .kit-item[data-id="${id}"]`);
  if (kitEl) {
    kitEl.classList.remove('active');
    kitEl.getBoundingClientRect();
    kitEl.classList.add('active');
  }
}

function startListening(id) {
  listening = id;
  document.getElementById(`pad-${id}`)?.classList.add('listening');
  document.querySelector(`#kit-svg .kit-item[data-id="${id}"]`)?.classList.add('listening');
  document.getElementById('listen-name').textContent =
    PADS.find(p => p.id === id).label.replace('\n', ' ');
  document.getElementById('overlay').classList.remove('hidden');
}

function stopListening() {
  if (listening) {
    document.getElementById(`pad-${listening}`)?.classList.remove('listening');
    document.querySelector(`#kit-svg .kit-item[data-id="${listening}"]`)?.classList.remove('listening');
  }
  listening = null;
  document.getElementById('overlay').classList.add('hidden');
}

// =====================================================================
// BOOTSTRAP
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
  loadBindings();
  buildPads();
  initKitView();

  document.addEventListener('keydown', onKeyDown);

  document.querySelectorAll('.view-tab').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );

  document.getElementById('overlay').addEventListener('click', stopListening);
  document.getElementById('listen-box').addEventListener('click', e => e.stopPropagation());
});
