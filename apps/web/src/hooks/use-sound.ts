'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuctionMoment } from './use-gavel-room';

const SOUND_KEY = 'gavel-xi:sound';

type Cue =
  'join' | 'reveal' | 'bid' | 'outbid' | 'sold' | 'unsold' | 'forced' | 'checkpoint' | 'winner';

function storedSound(fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(SOUND_KEY);
    return value === null ? fallback : value === 'on';
  } catch {
    return fallback;
  }
}

function oscillator(
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
): void {
  const source = context.createOscillator();
  const gain = context.createGain();
  source.type = type;
  source.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(volume, startsAt + Math.min(0.018, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
  source.connect(gain).connect(context.destination);
  source.start(startsAt);
  source.stop(startsAt + duration + 0.02);
}

function playPattern(context: AudioContext, cue: Cue): void {
  const now = context.currentTime + 0.01;
  if (cue === 'bid') {
    oscillator(context, 520, now, 0.08, 0.035, 'square');
    oscillator(context, 720, now + 0.07, 0.09, 0.025, 'square');
  } else if (cue === 'outbid') {
    oscillator(context, 280, now, 0.12, 0.045, 'sawtooth');
    oscillator(context, 210, now + 0.1, 0.16, 0.035, 'sawtooth');
  } else if (cue === 'sold') {
    oscillator(context, 82, now, 0.32, 0.16, 'sine');
    oscillator(context, 164, now, 0.2, 0.065, 'triangle');
    oscillator(context, 640, now + 0.22, 0.35, 0.04, 'sine');
    oscillator(context, 810, now + 0.3, 0.32, 0.03, 'sine');
  } else if (cue === 'unsold') {
    oscillator(context, 180, now, 0.35, 0.055, 'triangle');
    oscillator(context, 135, now + 0.2, 0.45, 0.04, 'triangle');
  } else if (cue === 'forced') {
    oscillator(context, 260, now, 0.16, 0.05, 'square');
    oscillator(context, 390, now + 0.16, 0.16, 0.05, 'square');
    oscillator(context, 520, now + 0.32, 0.3, 0.06, 'square');
  } else if (cue === 'reveal') {
    oscillator(context, 64, now, 0.7, 0.12, 'sine');
    oscillator(context, 320, now + 0.18, 0.5, 0.025, 'sine');
  } else if (cue === 'checkpoint') {
    [392, 494, 587].forEach((frequency, index) =>
      oscillator(context, frequency, now + index * 0.1, 0.32, 0.035, 'triangle'),
    );
  } else if (cue === 'winner') {
    [262, 330, 392, 523].forEach((frequency, index) =>
      oscillator(context, frequency, now + index * 0.13, 0.6, 0.045, 'triangle'),
    );
  } else {
    oscillator(context, 430, now, 0.1, 0.03, 'triangle');
    oscillator(context, 620, now + 0.09, 0.16, 0.025, 'triangle');
  }
}

function announce(moment: AuctionMoment): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const name = moment.lot?.candidate.commonName || moment.lot?.candidate.fullName;
  let message: string | null = null;
  if (moment.kind === 'reveal' && name) {
    const role = moment.lot?.candidate.kind === 'MANAGER' ? 'manager' : 'player';
    message = `Next ${role} is ${name}.`;
  }
  if (message === null) return;
  const utterance = new SpeechSynthesisUtterance(message);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith('en-gb')) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ??
    null;
  utterance.rate = 0.94;
  utterance.pitch = 0.92;
  utterance.volume = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function useSound(
  roomDefault: boolean,
  moment: AuctionMoment | null,
  backgroundActive: boolean,
) {
  const [enabled, setEnabled] = useState(roomDefault);
  const contextRef = useRef<AudioContext | null>(null);
  const backgroundRef = useRef<HTMLAudioElement | null>(null);
  const soldRef = useRef<HTMLAudioElement | null>(null);
  const playedMoment = useRef<number | null>(null);

  useEffect(() => setEnabled(storedSound(roomDefault)), [roomDefault]);

  useEffect(() => {
    const background = new Audio('/audio/background-music.mp3');
    background.loop = true;
    background.preload = 'auto';
    background.volume = 0.16;
    backgroundRef.current = background;
    const sold = new Audio('/audio/here-we-go.mp3');
    sold.preload = 'auto';
    sold.volume = 0.78;
    soldRef.current = sold;
    return () => {
      background.pause();
      sold.pause();
      backgroundRef.current = null;
      soldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background || process.env.NEXT_PUBLIC_E2E === 'true') return;
    if (!enabled || !backgroundActive) {
      background.pause();
      background.currentTime = 0;
      return;
    }
    const start = () => void background.play().catch(() => undefined);
    start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, [backgroundActive, enabled]);

  const play = useCallback(
    (cue: Cue) => {
      if (!enabled || process.env.NEXT_PUBLIC_E2E === 'true') return;
      try {
        const context = contextRef.current ?? new AudioContext();
        contextRef.current = context;
        void context.resume().then(() => playPattern(context, cue));
      } catch {
        // Audio is enhancement only; visual state always communicates the same event.
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!moment || playedMoment.current === moment.id) return;
    playedMoment.current = moment.id;
    const cue: Cue =
      moment.kind === 'complete' ? 'winner' : moment.kind === 'opened' ? 'reveal' : moment.kind;
    if (
      cue === 'outbid' ||
      cue === 'sold' ||
      cue === 'unsold' ||
      cue === 'forced' ||
      cue === 'checkpoint' ||
      cue === 'winner' ||
      cue === 'reveal' ||
      cue === 'bid'
    )
      play(cue);
    if (
      enabled &&
      process.env.NEXT_PUBLIC_E2E !== 'true' &&
      (moment.kind === 'sold' || moment.kind === 'forced')
    ) {
      const sold = soldRef.current;
      if (sold) {
        sold.currentTime = 0;
        void sold.play().catch(() => undefined);
      }
    }
    if (enabled && process.env.NEXT_PUBLIC_E2E !== 'true') announce(moment);
  }, [enabled, moment, play]);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        if (!next) {
          backgroundRef.current?.pause();
          soldRef.current?.pause();
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        } else if (backgroundActive) {
          void backgroundRef.current?.play().catch(() => undefined);
        }
      } catch {
        // Local preference persistence is optional.
      }
      return next;
    });
  }, [backgroundActive]);

  return { enabled, toggle, play };
}
