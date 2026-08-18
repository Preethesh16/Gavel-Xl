'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuctionMoment } from './use-gavel-room';

const SOUND_KEY = 'gavel-xi:sound';

type Cue =
  'join' | 'reveal' | 'bid' | 'outbid' | 'sold' | 'unsold' | 'forced' | 'checkpoint' | 'winner';

export type MusicMode = 'lobby' | 'auction' | 'off';

interface PendingAnnouncement {
  key: string;
  message: string;
}

type SoundTestWindow = typeof window & {
  __GAVEL_SOUND_TEST__?: boolean;
  __gavelCues?: Cue[];
};

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
    oscillator(context, 220, now, 0.24, 0.11, 'sawtooth');
    oscillator(context, 165, now + 0.22, 0.3, 0.095, 'sawtooth');
    oscillator(context, 110, now + 0.5, 0.48, 0.08, 'triangle');
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

function announcementFor(moment: AuctionMoment): { key: string; message: string } | null {
  const name = moment.lot?.candidate.commonName || moment.lot?.candidate.fullName;
  if ((moment.kind === 'reveal' || moment.kind === 'opened') && name && moment.lot) {
    const role = moment.lot?.candidate.kind === 'MANAGER' ? 'manager' : 'player';
    return { key: moment.lot.id, message: `Next ${role} is ${name}.` };
  }
  return null;
}

function speechAllowed(): boolean {
  if (process.env.NEXT_PUBLIC_E2E !== 'true') return true;
  return Boolean(typeof window !== 'undefined' && (window as SoundTestWindow).__GAVEL_SOUND_TEST__);
}

function audioAllowed(): boolean {
  return process.env.NEXT_PUBLIC_E2E !== 'true' || speechAllowed();
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const language = voice.lang.toLocaleLowerCase();
  if (!language.startsWith('en')) return -10_000;
  const name = voice.name.toLocaleLowerCase();
  let score = language.startsWith('en-gb') ? 25 : language.startsWith('en-us') ? 20 : 10;
  for (const [keyword, points] of [
    ['natural', 180],
    ['neural', 170],
    ['premium', 150],
    ['enhanced', 140],
    ['google', 100],
    ['microsoft', 90],
    ['samantha', 85],
    ['sonia', 85],
    ['aria', 85],
    ['jenny', 80],
    ['daniel', 75],
    ['ryan', 75],
  ] as const) {
    if (name.includes(keyword)) score += points;
  }
  if (name.includes('espeak') || name.includes('festival') || name.includes('compact'))
    score -= 300;
  return score;
}

function utteranceFor(message: string, onDone: () => void): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(message);
  const voices = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLocaleLowerCase().startsWith('en'))
    .sort((left, right) => voiceScore(right) - voiceScore(left));
  utterance.voice = voices[0] ?? null;
  utterance.rate = 0.97;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onend = onDone;
  utterance.onerror = onDone;
  return utterance;
}

