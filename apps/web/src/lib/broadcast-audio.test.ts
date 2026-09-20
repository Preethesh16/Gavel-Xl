import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROADCAST_AUDIO_EVENT,
  BroadcastNarrator,
  emitBroadcast,
  onceSettled,
} from './broadcast-audio';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  vi.useFakeTimers();
  const lines: string[] = [];
  const endings: (() => void)[] = [];
  const onSpeaking = vi.fn();
  const cancel = vi.fn();
  const narrator = new BroadcastNarrator({
    speak: (message, done) => {
      lines.push(message);
      endings.push(done);
    },
    cancel,
    onSpeaking,
  });
  return { narrator, lines, endings, onSpeaking, cancel };
}

describe('broadcast commentary scheduling', () => {
  it('replaces a delayed category line when the ceremony moves on', () => {
    const { narrator, lines } = setup();
    narrator.queue('Attack belongs to Athletic.', 400);
    vi.advanceTimersByTime(100);
    narrator.queue('Midfield belongs to City.', 400);
    vi.advanceTimersByTime(400);
    expect(lines).toEqual(['Midfield belongs to City.']);
  });

  it('holds the next player announcement until the sold sample finishes', () => {
    const { narrator, lines } = setup();
    narrator.hold(true);
    narrator.queue('Next player is Pedri.');
    vi.advanceTimersByTime(1_000);
    expect(lines).toEqual([]);
    narrator.hold(false);
    vi.advanceTimersByTime(1);
    expect(lines).toEqual(['Next player is Pedri.']);
  });

  it('drops a stale announcement instead of playing it after a long audio lock', () => {
    const { narrator, lines } = setup();
    narrator.hold(true);
    narrator.queue('An old player reveal.');
    vi.advanceTimersByTime(13_000);
    narrator.hold(false);
    vi.runAllTimers();
    expect(lines).toEqual([]);
  });

  it('cancels pending narration immediately on mute or skip', () => {
    const { narrator, lines, cancel, onSpeaking } = setup();
    narrator.queue('The champion is Athletic.', 500);
    narrator.cancel();
    vi.runAllTimers();
    expect(lines).toEqual([]);
    expect(cancel).toHaveBeenCalled();
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
  });

  it('ignores stale voice end callbacks so a previous line cannot unduck current speech', () => {
    const { narrator, endings, onSpeaking } = setup();
    narrator.queue('First category.');
    vi.advanceTimersByTime(80);
    narrator.queue('Second category.');
    vi.advanceTimersByTime(80);
    endings[0]?.();
    expect(onSpeaking).toHaveBeenLastCalledWith(true);
    endings[1]?.();
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
  });

  it('releases the music mix when a browser voice never emits its end event', () => {
    const { narrator, onSpeaking, cancel } = setup();
    narrator.queue('A stalled voice.');
    vi.advanceTimersByTime(80);
    expect(onSpeaking).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(15_000);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('settles exactly once when speech ends, even if the engine emits repeated end/error events', () => {
    const { narrator, endings } = setup();
    const settled = vi.fn();
    narrator.queue('The winning team.', 0, settled);
    vi.advanceTimersByTime(0);
    endings[0]?.();
    endings[0]?.();
    narrator.cancel();
    vi.runAllTimers();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('settles the replaced scene and prevents late engine callbacks from settling its successor', () => {
    const { narrator, endings } = setup();
    const oldScene = vi.fn();
    const newScene = vi.fn();
    narrator.queue('First scene.', 0, oldScene);
    vi.advanceTimersByTime(0);
    narrator.queue('Second scene.', 0, newScene);
    vi.advanceTimersByTime(0);
    expect(oldScene).toHaveBeenCalledTimes(1);
    endings[0]?.();
    expect(oldScene).toHaveBeenCalledTimes(1);
    expect(newScene).not.toHaveBeenCalled();
    endings[1]?.();
    expect(newScene).toHaveBeenCalledTimes(1);
  });

  it('settles delayed speech immediately when paused, muted, or unmounted', () => {
    const { narrator, lines } = setup();
    const settled = vi.fn();
    narrator.queue('A pending scene.', 800, settled);
    narrator.cancel();
    narrator.cancel();
    expect(settled).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(lines).toEqual([]);
  });

  it('bounds a held announcement even if the media unlock never arrives', () => {
    const { narrator, lines } = setup();
    const settled = vi.fn();
    narrator.hold(true);
    narrator.queue('Held behind a failed media element.', 100, settled);
    vi.advanceTimersByTime(12_100);
    expect(settled).toHaveBeenCalledTimes(1);
    narrator.hold(false);
    vi.runAllTimers();
    expect(lines).toEqual([]);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('settles a thrown speech-engine failure without leaving the ceremony blocked', () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const narrator = new BroadcastNarrator({
      speak: () => {
        throw new Error('Speech engine unavailable');
      },
      cancel: vi.fn(),
      onSpeaking: vi.fn(),
    });
    narrator.queue('Unavailable speech.', 0, settled);
    vi.advanceTimersByTime(0);
    expect(settled).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('allows long analysis narration beyond fifteen seconds but caps a hung voice at one minute', () => {
    const { narrator, endings } = setup();
    const completed = vi.fn();
    narrator.queue(Array.from({ length: 100 }, () => 'analysis').join(' '), 0, completed);
    vi.advanceTimersByTime(30_000);
    expect(completed).not.toHaveBeenCalled();
    endings[0]?.();
    expect(completed).toHaveBeenCalledTimes(1);
    const stalled = vi.fn();
    narrator.queue(Array.from({ length: 200 }, () => 'analysis').join(' '), 0, stalled);
    vi.advanceTimersByTime(59_999);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stalled).toHaveBeenCalledTimes(1);
  });
});

describe('broadcast settlement delivery', () => {
  it('settles when no browser or audio listener exists', () => {
    const noBrowser = vi.fn();
    emitBroadcast({ id: 'server-render', cue: 'category', onSettled: noBrowser });
    expect(noBrowser).toHaveBeenCalledTimes(1);
    vi.stubGlobal('window', new EventTarget());
    const noMixer = vi.fn();
    emitBroadcast({ id: 'missing-mixer', cue: 'category', onSettled: noMixer });
    expect(noMixer).toHaveBeenCalledTimes(1);
  });

  it('waits for an acknowledged audio listener and protects its callback from duplicate settlement', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    let complete: (() => void) | undefined;
    target.addEventListener(BROADCAST_AUDIO_EVENT, (event) => {
      event.preventDefault();
      complete = (event as CustomEvent<{ onSettled: () => void }>).detail.onSettled;
    });
    const settled = vi.fn();
    emitBroadcast({ id: 'live-mixer', cue: 'winner', onSettled: settled });
    expect(settled).not.toHaveBeenCalled();
    complete?.();
    complete?.();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('can settle unavailable/muted audio synchronously without duplicate callbacks', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    target.addEventListener(BROADCAST_AUDIO_EVENT, (event) => {
      const detail = (event as CustomEvent<{ onSettled: () => void }>).detail;
      const complete = onceSettled(detail.onSettled);
      event.preventDefault();
      complete();
      complete();
    });
    const settled = vi.fn();
    emitBroadcast({ id: 'muted', cue: 'category', onSettled: settled });
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
