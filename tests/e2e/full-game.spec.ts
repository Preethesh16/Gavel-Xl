import { expect, test } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  debugRoom,
  joinRoom,
  newDirector,
  playToResults,
  readyAndStart,
  setLargeBudget,
  type Director,
} from './helpers';

test('two directors complete every slot and receive the 100-metric verdict, recap and share card', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const host = await newDirector(browser, 'Preetesh');
  const guest = await newDirector(browser, 'Abhinav');
  const directors = [host, guest];
  let publicViewer: Director | null = null;

  try {
    const roomCode = await createRoom(host.page, host.name);
    await joinRoom(guest.page, roomCode, guest.name);
    await setLargeBudget(host.page, roomCode);
    await readyAndStart(host, [guest], roomCode, { preserveLargeBudget: true });

    const checkpointCycles: number[] = [];
    const progress = await playToResults(host, directors, roomCode, {
      onCheckpoint: async () => {
        const state = await debugRoom(host.page, roomCode);
        checkpointCycles.push(state.resolvedCycles);
        await expect(host.page.getByTestId('checkpoint-cards')).toBeVisible();
        await expect(host.page.getByTestId('checkpoint-rankings')).toContainText(
          'POSITIONS REMAIN',
        );
        await expect(host.page.getByTestId('checkpoint-squads')).toBeVisible();
        await expect(host.page.getByTestId('checkpoint-squad-index')).toHaveText('1 / 2');
        const firstDirector = await host.page
          .getByTestId('checkpoint-squad-director-1')
          .innerText();
        await host.page.getByTestId('checkpoint-squad-next').click();
        await expect(host.page.getByTestId('checkpoint-squad-index')).toHaveText('2 / 2');
        await expect(host.page.getByTestId('checkpoint-squads')).not.toContainText(
          `${firstDirector}'S WINDOW`,
        );
        await expect(host.page.getByTestId('checkpoint-squads')).toContainText('REMAINING');
        await expect(host.page.getByTestId('checkpoint-squads')).toContainText('SPENT');
      },
    });
    expect(progress.lots).toBe(12);
    expect(checkpointCycles).toEqual([4, 8]);

    await Promise.all(
      directors.map(({ page }) =>
        expect(page.getByTestId('results-screen')).toBeVisible({ timeout: 15_000 }),
      ),
    );
    await expect(host.page.getByTestId('results-podium')).toBeVisible();
    await expect(host.page.getByTestId('rematch-panel')).toBeVisible();
    await expect(host.page.getByTestId('rematch-draft')).toBeEnabled();
    await host.page.getByTestId('results-tab-analysis').click();
    await expect(host.page.getByTestId('analyst-report')).toBeVisible();
    await expect(host.page.getByTestId('analyst-report')).toContainText('ENGINE ANALYST DESK');
    await expect(host.page.getByTestId('analyst-report')).toContainText('WHY THE WINNER WON');
    const finalState = await debugRoom(host.page, roomCode);
    expect(finalState.squads).toHaveLength(24);
    for (const member of finalState.members.filter(({ isSpectator }) => !isSpectator)) {
      expect(finalState.squads.filter(({ memberId }) => memberId === member.id)).toHaveLength(12);
    }
    expect(finalState.evaluation?.metrics).toHaveLength(100);
    expect(finalState.evaluation?.teams).toHaveLength(2);
    expect(finalState.evaluation?.analystReport?.source).toMatch(/^(engine|groq)$/);
    expect(finalState.evaluation?.analystReport?.winnerId).toBe(
      finalState.evaluation?.teams.find((team) => team.rank === 1)?.memberId,
    );
    for (const metric of finalState.evaluation!.metrics) {
      expect(Object.keys(metric.scores)).toHaveLength(2);
      expect(Object.values(metric.scores).every((score) => score >= 0 && score <= 100)).toBe(true);
    }

    await host.page.getByTestId('results-tab-teams').click();
    await expect(host.page.getByTestId('results-teams')).toBeVisible();
    await expect(host.page.locator('[data-testid^="team-board-"]')).toHaveCount(2);
    await expect(host.page.getByTestId('results-teams')).toContainText('12 / 12');

    await host.page.getByTestId('results-tab-metrics').click();
    await expect(host.page.getByTestId('metric-count')).toHaveText('100');
    await expect(
      host.page.locator('[data-testid^="metric-"]:not([data-testid="metric-count"])'),
    ).toHaveCount(100);
    await host.page.getByTestId('metrics-category-filter').selectOption('ATTACK');
    await expect(
      host.page.locator('[data-testid^="metric-"]:not([data-testid="metric-count"])'),
    ).toHaveCount(10);
    await host.page.getByTestId('metrics-search').fill('Finishing');
    await expect(host.page.getByTestId('metrics-list')).toContainText('Finishing');

    await host.page.getByTestId('results-tab-replay').click();
    await expect(host.page.getByTestId('replay-screen')).toBeVisible();
    await expect(host.page.getByTestId('replay-timeline').locator('li')).not.toHaveCount(0);
    await expect(host.page.getByText('Revealed after completion')).toHaveCount(0);

    await host.page.getByTestId('results-tab-share').click();
    await expect(host.page.getByTestId('share-card')).toBeVisible();
    await expect(host.page.getByTestId('share-card')).toContainText('GAVEL XI CHAMPION');
    await host.page.getByTestId('share-results').click();
    await expect(host.page.getByTestId('share-screen')).toBeVisible();

    const resultsResponse = await host.page.request.get(
      `http://127.0.0.1:4000/api/rooms/${roomCode}/results`,
    );
    expect(resultsResponse.ok()).toBe(true);
    const publicResults = (await resultsResponse.json()) as {
      room: { code: string; evaluation: { metrics: unknown[] } | null };
    };
    expect(publicResults.room.code).toBe(roomCode);
    expect(publicResults.room.evaluation?.metrics).toHaveLength(100);
    const replayResponse = await host.page.request.get(
      `http://127.0.0.1:4000/api/rooms/${roomCode}/replay`,
    );
    expect(replayResponse.ok()).toBe(true);
    const publicReplay = (await replayResponse.json()) as {
      roomCode: string;
      replay: unknown[];
    };
    expect(publicReplay.roomCode).toBe(roomCode);
    expect(publicReplay.replay.length).toBeGreaterThan(0);
    const shareResponse = await host.page.request.get(
      `http://127.0.0.1:4000/api/share/${roomCode}`,
    );
    expect(shareResponse.ok()).toBe(true);
    const publicShare = (await shareResponse.json()) as {
      roomCode: string;
      champion: unknown;
      teams: unknown[];
    };
    expect(publicShare.roomCode).toBe(roomCode);
    expect(publicShare.champion).not.toBeNull();
    expect(publicShare.teams).toHaveLength(2);

    publicViewer = await newDirector(browser, 'PublicViewer');
    await publicViewer.page.goto(`/results/${roomCode}`);
    await expect(publicViewer.page.getByTestId('results-screen')).toBeVisible({ timeout: 15_000 });
    await expect(publicViewer.page.locator('.public-results__header')).toContainText(
      'READ-ONLY RESULT',
    );
    await expect(publicViewer.page.locator('.public-results__header')).toContainText(roomCode);
    await expect(publicViewer.page.getByTestId('results-podium')).toBeVisible();
    expect(
      await publicViewer.page.evaluate((key) => localStorage.getItem(key), 'gavel-xi:session'),
    ).toBeNull();
    await publicViewer.page.getByTestId('results-tab-metrics').click();
    await expect(publicViewer.page.getByTestId('metric-count')).toHaveText('100');

    expect([...directors, publicViewer].flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);

    await host.page.getByTestId('rematch-draft').click();
    await Promise.all(
      directors.map(({ page }) =>
        expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 15_000 }),
      ),
    );
    await expect(host.page.getByTestId('lobby-room-code')).toHaveText(roomCode);
    await expect(guest.page.getByTestId('lobby-room-code')).toHaveText(roomCode);
    await expect(host.page.getByTestId('participant-count')).toContainText('2');
    await host.page.getByTestId('settings-formation').selectOption('4-4-2');
    await expect
      .poll(async () => (await debugRoom(host.page, roomCode)).settings.formation)
      .toBe('4-4-2');
    await expect(guest.page.getByTestId('settings-formation')).toHaveValue('4-4-2');
  } finally {
    await closeDirectors(publicViewer ? [...directors, publicViewer] : directors);
  }
});
