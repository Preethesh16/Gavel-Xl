import { expect, test, type Page } from '@playwright/test';
import type { RoomView } from '../../packages/shared/src/types';
import { writeFile } from 'node:fs/promises';
import {
  closeDirectors,
  createRoom,
  joinRoom,
  newDirector,
  playToResults,
  readyAndStart,
  SERVER_URL,
  setLargeBudget,
} from './helpers';

async function expectContained(page: Page) {
  expect(
    await page.evaluate(() =>
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    ),
  ).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
}

test('tied head-to-head matches retain full-time scores and replay the authoritative penalties', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const host = await newDirector(browser, 'Penalty Club');
  const rival = await newDirector(browser, 'Golden Keepers');
  const third = await newDirector(browser, 'Extra Time XI');
  const directors = [host, rival, third];
  const page = host.page;
  try {
    // The UI receives a real completed auction and the engine's persisted kicks.
    // No browser-only winner or penalty-result override is used.
    const code = await createRoom(page, host.name);
    for (const guest of [rival, third]) await joinRoom(guest.page, code, guest.name);
    await setLargeBudget(page, code);
    await readyAndStart(host, [rival, third], code, { preserveLargeBudget: true });
    await playToResults(host, directors, code);
    const response = await page.request.get(`${SERVER_URL}/api/rooms/${code}/results`);
    expect(response.ok()).toBe(true);
    const { room } = (await response.json()) as { room: RoomView };
    const evaluation = room.evaluation!;
    const tied = evaluation.headToHead.filter((match) => match.homeGoals === match.awayGoals);
    await writeFile(testInfo.outputPath('shootout-result.json'), JSON.stringify(room, null, 2));
    const cards = page.getByTestId('head-to-head-match');
    await expect(cards).toHaveCount(evaluation.headToHead.length);
    for (const [index, match] of evaluation.headToHead.entries()) {
      const card = cards.nth(index);
      if (match.homeGoals !== match.awayGoals) {
        await expect(card.getByTestId('watch-shootout')).toHaveCount(0);
        continue;
      }
      const penalties = match.penaltyShootout!;
      expect(penalties).toBeTruthy();
      expect(penalties.homeGoals).not.toBe(penalties.awayGoals);
      await expect(card.getByTestId('home-penalty-score')).toHaveText(String(penalties.homeGoals));
      await expect(card.getByTestId('away-penalty-score')).toHaveText(String(penalties.awayGoals));
      await expect(card.getByTestId('shootout-winner')).toHaveAttribute(
        'data-winner-id',
        penalties.winnerId,
      );
      for (const memberId of [match.homeMemberId, match.awayMemberId]) {
        const member = room.members.find((entry) => entry.id === memberId)!;
        const trail = card.getByRole('list', { name: `${member.name} penalties` });
        const kicks = penalties.kicks.filter((kick) => kick.memberId === memberId);
        for (const [kickIndex, kick] of kicks.entries()) {
          await expect(trail.locator('li').nth(kickIndex)).toHaveAttribute(
            'data-outcome',
            kick.outcome,
          );
          await expect(trail.locator('li').nth(kickIndex)).toHaveAttribute(
            'aria-label',
            new RegExp(kick.takerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          );
        }
      }
    }

    // The three balanced drafts must exercise a real draw, rather than letting
    // the replay coverage silently disappear when the live catalog changes.
    expect(
      tied.length,
      'The balanced auction should produce a draw for replay coverage',
    ).toBeGreaterThan(0);
    const match = tied[0]!;
    const card = page.locator(
      `[data-testid="head-to-head-match"][data-home-id="${match.homeMemberId}"][data-away-id="${match.awayMemberId}"]`,
    );
    await page.evaluate(() => {
      localStorage.setItem('gavel-xi:sound', 'off');
    });
    await page.goto(`/results/${code}`);
    await card.getByTestId('watch-shootout').click();
    const replay = page.getByTestId('shootout-replay');
    await expect(replay).toHaveCount(1);
    await expect(replay).toHaveAttribute('data-kick-index', '0');
    await expect(card.getByTestId('home-penalty-score')).toHaveText('0');
    await expect(card.getByTestId('away-penalty-score')).toHaveText('0');
    const first = match.penaltyShootout!.kicks[0]!;
    await expect(card.getByTestId('home-penalty-score')).toHaveText(String(first.homeGoals));
    await expect(card.getByTestId('away-penalty-score')).toHaveText(String(first.awayGoals));
    for (let index = 1; index < match.penaltyShootout!.kicks.length; index += 1) {
      const kick = match.penaltyShootout!.kicks[index]!;
      await expect(replay).toHaveAttribute('data-kick-index', String(index));
      await expect(replay).toContainText(kick.takerName);
      await expect(card.getByTestId('home-penalty-score')).toHaveText(String(kick.homeGoals));
      await expect(card.getByTestId('away-penalty-score')).toHaveText(String(kick.awayGoals));
    }
    await expect(replay).toHaveAttribute(
      'data-kick-index',
      String(match.penaltyShootout!.kicks.length),
    );
    await expect(replay).toHaveCount(0, { timeout: 5_000 });
    await expect(card.getByTestId('shootout-winner')).toHaveAttribute(
      'data-winner-id',
      match.penaltyShootout!.winnerId,
    );

    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await card.getByTestId('watch-shootout').click();
    await expect(replay).toHaveAttribute('data-kick-index', '0');
    await expectContained(page);
    await testInfo.attach('penalty-shootout-phone', {
      body: await page.screenshot({
        path: testInfo.outputPath('penalty-shootout-phone.png'),
        animations: 'allow',
        fullPage: true,
      }),
      contentType: 'image/png',
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() =>
        replay.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length,
        ),
      )
      .toBe(0);
    await page.getByTestId('shootout-finish').click();
    await expect(replay).toHaveCount(0);
    await card.getByTestId('watch-shootout').click();

    if (tied[1]) {
      const other = tied[1];
      const secondCard = page.locator(
        `[data-testid="head-to-head-match"][data-home-id="${other.homeMemberId}"][data-away-id="${other.awayMemberId}"]`,
      );
      await secondCard.getByTestId('watch-shootout').click();
      await expect(replay).toHaveCount(1);
      await expect(card.getByTestId('watch-shootout')).toHaveAttribute('aria-expanded', 'false');
      await expect(secondCard.getByTestId('watch-shootout')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    await page.getByTestId('results-tab-analysis').click();
    await expect(replay).toHaveCount(0);
    expect(host.runtimeErrors).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
