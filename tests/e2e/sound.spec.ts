import { expect, test } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  joinRoom,
  newDirector,
  readyAndStart,
  setLargeBudget,
} from './helpers';

test('announces the candidate once when a zero-second reveal immediately opens bidding', async ({
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
      };
      testWindow.__GAVEL_SOUND_TEST__ = true;
      testWindow.__gavelAnnouncements = [];

      class MockUtterance {
        text: string;
        voice: SpeechSynthesisVoice | null = null;
        rate = 1;
        pitch = 1;
        volume = 1;

        constructor(text: string) {
          this.text = text;
        }
      }

      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: MockUtterance,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel: () => undefined,
          getVoices: () => [],
          resume: () => undefined,
          speak: (utterance: { text: string }) => {
            if (utterance.text.trim()) testWindow.__gavelAnnouncements?.push(utterance.text);
          },
        },
      });
    });

    const roomCode = await createRoom(host.page, host.name);
    await joinRoom(guest.page, roomCode, guest.name);
    await setLargeBudget(host.page, roomCode);
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
    const announcements = await host.page.evaluate(
      () =>
        (window as typeof window & { __gavelAnnouncements?: string[] }).__gavelAnnouncements ?? [],
    );
    expect(announcements[0]).toMatch(/^Next (player|manager) is .+\.$/);
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
