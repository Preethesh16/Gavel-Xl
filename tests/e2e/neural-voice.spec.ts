import { expect, test } from '@playwright/test';
import { closeDirectors, createRoom, newDirector } from './helpers';

// Opt-in because a cold run downloads the real ~120 MB voice/runtime. Ordinary
// game-flow tests never depend on a third-party CDN or a machine's CPU speed.
test('natural commentary generates and plays real non-silent speech in the sound booth', async ({
  browser,
}) => {
  test.skip(
    process.env.GAVEL_TEST_NEURAL_VOICE !== 'true',
    'Set GAVEL_TEST_NEURAL_VOICE=true for the real neural voice smoke test.',
  );
  test.setTimeout(240_000);
  const host = await newDirector(browser, 'Voice Studio');
  await host.context.addInitScript(() => {
    const audioWindow = window as typeof window & {
      __GAVEL_SOUND_TEST__?: boolean;
      __neuralSamples?: Array<{ duration: number; peak: number }>;
    };
    audioWindow.__GAVEL_SOUND_TEST__ = true;
    audioWindow.__neuralSamples = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
      if (this.buffer && this.buffer.duration > 0.5) {
        const samples = this.buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < samples.length; i += 8) peak = Math.max(peak, Math.abs(samples[i]!));
        audioWindow.__neuralSamples!.push({ duration: this.buffer.duration, peak });
      }
      original.apply(this, args);
    };
  });
  try {
    await createRoom(host.page, host.name);
    await host.page.getByTestId('audio-settings-toggle').click();
    await host.page.getByRole('combobox', { name: 'Commentator voice' }).selectOption('af_heart');
    await expect(host.page.getByTestId('commentator-status')).toContainText(/ready/i, {
      timeout: 180_000,
    });
    await host.page.getByTestId('voice-preview').click();
    await expect
      .poll(
        () =>
          host.page.evaluate(() => {
            const state = window as typeof window & {
              __neuralSamples?: Array<{ duration: number; peak: number }>;
            };
            return state.__neuralSamples?.filter(({ peak }) => peak > 0.01).length ?? 0;
          }),
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);
    await expect(host.page.locator('.broadcast-audio')).toHaveAttribute('data-speaking', 'false', {
      timeout: 90_000,
    });
    await expect(host.page.getByTestId('commentator-status')).not.toContainText(
      /fallback|unavailable|interrupted/i,
    );
    const samples = await host.page.evaluate(
      () =>
        (
          window as typeof window & {
            __neuralSamples?: Array<{ duration: number; peak: number }>;
          }
        ).__neuralSamples ?? [],
    );
    expect(samples.reduce((duration, sample) => duration + sample.duration, 0)).toBeGreaterThan(3);
    expect(samples).toHaveLength(3);
    await host.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('gavel-xi:broadcast-audio', {
          detail: {
            id: 'real-neural-player',
            cue: 'reveal',
            message: 'Next player is Kylian Mbappé.',
          },
          cancelable: true,
        }),
      );
    });
    await expect
      .poll(
        () =>
          host.page.evaluate(
            () =>
              (
                window as typeof window & {
                  __neuralSamples?: unknown[];
                }
              ).__neuralSamples?.length ?? 0,
          ),
        { timeout: 90_000 },
      )
      .toBeGreaterThan(samples.length);
    await expect(host.page.locator('.broadcast-audio')).toHaveAttribute('data-speaking', 'false', {
      timeout: 90_000,
    });
    await expect(host.page.getByTestId('commentator-status')).not.toContainText(
      /fallback|unavailable|interrupted/i,
    );
    await host.page.getByTestId('voice-preview').click();
    await expect(host.page.locator('.broadcast-audio')).toHaveAttribute('data-speaking', 'true');
    await host.page.getByTestId('voice-toggle').click();
    await expect(host.page.locator('.broadcast-audio')).toHaveAttribute('data-speaking', 'false');
    expect(host.runtimeErrors).toEqual([]);
  } finally {
    await closeDirectors([host]);
  }
});
