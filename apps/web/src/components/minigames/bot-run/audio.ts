export type SoundName = "jump" | "land" | "near-miss" | "combo" | "crash" | "milestone" | "toggle";

export interface Sound {
  /** Creates the AudioContext; call only from a user input handler. */
  unlock(): void;
  play(name: SoundName, detail?: number): void;
  suspend(): void;
  resume(): void;
  close(): void;
}

interface Tone {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly duration: number;
  readonly volume: number;
}

function tone(
  type: OscillatorType,
  from: number,
  to: number,
  start: number,
  duration: number,
  volume: number,
): Tone {
  return { type, from, to, start, duration, volume };
}

function tones(name: SoundName, detail: number): ReadonlyArray<Tone> {
  switch (name) {
    case "jump":
      return [tone("triangle", 360, 720, 0, 0.12, 0.5)];
    case "land":
      return [tone("sine", 150, 70, 0, 0.09, 0.35 * Math.max(0.3, Math.min(1, detail)))];
    case "near-miss":
      return [
        tone("triangle", 880, 880, 0, 0.07, 0.35),
        tone("triangle", 1320, 1320, 0.07, 0.12, 0.35),
      ];
    case "combo": {
      const base = 520 * 2 ** (Math.min(detail, 10) / 12);
      return [tone("sine", base, base * 1.5, 0, 0.09, 0.3)];
    }
    case "crash":
      return [tone("sawtooth", 260, 50, 0, 0.32, 0.35), tone("square", 120, 40, 0, 0.2, 0.2)];
    case "milestone":
      return [
        tone("triangle", 660, 660, 0, 0.08, 0.35),
        tone("triangle", 830, 830, 0.08, 0.08, 0.35),
        tone("triangle", 990, 990, 0.16, 0.16, 0.35),
      ];
    case "toggle":
      return [tone("sine", 600, 900, 0, 0.06, 0.3)];
  }
}

export function createSound(isMuted: () => boolean): Sound {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;

  return {
    unlock: () => {
      if (context || typeof AudioContext === "undefined") return;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.12;
      master.connect(context.destination);
      if (context.state === "suspended") void context.resume();
    },
    play: (name, detail = 1) => {
      if (!context || !master || isMuted() || context.state !== "running") return;
      const now = context.currentTime;
      for (const part of tones(name, detail)) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + part.start;
        const end = start + part.duration;
        oscillator.type = part.type;
        oscillator.frequency.setValueAtTime(part.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, part.to), end);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(part.volume, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain).connect(master);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
      }
    },
    suspend: () => {
      if (context?.state === "running") void context.suspend();
    },
    resume: () => {
      if (context?.state === "suspended") void context.resume();
    },
    close: () => {
      if (context) void context.close();
      context = null;
      master = null;
    },
  };
}
