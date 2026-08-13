import { expect, test } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  debugRoom,
  joinRoom,
  newDirector,
  readyAndStart,
  SESSION_KEY,
  setLargeBudget,
  settleOpenLot,
  waitForPhase,
  type Director,
} from './helpers';

test('four isolated clients synchronize presence, atomic bids, outcomes, reconnect, spectator and checkpoint', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const names = ['Preetesh', 'Abhinav', 'Imran', 'TestUser4'];
  const directors: Director[] = [];
  const spectator = await newDirector(browser, 'LateWatcher');

  try {
    for (const name of names) directors.push(await newDirector(browser, name));
    const [host, ...guests] = directors as [Director, ...Director[]];
    const roomCode = await createRoom(host.page, host.name);
    await Promise.all(guests.map(({ page, name }) => joinRoom(page, roomCode, name)));

    await Promise.all(
      directors.map(async ({ page }) => {
        await expect(page.getByTestId('participant-count')).toContainText('4');
        for (const name of names)
          await expect(page.getByTestId('participant-list')).toContainText(name);
      }),
    );
    await setLargeBudget(host.page, roomCode);
    await readyAndStart(host, guests, roomCode, {
      preserveLargeBudget: true,
      budgetMode: 'STRICT',
    });

    for (const { page } of directors) {
      await expect(page.getByTestId('max-legal-bid')).toHaveText(/^€[\d,]+M$/);
      await expect(page.getByTestId('max-legal-bid')).not.toContainText('SERVER LIMIT SYNCING');
    }

    const firstNames = await Promise.all(
      directors.map(({ page }) => page.getByTestId('revealed-player-name').innerText()),
    );
    expect(new Set(firstNames).size).toBe(1);

    // Dispatch both precomputed minimum bids at the same wall-clock instant. A
    // normal Promise.all can still serialize Playwright clicks long enough for
    // the second browser to observe and legally outbid the first.
    const equalBidLabels = await Promise.all(
      directors.slice(0, 2).map(({ page }) => page.getByTestId('bid-quick-1').innerText()),
    );
    expect(new Set(equalBidLabels).size).toBe(1);
    const dispatchAt = Date.now() + 300;
    await Promise.all(
      directors.slice(0, 2).map(({ page }) =>
        page.getByTestId('bid-quick-1').evaluate(
          (button, target) =>
            new Promise<void>((resolve) => {
              window.setTimeout(
                () => {
                  (button as HTMLButtonElement).click();
                  resolve();
                },
                Math.max(0, target - Date.now()),
              );
            }),
          dispatchAt,
        ),
      ),
    );
    await expect
      .poll(async () => (await debugRoom(host.page, roomCode)).currentLot?.currentLeaderId ?? null)
      .not.toBeNull();
    const concurrentState = await debugRoom(host.page, roomCode);
    expect(concurrentState.currentLot?.currentBidEUR).not.toBeNull();
    const acceptedLeaderId = concurrentState.currentLot!.currentLeaderId!;
    const acceptedLeader = concurrentState.members.find(({ id }) => id === acceptedLeaderId)!.name;
    expect(['Preetesh', 'Abhinav']).toContain(acceptedLeader);
    expect(concurrentState.replay.filter(({ type }) => type === 'BID')).toHaveLength(1);
    const acceptedBid = `€${(concurrentState.currentLot!.currentBidEUR! / 1_000_000).toLocaleString(
      'en-US',
    )}M`;
    await Promise.all(
      directors.flatMap(({ page }) => [
        expect(page.getByTestId('current-bid')).toHaveText(acceptedBid),
        expect(page.getByTestId('current-leader')).toHaveText(acceptedLeader),
      ]),
    );

    const winner = directors.find(({ name }) => name === acceptedLeader)!;
    const soldAnimations = directors.map(({ page }) =>
      expect(page.getByTestId('sold-animation')).toBeVisible({ timeout: 2_000 }),
    );
    await Promise.all(
      directors
        .filter((director) => director !== winner)
        .map(({ page }) => page.getByTestId('pass-button').click()),
    );
    await Promise.all(soldAnimations);

    await waitForPhase(host.page, roomCode, ['BIDDING']);
    const reconnecting = directors[1]!;
    const sessionBefore = await reconnecting.page.evaluate(
      (key) => localStorage.getItem(key),
      SESSION_KEY,
    );
    const budgetBefore = await reconnecting.page.getByTestId('my-budget').innerText();
    const memberIdBefore = JSON.parse(sessionBefore!) as { memberId: string };
    await reconnecting.page.reload();
    await expect(reconnecting.page.getByTestId('my-name')).toContainText(reconnecting.name, {
      timeout: 15_000,
    });
    await expect(reconnecting.page.getByTestId('my-budget')).toHaveText(budgetBefore);
    await expect(reconnecting.page.getByTestId('max-legal-bid')).toHaveText(/^€[\d,]+M$/);
    await expect(reconnecting.page.getByTestId('max-legal-bid')).not.toContainText(
      'SERVER LIMIT SYNCING',
    );
    const sessionAfter = await reconnecting.page.evaluate(
      (key) => localStorage.getItem(key),
      SESSION_KEY,
    );
    expect((JSON.parse(sessionAfter!) as { memberId: string }).memberId).toBe(
      memberIdBefore.memberId,
    );
    const afterReconnect = await debugRoom(host.page, roomCode);
    expect(afterReconnect.members.filter(({ name }) => name === reconnecting.name)).toHaveLength(1);

    await joinRoom(spectator.page, roomCode, spectator.name);
    await expect(spectator.page.getByText('SPECTATOR MODE')).toBeVisible();
    await expect(spectator.page.getByTestId('eligibility')).toHaveText('SPECTATOR');
    await expect(spectator.page.getByTestId('bid-quick-1')).toHaveCount(0);
    await expect(spectator.page.getByTestId('pass-button')).toHaveCount(0);
    const spectatorState = await debugRoom(host.page, roomCode);
    expect(spectatorState.members.find(({ name }) => name === spectator.name)?.isSpectator).toBe(
      true,
    );
    expect(spectatorState.currentLot?.eligibleMemberIds).toHaveLength(4);

    await host.page.getByTestId('team-check-open').click();
    await expect(host.page.getByTestId('team-check-modal')).toBeVisible();
    await expect(host.page.locator('[data-testid^="team-board-"]')).toHaveCount(1);
    await host.page.getByTestId('team-check-all').click();
    await expect(host.page.locator('[data-testid^="team-board-"]')).toHaveCount(4);
    await expect(host.page.getByTestId('team-check-modal')).not.toContainText(spectator.name);
    await host.page.getByTestId('team-check-close').click();

    let forcedSeen = false;
    let checkpointSeen = false;
    for (let lot = 1; lot <= 50 && (!forcedSeen || !checkpointSeen); lot += 1) {
      const phase = (await waitForPhase(host.page, roomCode, ['BIDDING', 'CHECKPOINT'])).phase;
      if (phase === 'CHECKPOINT') {
        checkpointSeen = true;
        await Promise.all(
          [...directors, spectator].map(({ page }) =>
            expect(page.getByTestId('checkpoint-screen')).toBeVisible(),
          ),
        );
        await expect(host.page.locator('.checkpoint__heading')).toContainText(
          '4 of 12 position cycles resolved',
        );
        await expect(host.page.getByTestId('checkpoint-rankings').locator('article')).toHaveCount(
          4,
        );
        for (const name of names) {
          await expect(host.page.getByTestId('checkpoint-rankings')).toContainText(name);
        }
        await host.page.getByTestId('checkpoint-broadcast').click();
        continue;
      }
      const outcome = await settleOpenLot(directors, roomCode, lot, {
        allowSocketFallback: false,
      });
      if (outcome.resolvedPhase === 'FORCED_ASSIGNMENT') {
        forcedSeen = true;
        await Promise.all(
          [...directors, spectator].map(({ page }) =>
            expect(page.getByTestId('forced-animation')).toBeVisible({ timeout: 2_000 }),
          ),
        );
      }
    }
    expect(forcedSeen).toBe(true);
    expect(checkpointSeen).toBe(true);

    expect([...directors, spectator].flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors([...directors, spectator]);
  }
});
