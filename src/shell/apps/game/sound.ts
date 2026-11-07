/**
 * Block Hunt's sound, synthesised with WebAudio — no files, no requests, so it
 * works under the site's `connect-src 'self'` and costs nothing to load.
 *
 * Everything is a short envelope on an oscillator or a burst of shaped noise.
 * The context is created on the first gesture (browsers refuse audio before
 * one), suspended whenever the game pauses or the window is hidden, and closed
 * when the window closes. Mute is remembered per browser.
 */

const MUTE_KEY = "ph.game.muted";
/** Master level. Effects are mixed relative to this; keep it polite. */
const MASTER = 0.22;

export interface GameSound {
  muted(): boolean;
  setMuted(muted: boolean): void;
  /** Call from a user gesture (Descend, a key): creates or wakes the audio context. */
  unlock(): void;
  suspend(): void;
  resume(): void;
  /** A hash caught. `step` climbs with the streak, so a run of catches rises in pitch. */
  pickup(step: number): void;
  nonce(): void;
  overclock(): void;
  scrape(): void;
  stale(): void;
  rock(): void;
  cavein(): void;
  /** A soft tick while you breathe gas. */
  gas(): void;
  /** The lamp is nearly out. */
  lowLamp(): void;
  /** A difficulty adjustment: the descent surges. */
  whoosh(): void;
  win(): void;
  lose(): void;
  dispose(): void;
}

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

/** A major-pentatonic ladder for pickups, so any run of them sounds like a phrase. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const hz = (semis: number, base = 660) => base * Math.pow(2, semis / 12);

export function createGameSound(): GameSound {
  let muted = readMuted();
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;

  const ready = (): AudioContext | null => {
    if (muted || !ac || !master || ac.state !== "running") return null;
    return ac;
  };

  const tone = (type: OscillatorType, from: number, to: number, start: number, dur: number, level: number) => {
    const c = ready();
    if (!c || !master) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  const hiss = (filter: BiquadFilterType, freq: number, q: number, start: number, dur: number, level: number, sweepTo?: number) => {
    const c = ready();
    if (!c || !master || !noise) return;
    const t = c.currentTime + start;
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  };

  return {
    muted: () => muted,
    setMuted(m) {
      muted = m;
      try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* storage blocked: still mutes for now */ }
    },
    unlock() {
      if (muted) return;
      try {
        if (!ac) {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) return;
          ac = new Ctx();
          master = ac.createGain();
          master.gain.value = MASTER;
          master.connect(ac.destination);
          // One second of white noise, reused by every hiss and crunch.
          noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ac.state === "suspended") void ac.resume();
      } catch { /* no audio on this machine: the game is silent, not broken */ }
    },
    suspend() { if (ac && ac.state === "running") void ac.suspend(); },
    resume() { if (ac && !muted && ac.state === "suspended") void ac.resume(); },

    pickup(step) {
      const s = PENTA[Math.min(PENTA.length - 1, Math.max(0, step))]!;
      tone("triangle", hz(s), hz(s), 0, 0.07, 0.5);
      tone("sine", hz(s + 12), hz(s + 12), 0.005, 0.05, 0.12);
    },
    nonce() {
      tone("sine", hz(7, 880), hz(7, 880), 0, 0.5, 0.45);
      tone("sine", hz(12, 880), hz(12, 880), 0.07, 0.6, 0.35);
      tone("triangle", hz(19, 880), hz(19, 880), 0.14, 0.5, 0.15);
    },
    overclock() {
      tone("sawtooth", 220, 1320, 0, 0.35, 0.18);
      hiss("bandpass", 600, 1.5, 0, 0.35, 0.25, 4000);
    },
    scrape() { hiss("bandpass", 1400, 2.5, 0, 0.12, 0.35); },
    stale() {
      tone("square", 320, 120, 0, 0.18, 0.18);
      tone("square", 300, 110, 0.02, 0.18, 0.1);
    },
    rock() {
      tone("sine", 120, 42, 0, 0.32, 0.9);
      hiss("lowpass", 900, 0.7, 0, 0.22, 0.55, 200);
    },
    cavein() {
      hiss("lowpass", 700, 0.6, 0, 0.7, 0.7, 120);
      tone("sine", 90, 35, 0.03, 0.5, 0.7);
    },
    gas() { hiss("highpass", 3500, 0.8, 0, 0.16, 0.12); },
    lowLamp() {
      tone("square", 880, 880, 0, 0.06, 0.12);
      tone("square", 660, 660, 0.09, 0.08, 0.12);
    },
    whoosh() { hiss("bandpass", 300, 1.2, 0, 0.7, 0.4, 2600); },
    win() {
      [0, 4, 7, 12].forEach((s, i) => tone("square", hz(s, 523), hz(s, 523), i * 0.1, 0.18, 0.22));
      [0, 4, 7, 12].forEach((s, i) => tone("triangle", hz(s, 523), hz(s, 523), i * 0.1, 0.35, 0.3));
      tone("triangle", hz(16, 523), hz(16, 523), 0.42, 0.7, 0.35);
    },
    lose() {
      [7, 3, 0, -5].forEach((s, i) => tone("triangle", hz(s, 330), hz(s - 1, 330), i * 0.16, 0.3, 0.32));
      hiss("lowpass", 500, 0.5, 0.2, 0.9, 0.2, 80);
    },
    dispose() {
      try { void ac?.close(); } catch { /* already closed */ }
      ac = null;
      master = null;
      noise = null;
    },
  };
}
