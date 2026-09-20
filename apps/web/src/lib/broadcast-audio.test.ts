import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroadcastNarrator } from './broadcast-audio';

afterEach(() => vi.useRealTimers());

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
});
