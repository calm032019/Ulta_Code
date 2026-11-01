import type { GameEventKind } from "./logic";

interface Tone {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly length: number;
  readonly gain: number;
}

const tone = (
  type: OscillatorType,
  from: number,
  to: number,
  at: number,
  length: number,
  gain: number,
): Tone => ({
  type,
  from,
  to,
  at,
  length,
  gain,
});

const SOUNDS: Partial<Record<GameEventKind, ReadonlyArray<Tone>>> = {
  jump: [tone("square", 360, 640, 0, 0.11, 0.035)],
  airJump: [tone("triangle", 540, 980, 0, 0.12, 0.06)],
  land: [tone("sine", 150, 60, 0, 0.08, 0.08)],
  star: [
    tone("triangle", 1046, 1046, 0, 0.07, 0.05),
    tone("triangle", 1568, 1568, 0.06, 0.12, 0.05),
  ],
  stomp: [tone("square", 320, 110, 0, 0.13, 0.05), tone("triangle", 880, 1320, 0.05, 0.08, 0.04)],
  hurt: [tone("sawtooth", 240, 80, 0, 0.28, 0.05)],
  fall: [tone("sawtooth", 300, 70, 0, 0.35, 0.045)],
  complete: [
    tone("triangle", 523, 523, 0, 0.12, 0.05),
    tone("triangle", 659, 659, 0.1, 0.12, 0.05),
    tone("triangle", 784, 784, 0.2, 0.12, 0.05),
    tone("triangle", 1046, 1046, 0.3, 0.3, 0.06),
  ],
  over: [
    tone("triangle", 392, 392, 0, 0.18, 0.05),
    tone("triangle", 330, 330, 0.16, 0.18, 0.05),
    tone("triangle", 262, 250, 0.32, 0.4, 0.05),
  ],
};

/** Tiny synthesised effects; the AudioContext is created only after a user gesture while unmuted. */
export function createAudio() {
  let context: AudioContext | null = null;
  let enabled = false;
  let unlocked = false;

  const ensure = () => {
    if (context || !enabled || !unlocked || typeof AudioContext === "undefined") return;
    context = new AudioContext();
  };

  return {
    unlock() {
      unlocked = true;
      ensure();
      if (enabled && context?.state === "suspended") void context.resume();
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) {
        if (context?.state === "running") void context.suspend();
        return;
      }
      ensure();
      if (context?.state === "suspended") void context.resume();
    },
    suspend() {
      if (context?.state === "running") void context.suspend();
    },
    resume() {
      if (enabled && context?.state === "suspended") void context.resume();
    },
    play(kind: GameEventKind, strength = 1) {
      const tones = SOUNDS[kind];
      if (!enabled || !context || context.state !== "running" || !tones) return;
      const now = context.currentTime;
      for (const sound of tones) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + sound.at;
        oscillator.type = sound.type;
        oscillator.frequency.setValueAtTime(sound.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, sound.to),
          start + sound.length,
        );
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(sound.gain * strength, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.length);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + sound.length + 0.02);
      }
    },
    dispose() {
      void context?.close();
      context = null;
    },
  };
}
