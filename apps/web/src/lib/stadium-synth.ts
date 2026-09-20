import type { SoundCue } from './broadcast-audio';

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function tone(
  context: AudioContext,
  output: AudioNode,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  endFrequency = frequency,
): void {
  const source = context.createOscillator();
  const envelope = context.createGain();
  source.type = type;
  source.frequency.setValueAtTime(frequency, start);
  source.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.025, duration / 3));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(envelope).connect(output);
  source.onended = () => {
    source.disconnect();
    envelope.disconnect();
  };
  source.start(start);
  source.stop(start + duration + 0.025);
}

function air(
  context: AudioContext,
  output: AudioNode,
  start: number,
  duration: number,
  volume: number,
  rising = true,
): void {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < samples.length; index += 1) {
      last = (last + (Math.random() * 2 - 1) * 0.04) / 1.04;
      samples[index] = last * 3.5;
    }
    noiseBuffers.set(context, buffer);
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = 'bandpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(rising ? 350 : 4_200, start);
  filter.frequency.exponentialRampToValueAtTime(rising ? 4_200 : 180, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + duration * 0.55);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(envelope).connect(output);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  };
  source.start(start);
  source.stop(start + duration + 0.03);
}

export function createStadiumBus(context: AudioContext): GainNode {
  const master = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -16;
  limiter.knee.value = 12;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;
  master.connect(limiter).connect(context.destination);
  return master;
}

/** Short, layered broadcast stings generated locally; no external audio request per cue. */
export function playStadiumCue(context: AudioContext, output: AudioNode, cue: SoundCue): void {
  const now = context.currentTime + 0.012;
  const hit = (at = now, strength = 1) => {
    tone(context, output, 140, at, 0.42, 0.22 * strength, 'sine', 42);
    tone(context, output, 210, at, 0.095, 0.08 * strength, 'triangle', 70);
    air(context, output, at, 0.13, 0.32 * strength, false);
  };
  const chord = (frequencies: number[], at: number, duration: number, volume = 0.042) => {
    frequencies.forEach((frequency, index) => {
      tone(context, output, frequency, at + index * 0.035, duration, volume, 'triangle');
      tone(context, output, frequency * 2.002, at + index * 0.035, duration * 0.65, volume * 0.25);
    });
  };

  switch (cue) {
    case 'bid':
      tone(context, output, 640, now, 0.09, 0.05, 'sine', 1_000);
      tone(context, output, 1_280, now + 0.06, 0.12, 0.035);
      tone(context, output, 90, now, 0.15, 0.085, 'sine', 45);
      break;
    case 'outbid':
      tone(context, output, 460, now, 0.22, 0.065, 'triangle', 190);
      tone(context, output, 920, now + 0.05, 0.18, 0.025, 'sine', 380);
      air(context, output, now, 0.22, 0.18, false);
      break;
    case 'reveal':
      air(context, output, now, 0.9, 0.48);
      tone(context, output, 52, now, 0.95, 0.16, 'sine', 82);
      tone(context, output, 160, now, 0.58, 0.025, 'triangle', 960);
      hit(now + 0.6, 0.7);
      chord([294, 440, 587], now + 0.64, 0.65, 0.03);
      break;
    case 'sold':
      hit();
      hit(now + 0.14, 0.55);
      air(context, output, now + 0.12, 0.65, 0.32);
      chord([262, 330, 392, 523], now + 0.23, 1);
      break;
    case 'unsold':
      air(context, output, now, 0.5, 0.25, false);
      tone(context, output, 294, now, 0.4, 0.065, 'triangle', 147);
      tone(context, output, 110, now + 0.15, 0.5, 0.095, 'sine', 55);
      break;
    case 'forced':
      hit(now, 0.7);
      [220, 330, 440].forEach((frequency, index) =>
        tone(context, output, frequency, now + index * 0.12, 0.2, 0.055, 'triangle'),
      );
      break;
    case 'checkpoint':
      air(context, output, now, 0.65, 0.5);
      hit(now + 0.25);
      [196, 294, 392, 587].forEach((frequency, index) =>
        tone(context, output, frequency, now + 0.3 + index * 0.09, 0.48, 0.06, 'triangle'),
      );
      break;
    case 'category':
      hit(now, 0.6);
      air(context, output, now, 0.45, 0.3);
      chord([294, 370, 440], now + 0.1, 0.55);
      tone(context, output, 880, now + 0.25, 0.4, 0.035);
      break;
    case 'winner':
      air(context, output, now, 1.4, 0.55);
      hit(now + 0.1);
      hit(now + 0.45, 0.65);
      [262, 330, 392, 523, 659, 784].forEach((frequency, index) =>
        tone(context, output, frequency, now + 0.2 + index * 0.11, 0.9, 0.055, 'triangle'),
      );
      chord([262, 392, 523, 659], now + 0.9, 1.7, 0.045);
      break;
    case 'scan':
      [440, 554, 659].forEach((frequency, index) =>
        tone(context, output, frequency, now + index * 0.075, 0.15, 0.025),
      );
      air(context, output, now, 0.35, 0.16);
      break;
    case 'transition':
      air(context, output, now, 0.65, 0.36);
      tone(context, output, 55, now, 0.65, 0.12, 'sine', 80);
      break;
    default:
      chord([392, 587], now, 0.22, 0.035);
      tone(context, output, 784, now + 0.1, 0.18, 0.025);
  }
}