export function useSound(roomDefault: boolean, moment: AuctionMoment | null, musicMode: MusicMode) {
  const [enabled, setEnabled] = useState(roomDefault);
  const enabledRef = useRef(enabled);
  const musicModeRef = useRef(musicMode);
  const contextRef = useRef<AudioContext | null>(null);
  const backgroundRef = useRef<HTMLAudioElement | null>(null);
  const soldRef = useRef<HTMLAudioElement | null>(null);
  const playedMoment = useRef<number | null>(null);
  const announcedLot = useRef<string | null>(null);
  const announcementTimer = useRef<number | null>(null);
  const pendingAnnouncement = useRef<PendingAnnouncement | null>(null);
  const duckReasons = useRef(new Set<'sold' | 'speech'>());

  enabledRef.current = enabled;
  musicModeRef.current = musicMode;

  const updateMusicMix = useCallback(() => {
    const background = backgroundRef.current;
    if (!background) return;
    const baseVolume = musicModeRef.current === 'auction' ? 0.09 : 0.16;
    background.volume = duckReasons.current.size > 0 ? Math.min(baseVolume, 0.035) : baseVolume;
  }, []);

  const setDucked = useCallback(
    (reason: 'sold' | 'speech', active: boolean) => {
      if (active) duckReasons.current.add(reason);
      else duckReasons.current.delete(reason);
      updateMusicMix();
    },
    [updateMusicMix],
  );

  const flushAnnouncement = useCallback(() => {
    if (
      !enabledRef.current ||
      !speechAllowed() ||
      !pendingAnnouncement.current ||
      !('speechSynthesis' in window)
    )
      return;
    const sold = soldRef.current;
    if (sold && !sold.paused && !sold.ended) return;

    const pending = pendingAnnouncement.current;
    pendingAnnouncement.current = null;
    if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current);
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    announcementTimer.current = window.setTimeout(() => {
      if (!enabledRef.current) return;
      const finish = () => setDucked('speech', false);
      const utterance = utteranceFor(pending.message, finish);
      setDucked('speech', true);
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
      announcementTimer.current = null;
    }, 80);
  }, [setDucked]);

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
    const soldFinished = () => {
      setDucked('sold', false);
      flushAnnouncement();
    };
    sold.addEventListener('ended', soldFinished);
    sold.addEventListener('error', soldFinished);
    return () => {
      background.pause();
      sold.pause();
      sold.removeEventListener('ended', soldFinished);
      sold.removeEventListener('error', soldFinished);
      backgroundRef.current = null;
      soldRef.current = null;
    };
  }, [flushAnnouncement, setDucked]);

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background || !audioAllowed()) return;
    updateMusicMix();
    if (!enabled || musicMode === 'off') {
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
  }, [enabled, musicMode, updateMusicMix]);

  useEffect(() => {
    if (!enabled) return;
    const unlockAudio = () => {
      try {
        if (audioAllowed()) {
          const context = contextRef.current ?? new AudioContext();
          contextRef.current = context;
          void context.resume();
          if (musicModeRef.current !== 'off')
            void backgroundRef.current?.play().catch(() => undefined);
        }
        if (speechAllowed() && 'speechSynthesis' in window) {
          window.speechSynthesis.resume();
          const silent = new SpeechSynthesisUtterance(' ');
          silent.volume = 0;
          window.speechSynthesis.speak(silent);
        }
      } catch {
        // Audio is optional and some browsers do not permit a warm-up.
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, [enabled]);

  useEffect(
    () => () => {
      if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current);
    },
    [],
  );

  const play = useCallback(
    (cue: Cue) => {
      if (!enabled || !audioAllowed()) return;
      if (process.env.NEXT_PUBLIC_E2E === 'true') {
        (window as SoundTestWindow).__gavelCues?.push(cue);
        return;
      }
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
    if (enabled && audioAllowed() && (moment.kind === 'sold' || moment.kind === 'forced')) {
      const sold = soldRef.current;
      if (sold) {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setDucked('speech', false);
        if (announcementTimer.current !== null) {
          window.clearTimeout(announcementTimer.current);
          announcementTimer.current = null;
        }
        sold.currentTime = 0;
        setDucked('sold', true);
        void sold.play().catch(() => {
          setDucked('sold', false);
          flushAnnouncement();
        });
      }
    }
    const announcement = announcementFor(moment);
    if (
      enabled &&
      speechAllowed() &&
      announcement &&
      announcedLot.current !== announcement.key &&
      'speechSynthesis' in window
    ) {
      announcedLot.current = announcement.key;
      pendingAnnouncement.current = announcement;
      flushAnnouncement();
    }
  }, [enabled, flushAnnouncement, moment, play, setDucked]);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      enabledRef.current = next;
      try {
        window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        if (!next) {
          backgroundRef.current?.pause();
          soldRef.current?.pause();
          if (announcementTimer.current !== null) {
            window.clearTimeout(announcementTimer.current);
            announcementTimer.current = null;
          }
          pendingAnnouncement.current = null;
          duckReasons.current.clear();
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        } else if (musicModeRef.current !== 'off') {
          updateMusicMix();
          void backgroundRef.current?.play().catch(() => undefined);
        }
      } catch {
        // Local preference persistence is optional.
      }
      return next;
    });
  }, [updateMusicMix]);

  return { enabled, toggle, play };
}
