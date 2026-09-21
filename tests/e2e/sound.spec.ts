import { expect, test } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  debugRoom,
  joinRoom,
  newDirector,
  readyAndStart,
  settleOpenLot,
  setLargeBudget,
  waitForPhase,
} from './helpers';

test('stops lobby music for the auction while preserving every player announcement and transfer cue', async ({
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
      localStorage.setItem('gavel-xi:commentator', 'device');
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
    // This is an authoritative server setting: the checkbox changes after the
    // socket acknowledgement, not synchronously during Playwright's click.
    await host.page.getByTestId('settings-sound').click();
    await expect(host.page.getByTestId('sound-toggle')).toBeDisabled();
    await expect(guest.page.getByTestId('sound-toggle')).toBeDisabled();
    await host.page.getByTestId('settings-sound').click();
    await expect(host.page.getByTestId('sound-toggle')).toBeEnabled();
    const readAudioEvents = () =>
      host.page.evaluate(
        () =>
          (window as typeof window & { __gavelAudioEvents?: string[] }).__gavelAudioEvents ?? [],
      );
    const readAnnouncements = () =>
      host.page.evaluate(
        () =>
          (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ??
          [],
      );
    const playerAnnouncement = async () => {
      const candidate = (await debugRoom(host.page, roomCode)).currentLot?.candidate as
        { kind: 'PLAYER' | 'MANAGER'; commonName?: string; fullName: string } | undefined;
      expect(candidate).toBeTruthy();
      return `Next ${candidate!.kind === 'MANAGER' ? 'manager' : 'player'} is ${candidate!.commonName || candidate!.fullName}.`;
    };
    await expect
      .poll(async () =>
        (await readAudioEvents()).filter((event) => event.startsWith('background:')).at(-1),
      )
      .toBe('background:play');
    const lobbyPauseCount = (await readAudioEvents()).filter(
      (event) => event === 'background:pause',
    ).length;
    await readyAndStart(host, [guest], roomCode, { preserveLargeBudget: true });
    const firstPlayerAnnouncement = await playerAnnouncement();

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
    expect(firstAudioState.announcements).toEqual([firstPlayerAnnouncement]);
    expect(firstAudioState.voices).toEqual(['Microsoft Aria Online (Natural)']);
    expect(firstAudioState.events).toContain('background:play');
    expect(
      firstAudioState.events.filter((event) => event === 'background:pause').length,
    ).toBeGreaterThan(lobbyPauseCount);
    expect(firstAudioState.events.filter((event) => event.startsWith('background:')).at(-1)).toBe(
      'background:pause',
    );
    const auctionBackgroundPlayCount = firstAudioState.events.filter(
      (event) => event === 'background:play',
    ).length;

    await settleOpenLot(directors, roomCode);
    await waitForPhase(host.page, roomCode, ['BIDDING'], 10_000);
    const secondPlayerAnnouncement = await playerAnnouncement();
    await expect
      .poll(() =>
        host.page.evaluate(
          () =>
            (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ??
            [],
        ),
      )
      .toHaveLength(2);
    expect(await readAnnouncements()).toEqual([firstPlayerAnnouncement, secondPlayerAnnouncement]);
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
    expect(mixedEvents.filter((event) => event === 'background:play')).toHaveLength(
      auctionBackgroundPlayCount,
    );
    expect(mixedEvents.filter((event) => event.startsWith('background:')).at(-1)).toBe(
      'background:pause',
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

    // Personal audio toggles must not restart lobby music during an auction.
    await host.page.getByTestId('sound-toggle').click();
    await expect(host.page.getByTestId('sound-toggle')).toHaveAttribute('aria-label', 'Mute sound');
    await booth.click();
    await host.page.getByTestId('voice-toggle').click();
    await expect(host.page.getByTestId('voice-toggle')).toHaveAttribute('aria-pressed', 'true');
    await host.page.keyboard.press('Escape');
    const announcementsBeforeResume = await readAnnouncements();
    await host.page.getByTestId('auction-pause').click();
    await waitForPhase(host.page, roomCode, ['BIDDING'], 10_000);
    const nextPlayerAnnouncement = await playerAnnouncement();
    const priorOccurrences = announcementsBeforeResume.filter(
      (line) => line === nextPlayerAnnouncement,
    ).length;
    await expect
      .poll(
        async () =>
          (await readAnnouncements()).filter((line) => line === nextPlayerAnnouncement).length,
      )
      .toBe(priorOccurrences + 1);
    await host.page.getByTestId('auction-pause').click();
    await expect(host.page.getByTestId('auction-pause')).toContainText('RESUME');
    expect((await readAudioEvents()).filter((event) => event === 'background:play')).toHaveLength(
      auctionBackgroundPlayCount,
    );
    expect(
      (await readAudioEvents()).filter((event) => event.startsWith('background:')).at(-1),
    ).toBe('background:pause');
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
