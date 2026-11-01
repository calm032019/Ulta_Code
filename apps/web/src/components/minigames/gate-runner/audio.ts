import type { GameEvent } from "./logic";

type Wave = OscillatorType;

export interface GameAudio {
  /** Call from a user gesture; creates the context only when sound is wanted. */
  unlock(muted: boolean): void;
  play(events: ReadonlyArray<GameEvent>, muted: boolean): void;
  suspend(): void;
  resume(): void;
  close(): void;
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;

  const tone = (
    freq: number,
    at: number,
    length: number,
    wave: Wave,
    volume: number,
    slideTo = freq,
  ) => {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + length + 0.02);
  };

  const burst = (at: number, length: number, filterFreq: number, volume: number) => {
    if (!ctx || !master || !noise) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(filterFreq, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterFreq * 0.3), at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + length + 0.02);
  };

  const sound = (event: GameEvent) => {
    if (!ctx) return;
    const now = ctx.currentTime + 0.005;
    switch (event.type) {
      case "start":
        tone(440, now, 0.08, "triangle", 0.25, 660);
        tone(660, now + 0.07, 0.1, "triangle", 0.25, 880);
        return;
      case "gate": {
        const good = event.after >= event.before;
        if (!good) {
          tone(320, now, 0.22, "square", 0.12, 140);
          return;
        }
        const pitch = 2 ** (Math.min(event.combo, 12) / 12);
        tone(620 * pitch, now, 0.09, "triangle", 0.3, 760 * pitch);
        tone(930 * pitch, now + 0.06, 0.12, "sine", 0.2, 1240 * pitch);
        if (event.op.kind === "mul") {
          const steps = event.op.value === 3 ? 8 : 5;
          for (let i = 0; i < steps; i++) {
            tone(700 * pitch * 2 ** (i / 7), now + 0.08 + i * 0.035, 0.07, "sine", 0.14);
          }
        }
        return;
      }
      case "blade":
        burst(now, 0.18, 2600, 0.5);
        tone(180, now, 0.12, "sawtooth", 0.08, 90);
        return;
      case "enemy":
        burst(now, 0.14, 1400, 0.4);
        burst(now + 0.06, 0.1, 900, 0.3);
        return;
      case "wall":
        burst(now, event.passed ? 0.55 : 0.3, 700, 0.8);
        tone(140, now, 0.4, "sine", 0.5, 40);
        if (event.passed) {
          [523, 659, 784, 1047].forEach((freq, i) =>
            tone(freq, now + 0.25 + i * 0.09, 0.18, "triangle", 0.22),
          );
        }
        return;
      case "over":
        [392, 330, 262].forEach((freq, i) =>
          tone(freq, now + i * 0.13, 0.2, "triangle", 0.2, freq * 0.97),
        );
        return;
    }
  };

  return {
    unlock(muted) {
      if (muted || ctx || typeof AudioContext === "undefined") {
        if (ctx && !muted && ctx.state === "suspended") void ctx.resume();
        return;
      }
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
    },
    play(events, muted) {
      if (muted || !ctx || ctx.state !== "running") return;
      for (const event of events) sound(event);
    },
    suspend() {
      if (ctx && ctx.state === "running") void ctx.suspend();
    },
    resume() {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    },
    close() {
      if (ctx) void ctx.close();
      ctx = null;
      master = null;
      noise = null;
    },
  };
}
