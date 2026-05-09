/**
 * Drum Kit — app.js
 * Audio: Web Audio API synthesis, no external files.
 * Views: PAD (grid), KIT (SVG schematic), MIX (per-instrument volume).
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

const SPACE_ID        = 'kick';
const STORAGE_KEY     = 'drumkit-v1-bindings';
const VOL_STORAGE_KEY = 'drumkit-v1-volumes';

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

const MIX_ORDER = ['kick','snare','hihat-c','hihat-o','tom-h','tom-m','tom-l','crash','ride','clap'];

const DEFAULT_VOLUMES = {
  'kick':    1.4,  'snare':   1.3,
  'hihat-c': 1.0,  'hihat-o': 1.0,
  'crash':   0.6,  'ride':    0.55,
  'tom-h':   1.1,  'tom-m':   1.3,  'tom-l': 1.4,
  'clap':    0.65,
};

let padVolumes = { ...DEFAULT_VOLUMES };

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

let ctx        = null;
let noiseBuf   = null;
let openHatEnv = null;
let masterOut  = null;

// Gate per active note: id → { gate: GainNode, pressTime: number }
const activeGates  = new Map();
// Pointer tracking: pointerId → pad id
const heldPointers = new Map();

function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterOut = ctx.createDynamicsCompressor();
  masterOut.threshold.value = -18;
  masterOut.knee.value      =  10;
  masterOut.ratio.value     =   3;
  masterOut.attack.value    = 0.008;
  masterOut.release.value   = 0.18;
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

// =====================================================================
// SYNTH FUNCTIONS
// All functions reference the module-level `masterOut`, which trigger()
// temporarily points at a per-note gate node during synthesis.
// =====================================================================

function synthKick(v) {
  const t = ctx.currentTime;

  // Body: slow pitch sweep (120→36Hz / 140ms) — feel the pitch drop as "oom"
  const body    = ctx.createOscillator();
  const shaper  = ctx.createWaveShaper();
  const bodyEnv = ctx.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(120, t);
  body.frequency.exponentialRampToValueAtTime(36, t + 0.14);
  const shaperCurve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    shaperCurve[i] = Math.tanh(x * 2.2);
  }
  shaper.curve = shaperCurve;
  bodyEnv.gain.setValueAtTime(v * 2.5, t);
  bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
  body.connect(shaper);
  shaper.connect(bodyEnv);
  bodyEnv.connect(masterOut);
  body.start(t);
  body.stop(t + 0.62);

  // Sub: sustained low weight (50→28Hz) — the "ン" in "ズンッ"
  const sub    = ctx.createOscillator();
  const subEnv = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(50, t);
  sub.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  subEnv.gain.setValueAtTime(v * 0.95, t);
  subEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.78);
  sub.connect(subEnv);
  subEnv.connect(masterOut);
  sub.start(t);
  sub.stop(t + 0.82);

  // Thud transient: low-pass noise (≤180Hz) — low-frequency impact, not a click
  const thud    = mkNoise();
  const lpf     = ctx.createBiquadFilter();
  const thudEnv = ctx.createGain();
  lpf.type = 'lowpass';
  lpf.frequency.value = 180;
  lpf.Q.value = 0.8;
  thudEnv.gain.setValueAtTime(v * 1.8, t);
  thudEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
  thud.connect(lpf);
  lpf.connect(thudEnv);
  thudEnv.connect(masterOut);
  thud.start(t);
  thud.stop(t + 0.065);
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
  env.gain.setValueAtTime(v * 1.2, t);
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

// =====================================================================
// TRIGGER / GATE / RELEASE
// =====================================================================

function trigger(id, velocity = 0.85) {
  ensureAudio();
  const fn = SYNTHS[id];
  if (!fn) return;

  // Close any previous gate for this pad (rapid re-hit)
  closePrevGate(id);

  const vol = padVolumes[id] ?? 1.0;
  const v = velocity * (0.88 + Math.random() * 0.24) * vol;

  // Route this note's synth nodes through a dedicated gate node.
  // We temporarily swap masterOut so all synth `.connect(masterOut)` calls
  // land on the gate instead of the compressor directly.
  const gate = ctx.createGain();
  gate.connect(masterOut);
  const savedOut = masterOut;
  masterOut = gate;
  fn(v);
  masterOut = savedOut;

  activeGates.set(id, { gate, pressTime: ctx.currentTime });
  flashPad(id);
}

function closePrevGate(id) {
  const prev = activeGates.get(id);
  if (!prev) return;
  activeGates.delete(id);
  const now = ctx.currentTime;
  prev.gate.gain.cancelScheduledValues(now);
  prev.gate.gain.setValueAtTime(1, now);
  prev.gate.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
}

function releaseNote(id) {
  const held = activeGates.get(id);
  if (!held) return;
  activeGates.delete(id);

  const holdSecs = ctx.currentTime - held.pressTime;
  // Tap (~0ms) → 20ms release (staccato); long hold → up to 280ms (sustain)
  const releaseSecs = Math.min(0.02 + holdSecs * 0.3, 0.28);
  const now = ctx.currentTime;

  held.gate.gain.cancelScheduledValues(now);
  held.gate.gain.setValueAtTime(1, now);
  held.gate.gain.exponentialRampToValueAtTime(0.0001, now + releaseSecs);
}

// =====================================================================
// VOLUME STATE
// =====================================================================

function loadVolumes() {
  try {
    const raw = localStorage.getItem(VOL_STORAGE_KEY);
    padVolumes = { ...DEFAULT_VOLUMES, ...(raw ? JSON.parse(raw) : {}) };
  } catch (_) {
    padVolumes = { ...DEFAULT_VOLUMES };
  }
}

function saveVolumes() {
  try { localStorage.setItem(VOL_STORAGE_KEY, JSON.stringify(padVolumes)); } catch (_) {}
}

// =====================================================================
// KEY BINDINGS
// =====================================================================

let bindings  = {};
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
// INPUT
// =====================================================================

function onKeyDown(e) {
  if (e.repeat) return;
  if (listening !== null) { handleAssign(e); return; }
  const id = idForKey(e.key);
  if (id) { e.preventDefault(); trigger(id); }
}

function onKeyUp(e) {
  if (listening !== null) return;
  const id = idForKey(e.key);
  if (id) releaseNote(id);
}

function handleAssign(e) {
  e.preventDefault();
  if (e.key === 'Escape') { stopListening(); return; }
  const id = listening, key = e.key;
  for (const [otherId, k] of Object.entries(bindings)) {
    if (k === key && otherId !== id) { bindings[otherId] = null; refreshBadge(otherId); }
  }
  bindings[id] = key;
  saveBindings();
  refreshBadge(id);
  stopListening();
}

// =====================================================================
// VIEW TOGGLE
// =====================================================================

function switchView(view) {
  document.getElementById('kit-grid').classList.toggle('hidden', view !== 'pad');
  document.getElementById('kit-view').classList.toggle('hidden', view !== 'kit');
  document.getElementById('mix-view').classList.toggle('hidden', view !== 'mix');
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

function kitDefs() {
  const defs = svgEl('defs');

  function rg(id, cx, cy, r, stops) {
    const g = svgEl('radialGradient', { id, cx, cy, r, gradientUnits: 'objectBoundingBox' });
    for (const [offset, color, opacity] of stops) {
      const s = svgEl('stop', { offset });
      s.setAttribute('stop-color', color);
      if (opacity != null) s.setAttribute('stop-opacity', String(opacity));
      g.append(s);
    }
    return g;
  }

  function lg(id, x1, y1, x2, y2, stops) {
    const g = svgEl('linearGradient', { id, x1, y1, x2, y2, gradientUnits: 'objectBoundingBox' });
    for (const [offset, color, opacity] of stops) {
      const s = svgEl('stop', { offset });
      s.setAttribute('stop-color', color);
      if (opacity != null) s.setAttribute('stop-opacity', String(opacity));
      g.append(s);
    }
    return g;
  }

  defs.append(
    rg('g-head', '38%', '32%', '66%', [
      ['0%',   '#f0ece2'],
      ['45%',  '#d4cfC4'],
      ['100%', '#9a9288'],
    ]),
    rg('g-shell', '48%', '40%', '60%', [
      ['0%',   '#3a3a3a'],
      ['100%', '#0c0c0c'],
    ]),
    rg('g-chrome', '32%', '26%', '74%', [
      ['0%',   '#e8e8e8'],
      ['40%',  '#b0b0b0'],
      ['100%', '#484848'],
    ]),
    lg('g-cymbal', '0', '0', '0', '1', [
      ['0%',   '#f5d85a'],
      ['38%',  '#c49018'],
      ['100%', '#5e3600'],
    ]),
    lg('g-bell', '0', '0', '0', '1', [
      ['0%',   '#fffaa8'],
      ['55%',  '#d8a828'],
      ['100%', '#7a4a00'],
    ]),
  );

  return defs;
}

function drawDrum(g, cx, cy, rx, ry, isKick) {
  const pad  = isKick ? 9 : 6;
  const lugs = isKick ? 8 : 6;

  g.append(svgEl('ellipse', {
    cx, cy: cy + Math.round(ry * 0.16),
    rx: Math.round(rx * 1.08), ry: Math.round(ry * 0.32),
    fill: '#000', 'fill-opacity': '0.42',
  }));
  g.append(svgEl('ellipse', {
    cx, cy, rx, ry,
    fill: 'url(#g-shell)', stroke: 'url(#g-chrome)', 'stroke-width': '5',
  }));

  const hx = rx - pad, hy = ry - pad;
  g.append(svgEl('ellipse', { cx, cy, rx: hx, ry: hy, fill: 'url(#g-head)' }));
  g.append(svgEl('ellipse', {
    cx: cx - hx * 0.22, cy: cy - hy * 0.26,
    rx: hx * 0.28, ry: hy * 0.22, fill: 'rgba(255,255,255,0.28)',
  }));
  g.append(svgEl('ellipse', {
    cx, cy, rx: hx, ry: hy, fill: 'none',
    stroke: 'rgba(255,255,255,0.1)', 'stroke-width': '1.5',
  }));

  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * 2 * Math.PI - Math.PI / 2;
    g.append(svgEl('circle', {
      cx: Math.round(cx + (rx - 2) * Math.cos(a)),
      cy: Math.round(cy + (ry - 2) * Math.sin(a)),
      r: 2.2, fill: '#cacaca', stroke: '#707070', 'stroke-width': '0.5',
    }));
  }

  if (isKick) {
    g.append(svgEl('ellipse', {
      cx: cx + hx * 0.34, cy,
      rx: Math.round(hx * 0.2), ry: Math.round(hy * 0.25),
      fill: '#080808', stroke: '#2a2a2a', 'stroke-width': '1.5',
    }));
    g.append(svgEl('circle', {
      cx: cx - hx * 0.12, cy,
      r: Math.round(Math.min(hx, hy) * 0.1), fill: '#c8c4bc',
    }));
  }

  g.append(svgEl('ellipse', {
    cx, cy, rx: hx, ry: hy, fill: 'var(--ac)', 'fill-opacity': '0.09',
  }));
}

function drawCymbal(g, cx, cy, rx, ry) {
  g.append(svgEl('ellipse', {
    cx, cy: cy + 4, rx: rx + 3, ry: Math.round(ry * 1.6),
    fill: '#000', 'fill-opacity': '0.35',
  }));
  g.append(svgEl('ellipse', {
    cx, cy, rx, ry, fill: 'url(#g-cymbal)',
    stroke: '#3a2000', 'stroke-width': '0.8',
  }));

  for (const s of [0.87, 0.73, 0.58, 0.44, 0.29]) {
    g.append(svgEl('ellipse', {
      cx, cy, rx: Math.round(rx * s), ry: Math.round(ry * s),
      fill: 'none', stroke: 'rgba(0,0,0,0.25)', 'stroke-width': '0.6',
    }));
  }

  const bx = Math.max(8, Math.round(rx * 0.2)), by = Math.round(ry * 0.88);
  g.append(svgEl('ellipse', {
    cx, cy, rx: bx, ry: by, fill: 'url(#g-bell)',
    stroke: '#7a4800', 'stroke-width': '0.7',
  }));
  g.append(svgEl('circle', { cx, cy, r: Math.max(2, Math.round(ry * 0.55)), fill: '#1a0e00' }));
  g.append(svgEl('ellipse', {
    cx: cx - rx * 0.3, cy: cy - ry * 0.22, rx: rx * 0.2, ry: ry * 0.58,
    fill: 'rgba(255,255,255,0.24)',
    transform: `rotate(-18,${cx - rx * 0.3},${cy - ry * 0.22})`,
  }));
  g.append(svgEl('ellipse', {
    cx, cy, rx, ry, fill: 'var(--ac)', 'fill-opacity': '0.1',
  }));
}

function drawClap(g, cx, cy, rx, ry) {
  const x = cx - rx, y = cy - ry, w = rx * 2, h = ry * 2;
  g.append(svgEl('rect', { x: x + 2, y: y + 4, width: w, height: h, rx: 7, fill: '#000', 'fill-opacity': '0.4' }));
  g.append(svgEl('rect', { x, y, width: w, height: h, rx: 6, fill: '#1a1e1a', stroke: 'var(--ac)', 'stroke-width': '1.5' }));
  const inset = 5;
  g.append(svgEl('rect', { x: x + inset, y: y + inset, width: w - inset * 2, height: h - inset * 2, rx: 3, fill: '#111611' }));
  const ldx = cx + rx - 10, ldy = cy - ry + 8;
  g.append(svgEl('circle', { cx: ldx, cy: ldy, r: 3, fill: 'var(--ac)', 'fill-opacity': '0.9' }));
  g.append(svgEl('circle', { cx: ldx, cy: ldy, r: 5, fill: 'none', stroke: 'var(--ac)', 'stroke-width': '1', 'stroke-opacity': '0.4' }));
}

function addLabels(g, item, label, keyTxt) {
  let nameY, badgeY;
  if (item.labelDir === 0) {
    nameY  = item.cy - 5;
    badgeY = item.cy + 10;
  } else if (item.labelDir === 1) {
    nameY  = item.cy + item.ry + 14;
    badgeY = item.cy + item.ry + 27;
  } else {
    nameY  = item.cy - item.ry - 17;
    badgeY = item.cy - item.ry - 4;
  }

  const nameEl = svgEl('text', { x: item.cx, y: nameY, class: 'kit-name', 'text-anchor': 'middle' });
  nameEl.textContent = label;

  const bw = Math.max(22, keyTxt.length * 7 + 10);
  const bh = 14;
  const badgeBg = svgEl('rect', {
    x: item.cx - bw / 2, y: badgeY - bh / 2 + 1, width: bw, height: bh, rx: 3,
    class: 'kit-badge-bg', 'data-id': item.id,
  });
  const badgeTxt = svgEl('text', {
    x: item.cx, y: badgeY + 1, class: 'kit-badge-text', 'data-id': item.id,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
  });
  badgeTxt.textContent = keyTxt;

  const badgeG = svgEl('g', { class: 'kit-badge-group', 'data-id': item.id });
  badgeG.append(badgeBg, badgeTxt);
  g.append(nameEl, badgeG);
}

function buildKitView() {
  const svg = svgEl('svg', {
    viewBox: '0 0 560 360', id: 'kit-svg',
    role: 'group', 'aria-label': 'Drum kit layout',
  });

  svg.append(kitDefs());
  svg.append(svgEl('ellipse', {
    cx: 280, cy: 252, rx: 238, ry: 118,
    fill: '#12100e', stroke: '#2a2420', 'stroke-width': '1',
  }));

  for (const item of KIT_LAYOUT) {
    const pad    = PADS.find(p => p.id === item.id);
    const label  = pad.label.replace('\n', ' ');
    const keyTxt = keyLabel(bindings[item.id]);

    const g = svgEl('g', {
      class: 'kit-item', 'data-id': item.id,
      tabindex: '0', role: 'button', 'aria-label': `${label}: ${keyTxt}`,
    });
    g.style.setProperty('--ac', PAD_COLORS[item.id]);

    const { cx, cy, rx, ry, type } = item;
    if      (type === 'cymbal') drawCymbal(g, cx, cy, rx, ry);
    else if (type === 'kick')   drawDrum(g, cx, cy, rx, ry, true);
    else if (type === 'drum')   drawDrum(g, cx, cy, rx, ry, false);
    else                        drawClap(g, cx, cy, rx, ry);

    addLabels(g, item, label, keyTxt);
    svg.append(g);
  }

  return svg;
}

function initKitView() {
  const container = document.getElementById('kit-view');
  container.append(buildKitView());

  const svg = document.getElementById('kit-svg');

  svg.addEventListener('pointerdown', e => {
    const badge = e.target.closest('.kit-badge-group');
    if (badge) { e.preventDefault(); e.stopPropagation(); startListening(badge.dataset.id); return; }
    const item = e.target.closest('.kit-item');
    if (item) {
      e.preventDefault();
      item.setPointerCapture(e.pointerId);
      heldPointers.set(e.pointerId, item.dataset.id);
      trigger(item.dataset.id);
    }
  });

  const releaseFromSvg = e => {
    const id = heldPointers.get(e.pointerId);
    if (id) { heldPointers.delete(e.pointerId); releaseNote(id); }
  };
  svg.addEventListener('pointerup',     releaseFromSvg);
  svg.addEventListener('pointercancel', releaseFromSvg);

  svg.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.kit-item');
    if (item) { e.preventDefault(); trigger(item.dataset.id); }
  });
}

// =====================================================================
// MIXER VIEW
// =====================================================================

function updateSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--pct', `${pct.toFixed(1)}%`);
}

function buildMixerView() {
  const container = document.getElementById('mix-view');

  const resetAllBtn = document.createElement('button');
  resetAllBtn.className = 'mix-reset-all';
  resetAllBtn.textContent = 'RESET ALL';
  resetAllBtn.addEventListener('click', () => {
    padVolumes = { ...DEFAULT_VOLUMES };
    saveVolumes();
    container.querySelectorAll('.mix-slider').forEach(sl => {
      const def = DEFAULT_VOLUMES[sl.dataset.id] ?? 1.0;
      sl.value = String(Math.round(def * 100));
      updateSliderFill(sl);
      sl.closest('.mix-row').querySelector('.mix-val').textContent = `${Math.round(def * 100)}%`;
    });
  });
  container.append(resetAllBtn);

  for (const id of MIX_ORDER) {
    const p     = PADS.find(p => p.id === id);
    const color = PAD_COLORS[id];
    const vol   = padVolumes[id] ?? 1.0;

    const row = document.createElement('div');
    row.className = 'mix-row';

    const label = document.createElement('span');
    label.className = 'mix-label';
    label.textContent = p.label.replace('\n', ' ');
    label.style.color = color;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'mix-slider';
    slider.min = '0'; slider.max = '200'; slider.step = '5';
    slider.value = String(Math.round(vol * 100));
    slider.dataset.id = id;
    slider.style.setProperty('--ac', color);
    updateSliderFill(slider);

    const valDisplay = document.createElement('span');
    valDisplay.className = 'mix-val';
    valDisplay.textContent = `${Math.round(vol * 100)}%`;

    const resetBtn = document.createElement('button');
    resetBtn.className = 'mix-reset';
    resetBtn.textContent = '↺';
    resetBtn.title = 'Reset to default';
    resetBtn.addEventListener('click', () => {
      const def = DEFAULT_VOLUMES[id] ?? 1.0;
      padVolumes[id] = def;
      slider.value = String(Math.round(def * 100));
      updateSliderFill(slider);
      valDisplay.textContent = `${Math.round(def * 100)}%`;
      saveVolumes();
    });

    slider.addEventListener('input', () => {
      padVolumes[id] = parseInt(slider.value) / 100;
      valDisplay.textContent = `${slider.value}%`;
      updateSliderFill(slider);
      saveVolumes();
    });

    row.append(label, slider, valDisplay, resetBtn);
    container.append(row);
  }
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

    div.addEventListener('pointerdown', e => {
      e.preventDefault();
      div.setPointerCapture(e.pointerId);
      heldPointers.set(e.pointerId, p.id);
      trigger(p.id);
    });
    const releasePad = e => {
      if (heldPointers.has(e.pointerId)) {
        heldPointers.delete(e.pointerId);
        releaseNote(p.id);
      }
    };
    div.addEventListener('pointerup',     releasePad);
    div.addEventListener('pointercancel', releasePad);

    const name = document.createElement('span');
    name.className = 'pad-name';
    name.textContent = p.label;

    const badge = document.createElement('button');
    badge.className = 'key-badge';
    badge.dataset.id = p.id;
    badge.setAttribute('aria-label', `Assign key for ${p.label}`);
    badge.textContent = keyLabel(bindings[p.id]);
    badge.addEventListener('pointerdown', e => e.stopPropagation());
    badge.addEventListener('click', e => { e.stopPropagation(); startListening(p.id); });

    div.append(name, badge);
    grid.append(div);
  }
}

function refreshBadge(id) {
  const label = keyLabel(bindings[id]);

  const pb = document.querySelector(`.key-badge[data-id="${id}"]`);
  if (pb) pb.textContent = label;

  const kt = document.querySelector(`#kit-svg .kit-badge-text[data-id="${id}"]`);
  if (kt) {
    kt.textContent = label;
    const kr = document.querySelector(`#kit-svg .kit-badge-bg[data-id="${id}"]`);
    if (kr) {
      const bw = Math.max(22, label.length * 7 + 10);
      kr.setAttribute('x', parseFloat(kt.getAttribute('x')) - bw / 2);
      kr.setAttribute('width', bw);
    }
    const kItem = kt.closest('.kit-item');
    if (kItem) {
      const p = PADS.find(p => p.id === id);
      kItem.setAttribute('aria-label', `${p.label.replace('\n', ' ')}: ${label}`);
    }
  }
}

function flashPad(id) {
  const padEl = document.getElementById(`pad-${id}`);
  if (padEl) {
    padEl.classList.remove('active');
    void padEl.offsetWidth;
    padEl.classList.add('active');
  }
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
  loadVolumes();
  buildPads();
  initKitView();
  buildMixerView();

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);
  document.querySelectorAll('.view-tab').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );
  document.getElementById('overlay').addEventListener('click', stopListening);
  document.getElementById('listen-box').addEventListener('click', e => e.stopPropagation());
});
