import type { GameEvent, GameEventKind } from "./model";

interface Tone {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly length: number;
  readonly gain: number;
}

/** A burst of filtered white noise: gunshots, swishes, impacts. */
interface Noise {
  readonly filter: BiquadFilterType;
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly length: number;
  readonly gain: number;
}

interface Sound {
  readonly tones?: ReadonlyArray<Tone>;
  readonly noise?: ReadonlyArray<Noise>;
}

const tone = (
  type: OscillatorType,
  from: number,
  to: number,
  at: number,
  length: number,
  gain: number,
): Tone => ({ type, from, to, at, length, gain });

const noise = (
  filter: BiquadFilterType,
  from: number,
  to: number,
  at: number,
  length: number,
  gain: number,
): Noise => ({ filter, from, to, at, length, gain });

const SOUNDS: Partial<Record<GameEventKind, Sound>> = {
  start: { tones: [tone("triangle", 392, 784, 0, 0.16, 0.05)] },
  jump: { noise: [noise("highpass", 2400, 900, 0, 0.07, 0.05)] },
  land: { noise: [noise("lowpass", 900, 200, 0, 0.12, 0.12)] },
  trick: {
    tones: [
      tone("triangle", 659, 659, 0, 0.08, 0.05),
      tone("triangle", 988, 988, 0.07, 0.14, 0.05),
    ],
  },
  grindStart: { noise: [noise("bandpass", 3800, 2600, 0, 0.32, 0.06)] },
  shoot: {
    noise: [noise("lowpass", 4200, 300, 0, 0.16, 0.22)],
    tones: [tone("square", 180, 50, 0, 0.09, 0.06)],
  },
  empty: { tones: [tone("square", 1800, 1600, 0, 0.03, 0.04)] },
  slash: { noise: [noise("bandpass", 1800, 5200, 0, 0.13, 0.08)] },
  hitEnemy: { noise: [noise("lowpass", 700, 160, 0, 0.1, 0.12)] },
  kill: {
    noise: [noise("lowpass", 500, 90, 0, 0.22, 0.14)],
    tones: [tone("sawtooth", 220, 70, 0.02, 0.2, 0.035)],
  },
  enemyShot: { noise: [noise("lowpass", 2600, 220, 0, 0.18, 0.13)] },
  hurt: {
    noise: [noise("lowpass", 1200, 120, 0, 0.18, 0.14)],
    tones: [tone("sawtooth", 260, 90, 0, 0.22, 0.05)],
  },
  knock: { noise: [noise("bandpass", 600, 300, 0, 0.12, 0.1)] },
  pickup: {
    tones: [
      tone("triangle", 1175, 1175, 0, 0.06, 0.045),
      tone("triangle", 1568, 1568, 0.05, 0.1, 0.045),
    ],
  },
  zone: { tones: [tone("sine", 294, 440, 0, 0.4, 0.04)] },
  crash: {
    noise: [noise("lowpass", 1400, 80, 0, 0.45, 0.2)],
    tones: [tone("sawtooth", 200, 50, 0, 0.4, 0.05)],
  },
  over: {
    tones: [
      tone("triangle", 392, 392, 0.25, 0.18, 0.045),
      tone("triangle", 311, 311, 0.4, 0.18, 0.045),
      tone("triangle", 233, 220, 0.55, 0.45, 0.045),
    ],
  },
};

/** Synthesised effects only, so nothing is downloaded; the AudioContext waits for a gesture. */
export function createAudio() {
  let context: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let unlocked = false;

  const ensure = (muted: boolean) => {
    if (context || muted || !unlocked || typeof AudioContext === "undefined") return;
    context = new AudioContext();
    const length = Math.floor(context.sampleRate * 0.5);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  };

  const playTone = (ctx: AudioContext, now: number, sound: Tone) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + sound.at;
    oscillator.type = sound.type;
    oscillator.frequency.setValueAtTime(sound.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, sound.to), start + sound.length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(sound.gain, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + sound.length + 0.02);
  };

  const playNoise = (ctx: AudioContext, buffer: AudioBuffer, now: number, sound: Noise) => {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = now + sound.at;
    source.buffer = buffer;
    filter.type = sound.filter;
    filter.frequency.setValueAtTime(sound.from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, sound.to), start + sound.length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(sound.gain, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.length);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start, Math.random() * 0.25);
    source.stop(start + sound.length + 0.02);
  };

  return {
    unlock(muted: boolean) {
      unlocked = true;
      ensure(muted);
      if (!muted && context?.state === "suspended") void context.resume();
    },
    suspend() {
      if (context?.state === "running") void context.suspend();
    },
    resume(muted: boolean) {
      if (!muted && context?.state === "suspended") void context.resume();
    },
    play(events: ReadonlyArray<GameEvent>, muted: boolean) {
      if (muted || !context || !noiseBuffer || context.state !== "running") return;
      const now = context.currentTime;
      for (const event of events) {
        const sound = SOUNDS[event.kind];
        if (!sound) continue;
        for (const part of sound.tones ?? []) playTone(context, now, part);
        for (const part of sound.noise ?? []) playNoise(context, noiseBuffer, now, part);
      }
    },
    close() {
      void context?.close();
      context = null;
      noiseBuffer = null;
    },
  };
}
