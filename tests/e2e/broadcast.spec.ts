import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  debugRoom,
  joinRoom,
  newDirector,
  playToResults,
  readyAndStart,
  setLargeBudget,
} from './helpers';

async function expectContainedScene(page: Page, scene: string): Promise<void> {
  // Sample moving elements across several frames: a transform can overflow the
  // document briefly even when the final, static layout fits the screen.
  const dimensions = await page.evaluate(async () => {
    const samples: Array<{ viewport: number; document: number }> = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push({
        viewport: window.innerWidth,
        document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      });
    }
    return samples;
  });
  for (const sample of dimensions) {
    expect(
      sample.document,
      `${scene} should fit a ${sample.viewport}px viewport`,
    ).toBeLessThanOrEqual(sample.viewport + 1);
  }
}

async function captureScene(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  const body = await page.screenshot({ animations: 'allow', fullPage: true });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

async function inspectTwoPlayers(board: Locator): Promise<void> {
  const occupied = board.locator('button[data-testid^="pitch-player-"][data-occupied="true"]');
  await expect(occupied.nth(1)).toBeVisible();
  await occupied.first().click();
  await expect(occupied.first()).toHaveAttribute('aria-pressed', 'true');
  const firstDetails = await board.getByTestId('pitch-player-detail').innerText();
  expect(firstDetails.trim()).not.toBe('');

  // Keyboard selection is the same interaction as tapping a player tile.
  await occupied.nth(1).focus();
  await occupied.nth(1).press('Enter');
  await expect(occupied.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(occupied.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(board.getByTestId('pitch-player-detail')).not.toHaveText(firstDetails);
}

test('broadcast scenes animate, explain each squad and expose a controllable ceremony on desktop and phone', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const host = await newDirector(browser, 'North London', {
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  });
  const guest = await newDirector(browser, 'Catalunya');
  const directors = [host, guest];
  const page = host.page;

  try {
    const roomCode = await createRoom(page, host.name);
    await joinRoom(guest.page, roomCode, guest.name);
    await setLargeBudget(page, roomCode);
    await readyAndStart(host, [guest], roomCode, { preserveLargeBudget: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Preserve the short server-side game clock, but opt this test out of the
    // blanket E2E CSS animation suppression so it exercises the shipped motion.
    await page.locator('.app-shell').evaluate((element) => element.removeAttribute('data-e2e'));

    const progress = await playToResults(host, directors, roomCode, {
      onCheckpoint: async (checkpoint) => {
        const screen = page.getByTestId('checkpoint-screen');
        await expect(screen).toBeVisible();
        await expect(page.getByTestId('checkpoint-cards')).toBeVisible();
        await expect(page.getByTestId('checkpoint-rankings')).toContainText(host.name);
        await expect(page.getByTestId('checkpoint-rankings')).toContainText(guest.name);
        await expectContainedScene(page, `checkpoint ${checkpoint}`);
        if (checkpoint !== 1) return;

        await captureScene(page, testInfo, 'broadcast-checkpoint-desktop');
        const squads = page.getByTestId('checkpoint-squads');
        const directorHeading = squads
          .locator('[data-testid^="team-board-"] > header')
          .getByRole('heading');
        await expect(page.getByTestId('checkpoint-squad-index')).toHaveText('1 / 2');
        await page.getByTestId('checkpoint-squad-next').click();
        await expect(page.getByTestId('checkpoint-squad-index')).toHaveText('2 / 2');
        await expect(directorHeading).toHaveText(guest.name);
        await page.getByTestId('checkpoint-squad-previous').click();
        await expect(page.getByTestId('checkpoint-squad-index')).toHaveText('1 / 2');
        await expect(directorHeading).toHaveText(host.name);
        await inspectTwoPlayers(squads);

        await page.setViewportSize({ width: 360, height: 780 });
        await expectContainedScene(page, 'phone checkpoint and tactical pitch');
        await captureScene(page, testInfo, 'broadcast-checkpoint-phone');
        await squads.scrollIntoViewIfNeeded();
        await inspectTwoPlayers(squads);
        await testInfo.attach('broadcast-tactical-pitch-phone', {
          body: await squads.screenshot({ animations: 'allow' }),
          contentType: 'image/png',
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
      },
    });
    expect(progress.checkpoints).toBe(2);
    await expect(page.getByTestId('results-podium')).toBeVisible();
    const finalState = await debugRoom(page, roomCode);
    const winnerId = finalState.evaluation?.teams.find((team) => team.rank === 1)?.memberId;
    const winnerName = finalState.members.find((member) => member.id === winnerId)?.name;
    expect(winnerName).toBeTruthy();
    await expect(page.getByTestId('results-podium')).toContainText(winnerName!);
    await expectContainedScene(page, 'desktop champion reveal');
    await captureScene(page, testInfo, 'broadcast-winner-desktop');

    await page.getByTestId('replay-ceremony').click();
    const ceremony = page.getByTestId('verdict-reveal');
    await expect(ceremony).toBeVisible();
    await page.getByTestId('verdict-pause').click();
    await expect(page.getByTestId('verdict-pause')).toHaveAttribute('aria-pressed', 'true');
    const counter = page.getByTestId('verdict-round-counter');
    const pausedRound = await counter.innerText();
    // Wait longer than an automatic round to prove pause stops progression.
    await page.waitForTimeout(4_600);
    await expect(counter).toHaveText(pausedRound);
    await page.getByTestId('verdict-next').click();
    await expect(counter).not.toHaveText(pausedRound);
    await expect(page.getByTestId('verdict-pause')).toHaveAttribute('aria-pressed', 'true');
    await expectContainedScene(page, 'desktop category duel');
    await captureScene(page, testInfo, 'broadcast-ceremony-desktop');

    await page.setViewportSize({ width: 360, height: 780 });
    await expectContainedScene(page, 'phone category duel');
    await captureScene(page, testInfo, 'broadcast-ceremony-phone');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() =>
        ceremony.evaluate(
          (element) =>
            element.getAnimations({ subtree: true }).filter((animation) => {
              const timing = animation.effect?.getTiming();
              return animation.playState === 'running' && Number(timing?.duration ?? 0) > 20;
            }).length,
        ),
      )
      .toBe(0);
    await page.getByTestId('verdict-skip').click();
    await expect(ceremony).not.toBeVisible();
    await expect(page.getByTestId('results-podium')).toContainText(winnerName!);
    await expectContainedScene(page, 'phone winner with reduced motion');
    await captureScene(page, testInfo, 'broadcast-winner-phone');

    await page.getByTestId('results-tab-teams').click();
    const finalBoards = page.getByTestId('results-teams').locator('[data-testid^="team-board-"]');
    await expect(finalBoards).toHaveCount(2);
    await expect(finalBoards.first().locator('button[data-occupied="true"]')).toHaveCount(11);
    await inspectTwoPlayers(finalBoards.first());
    await expectContainedScene(page, 'phone completed lineups');
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
