/**
 * Drum Kit — app.js
 *
 * All audio synthesis is done with the Web Audio API (no external files).
 * Low-latency strategy: AudioContext scheduled at currentTime, pre-allocated
 * noise buffer, lazy AudioContext init on first user gesture.
 */

'use strict';

// =====================================================================
// PAD DEFINITIONS
// Order here controls DOM order (used for mobile 3-col flow layout).
// Key defaults follow QWERTY home-row / number-row logic:
//   Row 1 (cymbals/toms): q  t  y  u  p
//   Row 2 (core rhythm) : a  s  d  f  g
//   Space = alt kick
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

// Space always doubles as kick regardless of bindings
const SPACE_ID = 'kick';

const STORAGE_KEY = 'drumkit-v1-bindings';

// =====================================================================
// AUDIO ENGINE
// =====================================================================

let ctx = null;        // AudioContext (lazy init)
let noiseBuf = null;   // Pre-baked 2-second white-noise AudioBuffer
let openHatEnv = null; // GainNode for open hi-hat (choke group)

/** Create AudioContext and build noise buffer. Called on first gesture. */
function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  buildNoiseBuf();
}

function buildNoiseBuf() {
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
}

/** Create a new BufferSourceNode backed by the shared noise buffer. */
function mkNoise() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

// ------------------------------------------------------------------
// Individual synthesiser functions
// Each receives a velocity (0.0 – 1.0) and schedules at ctx.currentTime.
// ------------------------------------------------------------------

function synthKick(v) {
  const t = ctx.currentTime;

  // Main thump: sine with fast pitch drop
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.08);
  env.gain.setValueAtTime(v * 1.1, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.52);

  // Sub click transient (short noise burst gives the attack punch)
  const click = mkNoise();
  const clickEnv = ctx.createGain();
  const clickHpf = ctx.createBiquadFilter();
  clickHpf.type = 'highpass';
  clickHpf.frequency.value = 80;
  clickEnv.gain.setValueAtTime(v * 0.25, t);
  clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
  click.connect(clickHpf);
  clickHpf.connect(clickEnv);
  clickEnv.connect(ctx.destination);
  click.start(t);
  click.stop(t + 0.03);
}

function synthSnare(v) {
  const t = ctx.currentTime;

  // Noise body (the rattle)
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
  ng.connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.21);

  // Tone crack (triangle gives a more natural snare body)
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const tg = ctx.createGain();
  osc.frequency.setValueAtTime(210, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.1);
  tg.gain.setValueAtTime(v * 0.48, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(tg);
  tg.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

function synthHiHatClosed(v) {
  const t = ctx.currentTime;

  // Choke any ringing open hat
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
  env.connect(ctx.destination);
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
  env.connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.52);

  openHatEnv = env;  // store for choke
}

function chokeOpenHat(t) {
  if (!openHatEnv) return;
  try {
    openHatEnv.gain.cancelScheduledValues(t);
    openHatEnv.gain.setValueAtTime(0.2, t);  // non-zero required for exponential ramp
    openHatEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
  } catch (_) { /* node may already be stopped */ }
  openHatEnv = null;
}

function synthCrash(v) {
  const t = ctx.currentTime;
  const src = mkNoise();
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.55, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 2.6);

  // Three resonant bandpass filters give the metallic shimmer
  [380, 760, 1520].forEach(freq => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = freq;
    bpf.Q.value = 3.5;
    src.connect(bpf);
    bpf.connect(env);
  });

  env.connect(ctx.destination);
  src.start(t);
  src.stop(t + 2.7);
}

function synthRide(v) {
  const t = ctx.currentTime;
  const src = mkNoise();
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.45, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 1.9);

  // Higher Q = more metallic ping, less washy
  [560, 1120, 2240].forEach(freq => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = freq;
    bpf.Q.value = 6;
    src.connect(bpf);
    bpf.connect(env);
  });

  env.connect(ctx.destination);
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
  env.gain.setValueAtTime(v * 0.9, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function synthClap(v) {
  const t = ctx.currentTime;
  // Three slightly staggered noise bursts mimic multiple hands clapping
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
    env.connect(ctx.destination);
    src.start(t + off);
    src.stop(t + off + 0.09);
  }
}

/** Dispatch table: pad id → synth function */
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

