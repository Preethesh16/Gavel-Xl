'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BROADCAST_AUDIO_EVENT,
  BROADCAST_CANCEL_EVENT,
  BroadcastNarrator,
  onceSettled,
  type BroadcastAudioEvent,
  type SoundCue,
} from '@/lib/broadcast-audio';
import { createStadiumBus, playStadiumCue } from '@/lib/stadium-synth';
import type { AuctionMoment } from './use-gavel-room';

const SOUND_KEY = 'gavel-xi:sound';
const VOICE_KEY = 'gavel-xi:voice';
const VOLUME_KEY = 'gavel-xi:volume';

export type MusicMode = 'lobby' | 'auction' | 'off';

type SoundTestWindow = typeof window & {
  __GAVEL_SOUND_TEST__?: boolean;
  __gavelCues?: SoundCue[];
};

function storedPreference(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'on';
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing must not prevent a working local audio control.
  }
}

function audioAllowed(): boolean {
  return (
    process.env.NEXT_PUBLIC_E2E !== 'true' ||
    Boolean(typeof window !== 'undefined' && (window as SoundTestWindow).__GAVEL_SOUND_TEST__)
  );
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const language = voice.lang.toLowerCase();
  if (!language.startsWith('en')) return -10_000;
  const name = voice.name.toLowerCase();
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

export function useSound(roomDefault: boolean, moment: AuctionMoment | null, musicMode: MusicMode) {
  const [preference, setPreference] = useState(true);
  const [voicePreference, setVoicePreference] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  const [speaking, setSpeaking] = useState(false);
  const enabled = preferencesReady && roomDefault && preference;
  const enabledRef = useRef(enabled);
  const voiceRef = useRef(voicePreference);
  const volumeRef = useRef(volume);
  const unlockedRef = useRef(false);
  const musicModeRef = useRef(musicMode);
  const contextRef = useRef<AudioContext | null>(null);
  const effectsBusRef = useRef<GainNode | null>(null);
  const backgroundRef = useRef<HTMLAudioElement | null>(null);
  const soldRef = useRef<HTMLAudioElement | null>(null);
  const playedMoment = useRef<number | null>(null);
  const announcedLot = useRef<string | null>(null);
  const broadcastHistory = useRef(new Set<string>());
  const activeBroadcast = useRef<string | null>(null);
  const narratorRef = useRef<BroadcastNarrator | null>(null);
  const speechGeneration = useRef(0);
  const duckReasons = useRef(new Set<'sold' | 'speech'>());
  const soldWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  enabledRef.current = enabled;
  voiceRef.current = voicePreference;
  volumeRef.current = volume;
  musicModeRef.current = musicMode;

  const updateMusicMix = useCallback(() => {
    const background = backgroundRef.current;
    if (background) {
      const base = musicModeRef.current === 'auction' ? 0.09 : 0.16;
      background.volume =
        (duckReasons.current.size ? Math.min(base, 0.025) : base) * volumeRef.current;
    }
    if (soldRef.current) soldRef.current.volume = 0.78 * volumeRef.current;
    if (effectsBusRef.current && contextRef.current) {
      effectsBusRef.current.gain.setTargetAtTime(
        volumeRef.current,
        contextRef.current.currentTime,
        0.035,
      );
    }
  }, []);

  const setDucked = useCallback(
    (reason: 'sold' | 'speech', active: boolean) => {
      if (active) duckReasons.current.add(reason);
      else duckReasons.current.delete(reason);
      updateMusicMix();
    },
    [updateMusicMix],
  );

  const getNarrator = useCallback(() => {
    if (!narratorRef.current) {
      narratorRef.current = new BroadcastNarrator({
        speak: (message, done) => {
          const generation = ++speechGeneration.current;
          if (
            !enabledRef.current ||
            !voiceRef.current ||
            volumeRef.current === 0 ||
            !audioAllowed() ||
            !('speechSynthesis' in window)
          ) {
            done();
            return;
          }
          const voices = window.speechSynthesis
            .getVoices()
            .filter((voice) => voice.lang.toLowerCase().startsWith('en'))
            .sort((left, right) => voiceScore(right) - voiceScore(left));
          const preferred = voices[0] ?? null;
          const localFallback =
            voices.find((voice) => voice.localService && voice !== preferred) ?? null;
          const createLine = (voice: SpeechSynthesisVoice | null, canRetry: boolean) => {
            const utterance = new SpeechSynthesisUtterance(message);
            // Voices may load asynchronously. The device default remains a fallback.
            utterance.voice = voice;
            utterance.lang = voice?.lang ?? 'en-GB';
            utterance.rate = 1.06;
            utterance.pitch = 0.96;
            utterance.volume = volumeRef.current;
            utterance.onend = done;
            utterance.onerror = (event) => {
              // A downloaded voice can fail offline. Try the installed/default voice once;
              // an intentional cancel must never restart a stale line.
              if (
                canRetry &&
                generation === speechGeneration.current &&
                event.error !== 'canceled' &&
                event.error !== 'interrupted' &&
                enabledRef.current &&
                voiceRef.current
              ) {
                try {
                  window.speechSynthesis.speak(createLine(localFallback, false));
                  return;
                } catch {
                  // Both engines are optional; the visible broadcast remains complete.
                }
              }
              done();
            };
            return utterance;
          };
          window.speechSynthesis.resume();
          window.speechSynthesis.speak(createLine(preferred, Boolean(preferred)));
        },
        cancel: () => {
          speechGeneration.current += 1;
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        },
        onSpeaking: (active) => {
          setSpeaking(active);
          setDucked('speech', active);
        },
      });
    }
    return narratorRef.current;
  }, [setDucked]);

  const announce = useCallback(
    (message: string, delay = 80, onSettled?: () => void) => {
      const settle = onceSettled(onSettled);
      if (
        !enabledRef.current ||
        !voiceRef.current ||
        volumeRef.current === 0 ||
        !unlockedRef.current ||
        !audioAllowed() ||
        !('speechSynthesis' in window) ||
        !('SpeechSynthesisUtterance' in window)
      ) {
        narratorRef.current?.cancel();
        settle();
        return;
      }
      const narrator = getNarrator();
      const sold = soldRef.current;
      narrator.hold(Boolean(sold && !sold.paused && !sold.ended));
      narrator.queue(message, delay, settle);
    },
    [getNarrator],
  );

  const cancelNarration = useCallback(() => narratorRef.current?.cancel(), []);

  const stopAll = useCallback(() => {
    backgroundRef.current?.pause();
    soldRef.current?.pause();
    if (soldWatchdog.current !== null) clearTimeout(soldWatchdog.current);
    soldWatchdog.current = null;
    narratorRef.current?.cancel();
    duckReasons.current.clear();
    if (contextRef.current?.state === 'running')
      void contextRef.current.suspend().catch(() => undefined);
  }, []);

  useEffect(() => {
    setPreference(storedPreference(SOUND_KEY, true));
    setVoicePreference(storedPreference(VOICE_KEY, true));
    setVoiceSupported('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    try {
      const saved = window.localStorage.getItem(VOLUME_KEY);
      const parsed = saved === null ? 0.8 : Number(saved);
      setVolumeState(Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.8);
    } catch {
      // Defaults work when storage is unavailable.
    }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    const background = new Audio('/audio/background-music.mp3');
    background.loop = true;
    background.preload = 'auto';
    backgroundRef.current = background;
    const sold = new Audio('/audio/here-we-go.mp3');
    sold.preload = 'auto';
    soldRef.current = sold;
    updateMusicMix();
    const soldFinished = () => {
      if (soldWatchdog.current !== null) clearTimeout(soldWatchdog.current);
      soldWatchdog.current = null;
      setDucked('sold', false);
      narratorRef.current?.hold(!unlockedRef.current);
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
  }, [setDucked, updateMusicMix]);

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background || !audioAllowed()) return;
    updateMusicMix();
    if (!enabled || musicMode === 'off') {
      background.pause();
      background.currentTime = 0;
      if (!enabled) stopAll();
      return;
    }
    const start = () => {
      if (enabledRef.current && musicModeRef.current !== 'off')
        void background.play().catch(() => undefined);
    };
    start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, [enabled, musicMode, stopAll, updateMusicMix]);

  useEffect(() => {
    if (!enabled) return;
    const unlockAudio = () => {
      if (!enabledRef.current) return;
      unlockedRef.current = true;
      try {
        if (audioAllowed()) {
          if (process.env.NEXT_PUBLIC_E2E !== 'true') {
            const context = contextRef.current ?? new AudioContext();
            contextRef.current = context;
            effectsBusRef.current ??= createStadiumBus(context);
            void context.resume().catch(() => undefined);
            updateMusicMix();
          }
          if (musicModeRef.current !== 'off')
            void backgroundRef.current?.play().catch(() => undefined);
          if (voiceRef.current && 'speechSynthesis' in window) {
            window.speechSynthesis.resume();
            const silent = new SpeechSynthesisUtterance(' ');
            silent.volume = 0;
            window.speechSynthesis.speak(silent);
          }
        }
      } catch {
        // Audio is optional; unsupported browser audio never blocks the game.
      }
      const sold = soldRef.current;
      narratorRef.current?.hold(Boolean(sold && !sold.paused && !sold.ended));
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, [enabled, updateMusicMix]);

  useEffect(() => {
    updateMusicMix();
    if (!enabled || !voicePreference || volume === 0) cancelNarration();
  }, [enabled, voicePreference, volume, cancelNarration, updateMusicMix]);

  useEffect(
    () => () => {
      stopAll();
      if (contextRef.current) void contextRef.current.close().catch(() => undefined);
      contextRef.current = null;
      effectsBusRef.current = null;
    },
    [stopAll],
  );

  const play = useCallback((cue: SoundCue) => {
    if (!enabledRef.current || !unlockedRef.current || volumeRef.current === 0 || !audioAllowed())
      return;
    if (process.env.NEXT_PUBLIC_E2E === 'true') {
      (window as SoundTestWindow).__gavelCues?.push(cue);
      return;
    }
    try {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      const bus = effectsBusRef.current ?? createStadiumBus(context);
      effectsBusRef.current = bus;
      bus.gain.value = volumeRef.current;
      void context
        .resume()
        .then(() => {
          if (enabledRef.current) playStadiumCue(context, bus, cue);
        })
        .catch(() => undefined);
    } catch {
      // Every cue also has a visible counterpart.
    }
  }, []);

  useEffect(() => {
    const broadcast = (event: Event) => {
      const detail = (event as CustomEvent<BroadcastAudioEvent>).detail;
      const settle = onceSettled(detail?.onSettled);
      // Acknowledge even muted and duplicate beats: the caller is waiting for this
      // event's lifecycle, and these paths settle immediately without playback.
      event.preventDefault();
      if (!detail?.id || broadcastHistory.current.has(detail.id)) {
        settle();
        return;
      }
      broadcastHistory.current.add(detail.id);
      activeBroadcast.current = detail.id;
      if (broadcastHistory.current.size > 200) {
        const oldest = broadcastHistory.current.values().next().value;
        if (oldest) broadcastHistory.current.delete(oldest);
      }
      play(detail.cue);
      if (detail.message) announce(detail.message, detail.delayMs ?? 180, settle);
      else {
        if (detail.cue === 'transition') cancelNarration();
        settle();
      }
    };
    const stopBroadcast = () => {
      // A fresh presentation after unmount/replay may narrate again. Duplicate events
      // during the same presentation are still ignored (including snapshot updates).
      if (activeBroadcast.current) broadcastHistory.current.delete(activeBroadcast.current);
      activeBroadcast.current = null;
      cancelNarration();
    };
    window.addEventListener(BROADCAST_AUDIO_EVENT, broadcast);
    window.addEventListener(BROADCAST_CANCEL_EVENT, stopBroadcast);
    return () => {
      window.removeEventListener(BROADCAST_AUDIO_EVENT, broadcast);
      window.removeEventListener(BROADCAST_CANCEL_EVENT, stopBroadcast);
      stopBroadcast();
    };
  }, [announce, cancelNarration, play]);

  useEffect(() => {
    if (!moment || playedMoment.current === moment.id) return;
    playedMoment.current = moment.id;
    // The winner sting belongs to the visible podium, never RESULTS arrival before the reveal.
    if (moment.kind !== 'checkpoint') {
      play(
        moment.kind === 'complete'
          ? 'transition'
          : moment.kind === 'opened'
            ? 'reveal'
            : moment.kind,
      );
    }
    if (
      enabledRef.current &&
      unlockedRef.current &&
      voiceRef.current &&
      volumeRef.current > 0 &&
      audioAllowed() &&
      (moment.kind === 'sold' || moment.kind === 'forced')
    ) {
      const sold = soldRef.current;
      if (sold) {
        cancelNarration();
        narratorRef.current?.hold(true);
        sold.currentTime = 0;
        setDucked('sold', true);
        if (soldWatchdog.current !== null) clearTimeout(soldWatchdog.current);
        const release = () => {
          if (soldWatchdog.current !== null) clearTimeout(soldWatchdog.current);
          soldWatchdog.current = null;
          setDucked('sold', false);
          narratorRef.current?.hold(!unlockedRef.current);
        };
        // A stalled media file cannot hold the following player announcement forever.
        soldWatchdog.current = setTimeout(() => {
          sold.pause();
          release();
        }, 5_000);
        void sold.play().catch(release);
      }
    }
    const name = moment.lot?.candidate.commonName || moment.lot?.candidate.fullName;
    if (
      (moment.kind === 'reveal' || moment.kind === 'opened') &&
      name &&
      moment.lot &&
      announcedLot.current !== moment.lot.id
    ) {
      announcedLot.current = moment.lot.id;
      const role = moment.lot.candidate.kind === 'MANAGER' ? 'manager' : 'player';
      announce(`Next ${role} is ${name}.`);
    }
  }, [announce, cancelNarration, moment, play, setDucked]);

  const toggle = useCallback(() => {
    setPreference((current) => {
      const next = !current;
      enabledRef.current = roomDefault && next;
      persist(SOUND_KEY, next ? 'on' : 'off');
      if (!next) stopAll();
      return next;
    });
  }, [roomDefault, stopAll]);

  const toggleVoice = useCallback(() => {
    setVoicePreference((current) => {
      const next = !current;
      voiceRef.current = next;
      persist(VOICE_KEY, next ? 'on' : 'off');
      if (!next) {
        cancelNarration();
        soldRef.current?.pause();
        if (soldWatchdog.current !== null) clearTimeout(soldWatchdog.current);
        soldWatchdog.current = null;
        setDucked('sold', false);
      }
      return next;
    });
  }, [cancelNarration, setDucked]);

  const setVolume = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) return;
      const next = Math.max(0, Math.min(1, value));
      volumeRef.current = next;
      persist(VOLUME_KEY, String(next));
      setVolumeState(next);
      updateMusicMix();
      if (next === 0) cancelNarration();
    },
    [cancelNarration, updateMusicMix],
  );

  return {
    enabled,
    available: roomDefault,
    voiceEnabled: voicePreference,
    voiceSupported,
    speaking,
    volume,
    toggle,
    toggleVoice,
    setVolume,
    play,
  };
}
