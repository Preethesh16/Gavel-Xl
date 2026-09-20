import { expect, test } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  joinRoom,
  newDirector,
  readyAndStart,
  settleOpenLot,
  setLargeBudget,
  waitForPhase,
} from './helpers';

test('mixes auction music, natural speech, sold audio and the unsold cue without collisions', async ({
  browser,
}) => {
  const host = await newDirector(browser, 'Announcer');
  const guest = await newDirector(browser, 'Listener');
  const directors = [host, guest];

  try {
    await host.context.addInitScript(() => {
      const testWindow = window as typeof window & {
        __GAVEL_SOUND_TEST__?: boolean;
        __gavelAnnouncements?: string[];
        __gavelVoices?: string[];
        __gavelAudioEvents?: string[];
        __gavelCues?: string[];
        __gavelFailNextNatural?: boolean;
      };
      testWindow.__GAVEL_SOUND_TEST__ = true;
      testWindow.__gavelAnnouncements = [];
      testWindow.__gavelVoices = [];
      testWindow.__gavelAudioEvents = [];
      testWindow.__gavelCues = [];

      class MockUtterance {
        text: string;
        voice: SpeechSynthesisVoice | null = null;
        rate = 1;
        pitch = 1;
        volume = 1;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;

        constructor(text: string) {
          this.text = text;
        }
      }

      class MockAudio extends EventTarget {
        readonly src: string;
        paused = true;
        ended = false;
        currentTime = 0;
        duration: number;
        loop = false;
        preload = 'auto';
        volume = 1;

        constructor(src: string) {
          super();
          this.src = src;
          this.duration = src.includes('here-we-go') ? 0.9 : 198;
        }

        play(): Promise<void> {
          this.paused = false;
          this.ended = false;
          const label = this.src.includes('here-we-go') ? 'sold' : 'background';
          testWindow.__gavelAudioEvents?.push(`${label}:play`);
          if (label === 'sold') {
            window.setTimeout(() => {
              this.paused = true;
              this.ended = true;
              testWindow.__gavelAudioEvents?.push('sold:end');
              this.dispatchEvent(new Event('ended'));
            }, 900);
          }
          return Promise.resolve();
        }

        pause(): void {
          this.paused = true;
          const label = this.src.includes('here-we-go') ? 'sold' : 'background';
          testWindow.__gavelAudioEvents?.push(`${label}:pause`);
        }
      }

      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: MockUtterance,
      });
      Object.defineProperty(window, 'Audio', { configurable: true, value: MockAudio });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel: () => undefined,
          getVoices: () => [
            {
              default: true,
              lang: 'en-GB',
              localService: true,
              name: 'eSpeak English',
              voiceURI: 'espeak',
            },
            {
              default: false,
              lang: 'en-US',
              localService: false,
              name: 'Microsoft Aria Online (Natural)',
              voiceURI: 'aria-natural',
            },
          ],
          resume: () => undefined,
          speak: (utterance: MockUtterance) => {
            if (testWindow.__gavelFailNextNatural && utterance.voice?.name.includes('Natural')) {
              testWindow.__gavelFailNextNatural = false;
              window.setTimeout(() => utterance.onerror?.({ error: 'network' }), 0);
              return;
            }
            if (utterance.text.trim()) {
              testWindow.__gavelAnnouncements?.push(utterance.text);
              testWindow.__gavelVoices?.push(utterance.voice?.name ?? 'default');
              testWindow.__gavelAudioEvents?.push(`speech:${utterance.text}`);
            }
            window.setTimeout(() => utterance.onend?.(), 20);
          },
        },
      });
    });

    const roomCode = await createRoom(host.page, host.name);
    await joinRoom(guest.page, roomCode, guest.name);
    await setLargeBudget(host.page, roomCode);
    // The host's room-wide setting must win over an individual saved 'on' preference.
    await host.page.getByTestId('settings-sound').uncheck();
    await expect(host.page.getByTestId('sound-toggle')).toBeDisabled();
    await expect(guest.page.getByTestId('sound-toggle')).toBeDisabled();
    await host.page.getByTestId('settings-sound').check();
    await expect(host.page.getByTestId('sound-toggle')).toBeEnabled();
    const lobbyPauseCount = await host.page.evaluate(
      () =>
        (
          (window as typeof window & { __gavelAudioEvents?: string[] }).__gavelAudioEvents ?? []
        ).filter((event) => event === 'background:pause').length,
    );
    await readyAndStart(host, [guest], roomCode, { preserveLargeBudget: true });

    await expect
      .poll(() =>
        host.page.evaluate(
          () =>
            (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ??
            [],
        ),
      )
      .toHaveLength(1);
    const firstAudioState = await host.page.evaluate(() => {
      const testWindow = window as typeof window & {
        __gavelAnnouncements?: string[];
        __gavelVoices?: string[];
        __gavelAudioEvents?: string[];
      };
      return {
        announcements: testWindow.__gavelAnnouncements ?? [],
        voices: testWindow.__gavelVoices ?? [],
        events: testWindow.__gavelAudioEvents ?? [],
      };
    });
    expect(firstAudioState.announcements[0]).toMatch(/^Next (player|manager) is .+\.$/);
    expect(firstAudioState.voices).toEqual(['Microsoft Aria Online (Natural)']);
    expect(firstAudioState.events).toContain('background:play');
    expect(firstAudioState.events.filter((event) => event === 'background:pause')).toHaveLength(
      lobbyPauseCount,
    );

    await settleOpenLot(directors, roomCode);
    await waitForPhase(host.page, roomCode, ['BIDDING'], 10_000);
    await expect
      .poll(() =>
        host.page.evaluate(
          () =>
            (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ??
            [],
        ),
      )
      .toHaveLength(2);
    const mixedEvents = await host.page.evaluate(
      () => (window as typeof window & { __gavelAudioEvents?: string[] }).__gavelAudioEvents ?? [],
    );
    const soldStart = mixedEvents.indexOf('sold:play');
    const soldEnd = mixedEvents.indexOf('sold:end');
    const nextSpeech = mixedEvents.findIndex(
      (event, index) => index > soldStart && event.startsWith('speech:'),
    );
    expect(soldStart).toBeGreaterThanOrEqual(0);
    expect(soldEnd).toBeGreaterThan(soldStart);
    expect(nextSpeech).toBeGreaterThan(soldEnd);
    expect(mixedEvents.filter((event) => event === 'background:pause')).toHaveLength(
      lobbyPauseCount,
    );

    for (const { page } of directors) {
      const pass = page.getByTestId('pass-button');
      if ((await pass.count()) > 0 && (await pass.isEnabled())) await pass.click({ force: true });
    }
    await waitForPhase(host.page, roomCode, ['UNSOLD'], 10_000);
    await expect
      .poll(() =>
        host.page.evaluate(
          () => (window as typeof window & { __gavelCues?: string[] }).__gavelCues ?? [],
        ),
      )
      .toContain('unsold');

    // Pause the live auction while testing the personal broadcast mix.
    await host.page.getByTestId('auction-pause').click();
    await expect(host.page.getByTestId('auction-pause')).toContainText('RESUME');
    const booth = host.page.getByTestId('audio-settings-toggle');
    await booth.click();
    await expect(host.page.getByTestId('voice-toggle')).toHaveAttribute('aria-pressed', 'true');
    await host.page.getByTestId('voice-toggle').click();
    await host.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('gavel-xi:broadcast-audio', {
          detail: { id: 'muted-category-check', cue: 'category', message: 'Muted booth test.' },
        }),
      );
    });
    await expect
      .poll(() =>
        host.page.evaluate(
          () => (window as typeof window & { __gavelCues?: string[] }).__gavelCues ?? [],
        ),
      )
      .toContain('category');
    await host.page.waitForTimeout(300);
    expect(
      await host.page.evaluate(
        () =>
          (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ??
          [],
      ),
    ).not.toContain('Muted booth test.');

    await host.page.getByTestId('voice-toggle').click();
    await host.page.evaluate(() => {
      const detail = {
        id: 'live-category-check',
        cue: 'category',
        message: 'The scouting desk is live.',
      };
      window.dispatchEvent(new CustomEvent('gavel-xi:broadcast-audio', { detail }));
      window.dispatchEvent(new CustomEvent('gavel-xi:broadcast-audio', { detail }));
    });
    await expect
      .poll(() =>
        host.page.evaluate(
          () =>
            (
              (window as typeof window & { __gavelAnnouncements?: string[] })
                .__gavelAnnouncements ?? []
            ).filter((line) => line === 'The scouting desk is live.').length,
        ),
      )
      .toBe(1);

    await host.page.evaluate(() => {
      (window as typeof window & { __gavelFailNextNatural?: boolean }).__gavelFailNextNatural =
        true;
      window.dispatchEvent(
        new CustomEvent('gavel-xi:broadcast-audio', {
          detail: {
            id: 'fallback-voice-check',
            cue: 'scan',
            message: 'The local commentator takes over.',
          },
        }),
      );
    });
    await expect
      .poll(() =>
        host.page.evaluate(
          () =>
            (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ??
            [],
        ),
      )
      .toContain('The local commentator takes over.');
    expect(
      await host.page.evaluate(() =>
        (window as typeof window & { __gavelVoices?: string[] }).__gavelVoices?.at(-1),
      ),
    ).toBe('eSpeak English');

    const volume = host.page.getByRole('slider', { name: 'Master volume' });
    await volume.focus();
    await volume.press('Home');
    for (let step = 0; step < 7; step += 1) await volume.press('ArrowRight');
    await expect
      .poll(() => host.page.evaluate(() => localStorage.getItem('gavel-xi:volume')))
      .toBe('0.35');
    await host.page.getByTestId('voice-toggle').click();
    await expect
      .poll(() => host.page.evaluate(() => localStorage.getItem('gavel-xi:voice')))
      .toBe('off');
    await host.page.keyboard.press('Escape');
    await expect(host.page.getByTestId('voice-toggle')).not.toBeVisible();
    await host.page.getByTestId('sound-toggle').click();
    await expect(host.page.getByTestId('sound-toggle')).toHaveAttribute(
      'aria-label',
      'Enable sound',
    );
    await host.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('gavel-xi:broadcast-audio', {
          detail: { id: 'muted-winner-check', cue: 'winner', message: 'This must remain silent.' },
        }),
      );
    });
    expect(
      await host.page.evaluate(
        () => (window as typeof window & { __gavelCues?: string[] }).__gavelCues ?? [],
      ),
    ).not.toContain('winner');
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