/**
 * Trigger a pad sound. Initialises AudioContext on first call (requires
 * a user-gesture to comply with browser autoplay policy).
 */
function trigger(id, velocity = 0.85) {
  ensureAudio();
  const fn = SYNTHS[id];
  if (!fn) return;
  // Small random velocity variation adds human feel
  const v = Math.min(1.0, velocity * (0.88 + Math.random() * 0.24));
  fn(v);
  flashPad(id);
}

// =====================================================================
// KEY BINDINGS
// =====================================================================

let bindings = {};    // padId → key string | null
let listening = null; // padId currently awaiting a new key

function defaultBindings() {
  return Object.fromEntries(PADS.map(p => [p.id, p.defaultKey]));
}

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    bindings = { ...defaultBindings(), ...saved };
  } catch (_) {
    bindings = defaultBindings();
  }
}

function saveBindings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch (_) {}
}

/** Return padId for a key, or null if unbound. */
function idForKey(key) {
  if (key === ' ') return SPACE_ID; // Space always = kick
  for (const [id, k] of Object.entries(bindings)) {
    if (k === key) return id;
  }
  return null;
}

// =====================================================================
// INPUT HANDLERS
// =====================================================================

function onKeyDown(e) {
  if (e.repeat) return; // ignore key-repeat; debounce is handled at OS level

  if (listening !== null) {
    handleAssign(e);
    return;
  }

  const id = idForKey(e.key);
  if (id) {
    e.preventDefault(); // block space-scroll, arrow-scroll, etc.
    trigger(id);
  }
}

function onPadPointerDown(e) {
  e.preventDefault(); // prevent touch delay and ghost clicks
  trigger(e.currentTarget.dataset.id);
}

function onBadgePointerDown(e) {
  // Prevent pointer event from bubbling to the pad and triggering a sound
  e.stopPropagation();
}

function onBadgeClick(e) {
  e.stopPropagation();
  startListening(e.currentTarget.dataset.id);
}

function handleAssign(e) {
  e.preventDefault();

  if (e.key === 'Escape') { stopListening(); return; }

  const id = listening;
  const key = e.key;

  // If another pad already uses this key, unassign it
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
// DOM
// =====================================================================

/** Human-readable label for a key string. */
function keyLabel(key) {
  if (!key) return '—';
  const aliases = {
    ' ':           'SPACE',
    'ArrowLeft':   '←',
    'ArrowRight':  '→',
    'ArrowUp':     '↑',
    'ArrowDown':   '↓',
    'Enter':       '↵',
    'Tab':         'TAB',
    'Backspace':   '⌫',
    'Delete':      'DEL',
    'Escape':      'ESC',
    'Control':     'CTRL',
    'Shift':       '⇧',
    'Alt':         'ALT',
    'Meta':        '⌘',
    'CapsLock':    'CAPS',
  };
  return aliases[key] ?? (key.length === 1 ? key.toUpperCase() : key);
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
    name.textContent = p.label; // CSS white-space:pre-line renders \n

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
  const b = document.querySelector(`.key-badge[data-id="${id}"]`);
  if (b) b.textContent = keyLabel(bindings[id]);
}

/**
 * Flash the pad's hit animation.
 * We remove then re-add the .active class, forcing a CSS animation restart
 * via a synchronous reflow (offsetWidth read). This ensures rapid hits
 * each get a fresh visual pulse.
 */
function flashPad(id) {
  const el = document.getElementById(`pad-${id}`);
  if (!el) return;
  el.classList.remove('active');
  void el.offsetWidth; // force reflow → restart @keyframes
  el.classList.add('active');
}

function startListening(id) {
  listening = id;
  document.getElementById(`pad-${id}`).classList.add('listening');
  document.getElementById('listen-name').textContent =
    PADS.find(p => p.id === id).label;
  document.getElementById('overlay').classList.remove('hidden');
}

function stopListening() {
  if (listening) {
    document.getElementById(`pad-${listening}`)?.classList.remove('listening');
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

  document.addEventListener('keydown', onKeyDown);

  // Clicking the overlay background cancels listening; clicking the box does not
  document.getElementById('overlay').addEventListener('click', stopListening);
  document.getElementById('listen-box').addEventListener('click', e => e.stopPropagation());
});
