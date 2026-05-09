/**
 * Drum Kit — app.js
 * Views: PAD · KIT · MIX (with FX) · SEQ (16-step sequencer)
 * Presets: ACOUSTIC · 808 · LO-FI · ELEC
 * Audio: Web Audio API synthesis only, no external files.
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
const FX_STORAGE_KEY  = 'drumkit-v1-fx';
const SEQ_STORAGE_KEY = 'drumkit-v1-seq';
const PRESET_KEY      = 'drumkit-v1-preset';

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

const SEQ_LABELS = {
  'kick':'KICK','snare':'SNR','hihat-c':'HH-C','hihat-o':'HH-O',
  'tom-h':'TM-H','tom-m':'TM-M','tom-l':'TM-L','crash':'CRSH','ride':'RIDE','clap':'CLAP',
};

const DEFAULT_VOLUMES = {
  'kick':1.4,'snare':1.3,'hihat-c':1.0,'hihat-o':1.0,
  'crash':0.6,'ride':0.55,'tom-h':1.1,'tom-m':1.3,'tom-l':1.4,'clap':0.65,
};

let padVolumes = { ...DEFAULT_VOLUMES };

// =====================================================================
// AUDIO ENGINE
// =====================================================================

let ctx        = null;
let noiseBuf   = null;
let openHatEnv = null;
let masterOut  = null;

// FX nodes (initialised in setupFX after ctx is created)
let reverbSend     = null;
let reverbNode     = null;
let delaySend      = null;
let delayNode      = null;
let delayFeedback  = null;

const DELAY_TIMES = { '1/16': 0, '1/8': 1, '1/4': 2, '3/8': 3 };
const DELAY_MS    = [125, 250, 500, 375]; // ms at 120 BPM; user can also sync to SEQ BPM

let fxState = { reverbWet: 20, reverbSize: 60, delayWet: 0, delayTimeIdx: 1, delayFeedback: 30 };

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
  setupFX();
  applyPreset(activePreset); // LO-FI needs ctx to build curve
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
// FX SETUP
// =====================================================================

function makeImpulse(sizePct) {
  const dur = 0.3 + (sizePct / 100) * 3.8;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5 + sizePct / 100);
    }
  }
  return buf;
}

function setupFX() {
  // Parallel reverb send: masterOut → reverbSend → convolver → destination
  reverbSend = ctx.createGain();
  reverbSend.gain.value = fxState.reverbWet / 100;
  reverbNode = ctx.createConvolver();
  reverbNode.buffer = makeImpulse(fxState.reverbSize);
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.72;
  masterOut.connect(reverbSend);
  reverbSend.connect(reverbNode);
  reverbNode.connect(reverbOut);
  reverbOut.connect(ctx.destination);

  // Parallel delay send: masterOut → delaySend → delay ⟲ feedback → destination
  delaySend = ctx.createGain();
  delaySend.gain.value = fxState.delayWet / 100;
  delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = DELAY_MS[fxState.delayTimeIdx] / 1000;
  delayFeedback = ctx.createGain();
  delayFeedback.gain.value = fxState.delayFeedback / 100;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.68;
  masterOut.connect(delaySend);
  delaySend.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode); // feedback loop
  delayNode.connect(delayOut);
  delayOut.connect(ctx.destination);
}

function setReverbWet(pct)     { fxState.reverbWet = pct;      if (reverbSend)   reverbSend.gain.value = pct / 100; }
function setReverbSize(pct)    { fxState.reverbSize = pct;     if (reverbNode)   { reverbNode.buffer = makeImpulse(pct); } }
function setDelayWet(pct)      { fxState.delayWet = pct;       if (delaySend)    delaySend.gain.value = pct / 100; }
function setDelayTimeIdx(idx)  { fxState.delayTimeIdx = idx;   if (delayNode)    delayNode.delayTime.value = DELAY_MS[idx] / 1000; }
function setDelayFeedback(pct) { fxState.delayFeedback = pct;  if (delayFeedback) delayFeedback.gain.value = pct / 100; }

// =====================================================================
// ACOUSTIC SYNTHS  (all functions: synthXxx(v, t) — t = scheduled time)
// =====================================================================

function synthKick(v, t) {
  const body    = ctx.createOscillator();
  const shaper  = ctx.createWaveShaper();
  const bodyEnv = ctx.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(120, t);
  body.frequency.exponentialRampToValueAtTime(36, t + 0.14);
  const sc = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; sc[i] = Math.tanh(x * 2.2); }
  shaper.curve = sc;
  bodyEnv.gain.setValueAtTime(v * 2.5, t);
  bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
  body.connect(shaper); shaper.connect(bodyEnv); bodyEnv.connect(masterOut);
  body.start(t); body.stop(t + 0.62);

  const sub    = ctx.createOscillator();
  const subEnv = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(50, t);
  sub.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  subEnv.gain.setValueAtTime(v * 0.95, t);
  subEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.78);
  sub.connect(subEnv); subEnv.connect(masterOut);
  sub.start(t); sub.stop(t + 0.82);

  const thud    = mkNoise();
  const lpf     = ctx.createBiquadFilter();
  const thudEnv = ctx.createGain();
  lpf.type = 'lowpass'; lpf.frequency.value = 180; lpf.Q.value = 0.8;
  thudEnv.gain.setValueAtTime(v * 1.8, t);
  thudEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
  thud.connect(lpf); lpf.connect(thudEnv); thudEnv.connect(masterOut);
  thud.start(t); thud.stop(t + 0.065);
}

function synthSnare(v, t) {
  const src = mkNoise();
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 260; bpf.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * 0.75, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
  src.connect(bpf); bpf.connect(ng); ng.connect(masterOut);
  src.start(t); src.stop(t + 0.21);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const tg = ctx.createGain();
  osc.frequency.setValueAtTime(210, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.1);
  tg.gain.setValueAtTime(v * 0.48, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(tg); tg.connect(masterOut);
  osc.start(t); osc.stop(t + 0.15);
}

function synthHiHatClosed(v, t) {
  chokeOpenHat(t);
  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 7500; hpf.Q.value = 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.32, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
  src.connect(hpf); hpf.connect(env); env.connect(masterOut);
  src.start(t); src.stop(t + 0.055);
}

function synthHiHatOpen(v, t) {
  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 7500; hpf.Q.value = 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.32, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
  src.connect(hpf); hpf.connect(env); env.connect(masterOut);
  src.start(t); src.stop(t + 0.52);
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

function synthCrash(v, t) {
  const src = mkNoise();
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.55, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
  [380, 760, 1520].forEach(freq => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = freq; bpf.Q.value = 3.5;
    src.connect(bpf); bpf.connect(env);
  });
  env.connect(masterOut);
  src.start(t); src.stop(t + 2.7);
}

function synthRide(v, t) {
  const src = mkNoise();
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.45, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
  [560, 1120, 2240].forEach(freq => {
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = freq; bpf.Q.value = 6;
    src.connect(bpf); bpf.connect(env);
  });
  env.connect(masterOut);
  src.start(t); src.stop(t + 2.0);
}

function synthTom(baseHz, endHz, dur, v, t) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseHz, t);
  osc.frequency.exponentialRampToValueAtTime(endHz, t + dur);
  env.gain.setValueAtTime(v * 1.2, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(env); env.connect(masterOut);
  osc.start(t); osc.stop(t + dur + 0.05);
}

function synthClap(v, t) {
  for (let i = 0; i < 3; i++) {
    const off = i * 0.013;
    const src = mkNoise();
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 1100; bpf.Q.value = 0.75;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, t + off);
    env.gain.linearRampToValueAtTime(v * 0.82, t + off + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.065);
    src.connect(bpf); bpf.connect(env); env.connect(masterOut);
    src.start(t + off); src.stop(t + off + 0.09);
  }
}

// =====================================================================
// 808 SYNTHS
// =====================================================================

function synth808Kick(v, t) {
  // Classic long sine pitch drop
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 0.85);
  env.gain.setValueAtTime(v * 3.0, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  osc.connect(env); env.connect(masterOut);
  osc.start(t); osc.stop(t + 1.15);

  // Attack click
  const click = mkNoise();
  const cf    = ctx.createBiquadFilter();
  cf.type = 'bandpass'; cf.frequency.value = 1800; cf.Q.value = 1;
  const ce = ctx.createGain();
  ce.gain.setValueAtTime(v * 0.35, t);
  ce.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
  click.connect(cf); cf.connect(ce); ce.connect(masterOut);
  click.start(t); click.stop(t + 0.018);
}

function synth808Snare(v, t) {
  // Wide, gated-reverb feel: noise + tone, longer decay
  const src = mkNoise();
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 300; bpf.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * 0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  src.connect(bpf); bpf.connect(ng); ng.connect(masterOut);
  src.start(t); src.stop(t + 0.31);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const tg = ctx.createGain();
  osc.frequency.setValueAtTime(240, t);
  osc.frequency.exponentialRampToValueAtTime(100, t + 0.2);
  tg.gain.setValueAtTime(v * 0.6, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(tg); tg.connect(masterOut);
  osc.start(t); osc.stop(t + 0.25);
}

// 808 hihat: stack of detuned square oscillators (TR-808 algorithm)
function synth808HiHat(v, t, duration) {
  const freqs = [200, 284, 376, 498, 672, 1000];
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 6500;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.18, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + duration);
  freqs.forEach(f => {
    const osc = ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = f;
    osc.connect(hpf); osc.start(t); osc.stop(t + duration + 0.01);
  });
  hpf.connect(env); env.connect(masterOut);
}

function synth808HiHatClosed(v, t) { chokeOpenHat(t); synth808HiHat(v, t, 0.05); }
function synth808HiHatOpen(v, t) {
  const src = mkNoise(); // open also uses noise for the tail
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 6500;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.18, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  synth808HiHat(v, t, 0.06); // metallic transient
  src.connect(hpf); hpf.connect(env); env.connect(masterOut);
  src.start(t); src.stop(t + 0.55);
  openHatEnv = env;
}

// =====================================================================
// LO-FI SYNTHS  (bit-crushed, muffled)
// =====================================================================

// Pre-computed 6-bit staircase WaveShaperNode curve
const LOFI_CURVE = (() => {
  const bits = 6, steps = Math.pow(2, bits), n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * steps) / steps; }
  return c;
})();

function lofiOut() {
  const crusher = ctx.createWaveShaper();
  crusher.curve = LOFI_CURVE;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 5500;
  crusher.connect(lpf); lpf.connect(masterOut);
  return crusher;
}

function synthLoFiKick(v, t) {
  const out = lofiOut();
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100, t);
  osc.frequency.exponentialRampToValueAtTime(36, t + 0.16);
  env.gain.setValueAtTime(v * 2.2, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(env); env.connect(out);
  osc.start(t); osc.stop(t + 0.55);

  const thud = mkNoise();
  const lp   = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 140;
  const te = ctx.createGain();
  te.gain.setValueAtTime(v * 1.4, t);
  te.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  thud.connect(lp); lp.connect(te); te.connect(out);
  thud.start(t); thud.stop(t + 0.05);
}

function synthLoFiSnare(v, t) {
  const out = lofiOut();
  const src = mkNoise();
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 220; bpf.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * 0.8, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(bpf); bpf.connect(ng); ng.connect(out);
  src.start(t); src.stop(t + 0.18);
}

function synthLoFiHiHatClosed(v, t) {
  chokeOpenHat(t);
  const out = lofiOut();
  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 4000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.28, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
  src.connect(hpf); hpf.connect(env); env.connect(out);
  src.start(t); src.stop(t + 0.05);
}

function synthLoFiHiHatOpen(v, t) {
  const out = lofiOut();
  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 4000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.26, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  src.connect(hpf); hpf.connect(env); env.connect(out);
  src.start(t); src.stop(t + 0.42);
  openHatEnv = env;
}

function synthLoFiClap(v, t) {
  const out = lofiOut();
  for (let i = 0; i < 2; i++) {
    const off = i * 0.018;
    const src = mkNoise();
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 800; bpf.Q.value = 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, t + off);
    env.gain.linearRampToValueAtTime(v * 0.7, t + off + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.07);
    src.connect(bpf); bpf.connect(env); env.connect(out);
    src.start(t + off); src.stop(t + off + 0.09);
  }
}

// =====================================================================
// ELECTRONIC SYNTHS  (tight, punchy, modern)
// =====================================================================

function synthElecKick(v, t) {
  // Very fast pitch drop (EDM punch)
  const osc    = ctx.createOscillator();
  const shaper = ctx.createWaveShaper();
  const env    = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.038);
  const sc = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; sc[i] = Math.tanh(x * 3.5); }
  shaper.curve = sc;
  env.gain.setValueAtTime(v * 3.2, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  osc.connect(shaper); shaper.connect(env); env.connect(masterOut);
  osc.start(t); osc.stop(t + 0.42);

  // High-pass click
  const click = mkNoise();
  const hpf   = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 3500;
  const ce = ctx.createGain();
  ce.gain.setValueAtTime(v * 0.5, t);
  ce.gain.exponentialRampToValueAtTime(0.001, t + 0.007);
  click.connect(hpf); hpf.connect(ce); ce.connect(masterOut);
  click.start(t); click.stop(t + 0.01);
}

function synthElecSnare(v, t) {
  // Wide-band noise + fast pitch snap
  const src = mkNoise();
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = 2800; bpf.Q.value = 0.6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * 1.1, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(bpf); bpf.connect(ng); ng.connect(masterOut);
  src.start(t); src.stop(t + 0.11);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const tg = ctx.createGain();
  osc.frequency.setValueAtTime(700, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.06);
  tg.gain.setValueAtTime(v * 0.65, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(tg); tg.connect(masterOut);
  osc.start(t); osc.stop(t + 0.07);
}

function synthElecHiHatClosed(v, t) {
  chokeOpenHat(t);
  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 9000; hpf.Q.value = 1.2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.36, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
  src.connect(hpf); hpf.connect(env); env.connect(masterOut);
  src.start(t); src.stop(t + 0.04);
}

function synthElecHiHatOpen(v, t) {
  const src = mkNoise();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 9000; hpf.Q.value = 1.2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(v * 0.34, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  src.connect(hpf); hpf.connect(env); env.connect(masterOut);
  src.start(t); src.stop(t + 0.6);
  openHatEnv = env;
}

function synthElecClap(v, t) {
  // 4-burst electronic clap with tight HPF
  for (let i = 0; i < 4; i++) {
    const off = i * 0.009;
    const src = mkNoise();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 1800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, t + off);
    env.gain.linearRampToValueAtTime(v * 0.9, t + off + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.045);
    src.connect(hpf); hpf.connect(env); env.connect(masterOut);
    src.start(t + off); src.stop(t + off + 0.06);
  }
}

// =====================================================================
// PRESET REGISTRY
// =====================================================================

const SYNTHS_ACOUSTIC = {
  'kick':    synthKick,
  'snare':   synthSnare,
  'hihat-c': synthHiHatClosed,
  'hihat-o': synthHiHatOpen,
  'crash':   synthCrash,
  'ride':    synthRide,
  'tom-h':   (v, t) => synthTom(300, 148, 0.30, v, t),
  'tom-m':   (v, t) => synthTom(200,  96, 0.36, v, t),
  'tom-l':   (v, t) => synthTom(118,  56, 0.52, v, t),
  'clap':    synthClap,
};

const PRESETS = {
  acoustic: {
    overrides: {},
  },
  '808': {
    overrides: {
      'kick':    synth808Kick,
      'snare':   synth808Snare,
      'hihat-c': synth808HiHatClosed,
      'hihat-o': synth808HiHatOpen,
    },
  },
  lofi: {
    overrides: {
      'kick':    synthLoFiKick,
      'snare':   synthLoFiSnare,
      'hihat-c': synthLoFiHiHatClosed,
      'hihat-o': synthLoFiHiHatOpen,
      'clap':    synthLoFiClap,
    },
  },
  elec: {
    overrides: {
      'kick':    synthElecKick,
      'snare':   synthElecSnare,
      'hihat-c': synthElecHiHatClosed,
      'hihat-o': synthElecHiHatOpen,
      'clap':    synthElecClap,
    },
  },
};

let activePreset = 'acoustic';

function getSynth(id) {
  return PRESETS[activePreset].overrides[id] ?? SYNTHS_ACOUSTIC[id];
}

function applyPreset(id) {
  activePreset = id;
  document.querySelectorAll('.preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === id)
  );
  try { localStorage.setItem(PRESET_KEY, id); } catch (_) {}
}

// =====================================================================
// TRIGGER
// =====================================================================

function trigger(id, velocity = 0.85, at = null) {
  if (at === null) ensureAudio();
  const fn = getSynth(id);
  if (!fn) return;
  const vol = padVolumes[id] ?? 1.0;
  const v   = velocity * (0.88 + Math.random() * 0.24) * vol;
  fn(v, at !== null ? at : ctx.currentTime);
  if (at === null) flashPad(id);
}

// =====================================================================
// SEQ ENGINE  — Chris Wilson look-ahead scheduler
// =====================================================================

const SEQ_STEPS   = 16;
const LOOK_AHEAD  = 0.12;   // seconds to schedule ahead
const SCHED_MS    = 25;     // scheduler poll interval (ms)

let seqPattern  = Object.fromEntries(MIX_ORDER.map(id => [id, new Array(SEQ_STEPS).fill(false)]));
let seqBpm      = 120;
let seqSwing    = 0;   // 0-50 (% of 16th note pushed late for odd steps)
let seqPlaying  = false;
let seqStep     = 0;   // next step to schedule
let seqNextTime = 0;   // audio context time for that step
let seqTimerId  = null;
let seqVisStep  = -1;  // currently highlighted step (for UI)
let tapTimes    = [];

function stepDur() { return 60 / seqBpm / 4; } // 16th note in seconds

function seqSchedule() {
  if (!ctx || !seqPlaying) return;
  while (seqNextTime < ctx.currentTime + LOOK_AHEAD) {
    const dur  = stepDur();
    const isOdd = (seqStep % 2) === 1;
    const playAt = seqNextTime + (isOdd ? dur * (seqSwing / 100) * 0.5 : 0);

    MIX_ORDER.forEach(id => {
      if (seqPattern[id][seqStep]) trigger(id, 0.85, playAt);
    });

    // Schedule visual update
    const visualDelay = Math.max(0, (playAt - ctx.currentTime) * 1000);
    const capturedStep = seqStep;
    setTimeout(() => { if (seqPlaying) setSeqVisStep(capturedStep); }, visualDelay);

    seqNextTime += dur;
    seqStep = (seqStep + 1) % SEQ_STEPS;
  }
}

function seqStart() {
  ensureAudio();
  seqPlaying = true;
  seqStep = 0;
  seqNextTime = ctx.currentTime + 0.05;
  seqTimerId = setInterval(seqSchedule, SCHED_MS);
  updateSeqPlayBtn();
}

function seqStop() {
  seqPlaying = false;
  clearInterval(seqTimerId);
  seqTimerId = null;
  setSeqVisStep(-1);
  updateSeqPlayBtn();
}

function seqToggle() { seqPlaying ? seqStop() : seqStart(); }

function setSeqVisStep(step) {
  seqVisStep = step;
  document.querySelectorAll('.seq-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('current', s === step);
  });
}

function updateSeqPlayBtn() {
  const btn = document.getElementById('seq-play-btn');
  if (!btn) return;
  if (seqPlaying) {
    btn.textContent = '■ STOP';
    btn.classList.add('playing');
  } else {
    btn.textContent = '▶ PLAY';
    btn.classList.remove('playing');
  }
}

function updateBpmDisplay() {
  const el = document.getElementById('seq-bpm-display');
  if (el) el.textContent = String(seqBpm);
  // Keep delay time in sync if user picked a note-division
  if (delayNode) {
    const ms = (60 / seqBpm) * [0.25, 0.5, 1, 0.75][fxState.delayTimeIdx] * 1000;
    delayNode.delayTime.value = ms / 1000;
    DELAY_MS[fxState.delayTimeIdx] = ms; // update reference
  }
}

function tapTempo() {
  const now = performance.now();
  tapTimes.push(now);
  if (tapTimes.length > 4) tapTimes.shift();
  if (tapTimes.length >= 2) {
    let sum = 0;
    for (let i = 1; i < tapTimes.length; i++) sum += tapTimes[i] - tapTimes[i-1];
    seqBpm = Math.round(60000 / (sum / (tapTimes.length - 1)));
    seqBpm = Math.max(40, Math.min(240, seqBpm));
    updateBpmDisplay();
  }
}

function updateSwingSlider(slider) {
  slider.style.setProperty('--pct', `${(seqSwing / 50) * 100}%`);
}

function saveSeq() {
  try {
    localStorage.setItem(SEQ_STORAGE_KEY, JSON.stringify({ pattern: seqPattern, bpm: seqBpm, swing: seqSwing }));
  } catch (_) {}
}

function loadSeq() {
  try {
    const raw = localStorage.getItem(SEQ_STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.pattern) {
      MIX_ORDER.forEach(id => {
        if (Array.isArray(d.pattern[id])) seqPattern[id] = d.pattern[id].slice(0, SEQ_STEPS);
      });
    }
    if (d.bpm)   seqBpm   = Math.max(40, Math.min(240, d.bpm));
    if (d.swing !== undefined) seqSwing = Math.max(0, Math.min(50, d.swing));
  } catch (_) {}
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
// FX STATE
// =====================================================================

function loadFX() {
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY);
    if (raw) fxState = { ...fxState, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveFX() {
  try { localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(fxState)); } catch (_) {}
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
  for (const [id, k] of Object.entries(bindings)) { if (k === key) return id; }
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

const ALL_VIEWS = ['pad', 'kit', 'mix', 'seq'];

function switchView(view) {
  document.getElementById('kit-grid').classList.toggle('hidden', view !== 'pad');
  document.getElementById('kit-view').classList.toggle('hidden', view !== 'kit');
  document.getElementById('mix-view').classList.toggle('hidden', view !== 'mix');
  document.getElementById('seq-view').classList.toggle('hidden', view !== 'seq');
  document.querySelectorAll('.view-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view)
  );
}

// =====================================================================
// SVG KIT VIEW  (unchanged from original)
// =====================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

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
      cx: cx - hx * 0.12, cy, r: Math.round(Math.min(hx, hy) * 0.1), fill: '#c8c4bc',
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
    cx, cy, rx, ry, fill: 'url(#g-cymbal)', stroke: '#3a2000', 'stroke-width': '0.8',
  }));
  for (const s of [0.87, 0.73, 0.58, 0.44, 0.29]) {
    g.append(svgEl('ellipse', {
      cx, cy, rx: Math.round(rx * s), ry: Math.round(ry * s),
      fill: 'none', stroke: 'rgba(0,0,0,0.25)', 'stroke-width': '0.6',
    }));
  }
  const bx = Math.max(8, Math.round(rx * 0.2)), by = Math.round(ry * 0.88);
  g.append(svgEl('ellipse', {
    cx, cy, rx: bx, ry: by, fill: 'url(#g-bell)', stroke: '#7a4800', 'stroke-width': '0.7',
  }));
  g.append(svgEl('circle', {
    cx, cy, r: Math.max(2, Math.round(ry * 0.55)), fill: '#1a0e00',
  }));
  g.append(svgEl('ellipse', {
    cx: cx - rx * 0.3, cy: cy - ry * 0.22,
    rx: rx * 0.2, ry: ry * 0.58,
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
  g.append(svgEl('rect', { x: x+inset, y: y+inset, width: w-inset*2, height: h-inset*2, rx: 3, fill: '#111611' }));
  const ldx = cx + rx - 10, ldy = cy - ry + 8;
  g.append(svgEl('circle', { cx: ldx, cy: ldy, r: 3, fill: 'var(--ac)', 'fill-opacity': '0.9' }));
  g.append(svgEl('circle', { cx: ldx, cy: ldy, r: 5, fill: 'none', stroke: 'var(--ac)', 'stroke-width': '1', 'stroke-opacity': '0.4' }));
}

function addLabels(g, item, label, keyTxt) {
  let nameY, badgeY;
  if (item.labelDir === 0)       { nameY = item.cy - 5;               badgeY = item.cy + 10; }
  else if (item.labelDir === 1)  { nameY = item.cy + item.ry + 14;    badgeY = item.cy + item.ry + 27; }
  else                            { nameY = item.cy - item.ry - 17;   badgeY = item.cy - item.ry - 4; }

  const nameEl = svgEl('text', { x: item.cx, y: nameY, class: 'kit-name', 'text-anchor': 'middle' });
  nameEl.textContent = label;

  const bw = Math.max(22, keyTxt.length * 7 + 10), bh = 14;
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

  document.getElementById('kit-svg').addEventListener('pointerdown', e => {
    const badge = e.target.closest('.kit-badge-group');
    if (badge) { e.preventDefault(); e.stopPropagation(); startListening(badge.dataset.id); return; }
    const item = e.target.closest('.kit-item');
    if (item) { e.preventDefault(); trigger(item.dataset.id); }
  });

  document.getElementById('kit-svg').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.kit-item');
    if (item) { e.preventDefault(); trigger(item.dataset.id); }
  });
}

// =====================================================================
// MIXER VIEW  (instruments + FX section)
// =====================================================================

function updateSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--pct', `${pct.toFixed(1)}%`);
}

function makeFXSlider(min, max, value, color) {
  const sl = document.createElement('input');
  sl.type = 'range'; sl.className = 'mix-slider';
  sl.min = String(min); sl.max = String(max); sl.value = String(value);
  sl.style.setProperty('--ac', color);
  updateSliderFill(sl);
  return sl;
}

function buildMixerView() {
  const container = document.getElementById('mix-view');

  // ── Instrument sliders ──
  const resetAllBtn = document.createElement('button');
  resetAllBtn.className = 'mix-reset-all';
  resetAllBtn.textContent = 'RESET ALL';
  resetAllBtn.addEventListener('click', () => {
    padVolumes = { ...DEFAULT_VOLUMES };
    saveVolumes();
    container.querySelectorAll('.mix-slider').forEach(sl => {
      if (!sl.dataset.id) return;
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
    slider.type = 'range'; slider.className = 'mix-slider';
    slider.min = '0'; slider.max = '200'; slider.step = '5';
    slider.value = String(Math.round(vol * 100));
    slider.dataset.id = id;
    slider.style.setProperty('--ac', color);
    updateSliderFill(slider);

    const valDisplay = document.createElement('span');
    valDisplay.className = 'mix-val';
    valDisplay.textContent = `${Math.round(vol * 100)}%`;

    const resetBtn = document.createElement('button');
    resetBtn.className = 'mix-reset'; resetBtn.textContent = '↺'; resetBtn.title = 'Reset';
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

  // ── FX section ──
  const fxLabel = document.createElement('div');
  fxLabel.className = 'mix-section-label';
  fxLabel.textContent = 'EFFECTS';
  container.append(fxLabel);

  const fxBlock = document.createElement('div');
  fxBlock.className = 'mix-fx-block';

  // Reverb wet
  const rvWetRow = document.createElement('div'); rvWetRow.className = 'mix-fx-row';
  const rvWetLbl = document.createElement('span'); rvWetLbl.className = 'mix-fx-label'; rvWetLbl.textContent = 'RVB WET';
  const rvWetSl  = makeFXSlider(0, 100, fxState.reverbWet, '#38bdf8');
  const rvWetVal = document.createElement('span'); rvWetVal.className = 'mix-fx-val'; rvWetVal.textContent = `${fxState.reverbWet}%`;
  rvWetSl.addEventListener('input', () => {
    setReverbWet(parseInt(rvWetSl.value));
    rvWetVal.textContent = `${rvWetSl.value}%`;
    updateSliderFill(rvWetSl); saveFX();
  });
  rvWetRow.append(rvWetLbl, rvWetSl, rvWetVal);

  // Reverb size
  const rvSzRow = document.createElement('div'); rvSzRow.className = 'mix-fx-row';
  const rvSzLbl = document.createElement('span'); rvSzLbl.className = 'mix-fx-label'; rvSzLbl.textContent = 'RVB SIZE';
  const rvSzSl  = makeFXSlider(5, 100, fxState.reverbSize, '#38bdf8');
  const rvSzVal = document.createElement('span'); rvSzVal.className = 'mix-fx-val'; rvSzVal.textContent = `${fxState.reverbSize}%`;
  let rvSzTimer = null;
  rvSzSl.addEventListener('input', () => {
    fxState.reverbSize = parseInt(rvSzSl.value);
    rvSzVal.textContent = `${rvSzSl.value}%`;
    updateSliderFill(rvSzSl);
    clearTimeout(rvSzTimer);
    rvSzTimer = setTimeout(() => { setReverbSize(fxState.reverbSize); saveFX(); }, 300);
  });
  rvSzRow.append(rvSzLbl, rvSzSl, rvSzVal);

  // Delay wet
  const dlWetRow = document.createElement('div'); dlWetRow.className = 'mix-fx-row';
  const dlWetLbl = document.createElement('span'); dlWetLbl.className = 'mix-fx-label'; dlWetLbl.textContent = 'DLY WET';
  const dlWetSl  = makeFXSlider(0, 100, fxState.delayWet, '#fb923c');
  const dlWetVal = document.createElement('span'); dlWetVal.className = 'mix-fx-val'; dlWetVal.textContent = `${fxState.delayWet}%`;
  dlWetSl.addEventListener('input', () => {
    setDelayWet(parseInt(dlWetSl.value));
    dlWetVal.textContent = `${dlWetSl.value}%`;
    updateSliderFill(dlWetSl); saveFX();
  });
  dlWetRow.append(dlWetLbl, dlWetSl, dlWetVal);

  // Delay time buttons (synced to SEQ BPM)
  const dlTimeRow = document.createElement('div'); dlTimeRow.className = 'mix-delay-time-row';
  const dlTimeLbl = document.createElement('span'); dlTimeLbl.className = 'mix-fx-label'; dlTimeLbl.textContent = 'DLY TIME';
  const dlTimeBtns = document.createElement('div'); dlTimeBtns.className = 'delay-time-btns';
  ['1/16','1/8','1/4','3/8'].forEach((label, idx) => {
    const btn = document.createElement('button');
    btn.className = 'delay-time-btn' + (idx === fxState.delayTimeIdx ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      setDelayTimeIdx(idx);
      dlTimeBtns.querySelectorAll('.delay-time-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
      saveFX();
    });
    dlTimeBtns.append(btn);
  });
  dlTimeRow.append(dlTimeLbl, dlTimeBtns);

  // Delay feedback
  const dlFbRow = document.createElement('div'); dlFbRow.className = 'mix-fx-row';
  const dlFbLbl = document.createElement('span'); dlFbLbl.className = 'mix-fx-label'; dlFbLbl.textContent = 'DLY FB';
  const dlFbSl  = makeFXSlider(0, 80, fxState.delayFeedback, '#fb923c');
  const dlFbVal = document.createElement('span'); dlFbVal.className = 'mix-fx-val'; dlFbVal.textContent = `${fxState.delayFeedback}%`;
  dlFbSl.addEventListener('input', () => {
    setDelayFeedback(parseInt(dlFbSl.value));
    dlFbVal.textContent = `${dlFbSl.value}%`;
    updateSliderFill(dlFbSl); saveFX();
  });
  dlFbRow.append(dlFbLbl, dlFbSl, dlFbVal);

  fxBlock.append(rvWetRow, rvSzRow, dlWetRow, dlTimeRow, dlFbRow);
  container.append(fxBlock);
}

// =====================================================================
// SEQ VIEW
// =====================================================================

function buildSeqView() {
  const container = document.getElementById('seq-view');

  // Transport bar
  const transport = document.createElement('div');
  transport.className = 'seq-transport';

  // BPM group
  const bpmGroup = document.createElement('div'); bpmGroup.className = 'seq-bpm-group';
  const bpmLabel = document.createElement('span');
  bpmLabel.style.cssText = 'font-family:var(--mono);font-size:0.6rem;font-weight:700;letter-spacing:.1em;color:var(--text-dim);';
  bpmLabel.textContent = 'BPM';
  const bpmDown = document.createElement('button'); bpmDown.className = 'seq-icon-btn'; bpmDown.textContent = '−';
  const bpmDisplay = document.createElement('span');
  bpmDisplay.className = 'seq-bpm-display'; bpmDisplay.id = 'seq-bpm-display'; bpmDisplay.textContent = String(seqBpm);
  const bpmUp = document.createElement('button'); bpmUp.className = 'seq-icon-btn'; bpmUp.textContent = '+';
  bpmDown.addEventListener('click', () => { seqBpm = Math.max(40, seqBpm - 1); updateBpmDisplay(); saveSeq(); });
  bpmUp.addEventListener('click',   () => { seqBpm = Math.min(240, seqBpm + 1); updateBpmDisplay(); saveSeq(); });
  bpmGroup.append(bpmLabel, bpmDown, bpmDisplay, bpmUp);

  const tapBtn = document.createElement('button'); tapBtn.className = 'seq-btn'; tapBtn.textContent = 'TAP';
  tapBtn.addEventListener('click', () => { tapTempo(); saveSeq(); });

  const div1 = document.createElement('div'); div1.className = 'seq-divider';

  // Swing
  const swingGroup = document.createElement('div'); swingGroup.className = 'seq-swing-group';
  const swingLbl = document.createElement('span'); swingLbl.className = 'seq-swing-label'; swingLbl.textContent = 'SWING';
  const swingSl = document.createElement('input');
  swingSl.type = 'range'; swingSl.className = 'seq-swing-slider';
  swingSl.min = '0'; swingSl.max = '50'; swingSl.value = String(seqSwing);
  updateSwingSlider(swingSl);
  const swingVal = document.createElement('span'); swingVal.className = 'seq-swing-val'; swingVal.textContent = `${seqSwing}%`;
  swingSl.addEventListener('input', () => {
    seqSwing = parseInt(swingSl.value);
    swingVal.textContent = `${seqSwing}%`;
    updateSwingSlider(swingSl); saveSeq();
  });
  swingGroup.append(swingLbl, swingSl, swingVal);

  const div2 = document.createElement('div'); div2.className = 'seq-divider';

  // Play / Stop
  const playBtn = document.createElement('button');
  playBtn.className = 'seq-btn seq-play-btn'; playBtn.id = 'seq-play-btn'; playBtn.textContent = '▶ PLAY';
  playBtn.addEventListener('click', seqToggle);

  const clearBtn = document.createElement('button'); clearBtn.className = 'seq-btn'; clearBtn.textContent = 'CLEAR';
  clearBtn.addEventListener('click', () => {
    MIX_ORDER.forEach(id => seqPattern[id].fill(false));
    document.querySelectorAll('.seq-step.on').forEach(el => el.classList.remove('on'));
    saveSeq();
  });

  transport.append(bpmGroup, tapBtn, div1, swingGroup, div2, playBtn, clearBtn);
  container.append(transport);

  // Grid
  const gridWrap = document.createElement('div'); gridWrap.className = 'seq-grid';

  // Step number header
  const header = document.createElement('div'); header.className = 'seq-step-header';
  const corner = document.createElement('div'); corner.className = 'seq-step-num';
  header.append(corner);
  for (let s = 0; s < SEQ_STEPS; s++) {
    const numEl = document.createElement('div');
    numEl.className = 'seq-step-num' + (s % 4 === 0 ? ' beat-mark' : '');
    numEl.textContent = String(s + 1);
    header.append(numEl);
  }
  gridWrap.append(header);

  // Instrument rows
  MIX_ORDER.forEach(id => {
    const color = PAD_COLORS[id];
    const row   = document.createElement('div'); row.className = 'seq-row';

    const lbl = document.createElement('div');
    lbl.className = 'seq-row-label';
    lbl.textContent = SEQ_LABELS[id];
    lbl.style.color = color;
    row.append(lbl);

    for (let s = 0; s < SEQ_STEPS; s++) {
      const cell = document.createElement('div');
      cell.className = 'seq-step' + (s % 4 === 0 ? ' beat-start' : '');
      cell.dataset.id   = id;
      cell.dataset.step = String(s);
      cell.style.setProperty('--ac', color);
      if (seqPattern[id][s]) cell.classList.add('on');

      cell.addEventListener('pointerdown', e => {
        e.preventDefault();
        seqPattern[id][s] = !seqPattern[id][s];
        cell.classList.toggle('on', seqPattern[id][s]);
        saveSeq();
      });
      row.append(cell);
    }
    gridWrap.append(row);
  });

  container.append(gridWrap);
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
    div.className = 'pad'; div.id = `pad-${p.id}`; div.dataset.id = p.id;
    div.addEventListener('pointerdown', onPadPointerDown);

    const name = document.createElement('span');
    name.className = 'pad-name'; name.textContent = p.label;

    const badge = document.createElement('button');
    badge.className = 'key-badge'; badge.dataset.id = p.id;
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
  loadFX();
  loadSeq();

  // Restore preset
  try {
    const saved = localStorage.getItem(PRESET_KEY);
    if (saved && PRESETS[saved]) activePreset = saved;
  } catch (_) {}

  buildPads();
  initKitView();
  buildMixerView();
  buildSeqView();

  // Set initial preset button state
  document.querySelectorAll('.preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === activePreset)
  );

  document.addEventListener('keydown', onKeyDown);

  document.querySelectorAll('.view-tab').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );

  document.querySelectorAll('.preset-btn').forEach(btn =>
    btn.addEventListener('click', () => { ensureAudio(); applyPreset(btn.dataset.preset); })
  );

  document.getElementById('overlay').addEventListener('click', stopListening);
  document.getElementById('listen-box').addEventListener('click', e => e.stopPropagation());
});
