import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { MetricScoreView, RoomView } from '../../packages/shared/src/types';
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

async function expectMetricResult(
  ceremony: Locator,
  metric: MetricScoreView,
  room: RoomView,
): Promise<void> {
  await expect(ceremony).toHaveAttribute('data-phase', 'metric');
  const slide = ceremony.getByTestId('ceremony-metric');
  await expect(slide).toHaveAttribute('data-metric-index', String(metric.index));
  await expect(slide).toContainText(metric.metric);
  const contenders = slide.locator('[data-member-id]');
  const directors = room.members.filter((member) => !member.isSpectator);
  await expect(contenders).toHaveCount(directors.length);
  for (const director of directors) {
    const contender = slide.locator(`[data-member-id="${director.id}"]`);
    await expect(contender).toContainText(director.name);
    await expect(contender.locator('.score-number')).toHaveAttribute(
      'aria-label',
      (metric.scores[director.id] ?? 0).toFixed(1),
    );
  }
  const winnerIds = await slide
    .locator('[data-member-id][data-winner="true"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-member-id')!).sort(),
    );
  // Compare identifiers, not just the first score: tied metrics must highlight
  // every authoritative winner without granting an extra win to another team.
  expect(winnerIds).toEqual([...metric.winnerIds].sort());
}

async function expectContained(page: Page, phase: string): Promise<void> {
  const dimensions = await page.evaluate(async () => {
    const samples = [];
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push({
        viewport: window.innerWidth,
        document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      });
    }
    return samples;
  });
  for (const sample of dimensions) {
    expect(sample.document, `${phase} must fit ${sample.viewport}px`).toBeLessThanOrEqual(
      sample.viewport + 1,
    );
  }
}

async function attachPhase(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: 'allow', fullPage: true }),
    contentType: 'image/png',
  });
}

interface HeldSpeechLine {
  text: string;
  canceled: boolean;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

type SpeechProbeWindow = typeof window & {
  __GAVEL_SOUND_TEST__?: boolean;
  __ceremonySpeech: {
    lines: HeldSpeechLine[];
    active: number | null;
    cancellations: number;
  };
};

async function installHeldNarrator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as SpeechProbeWindow;
    testWindow.__GAVEL_SOUND_TEST__ = true;
    testWindow.__ceremonySpeech = { lines: [], active: null, cancellations: 0 };
    localStorage.setItem('gavel-xi:sound', 'on');
    localStorage.setItem('gavel-xi:voice', 'on');
    localStorage.setItem('gavel-xi:commentator', 'device');
    localStorage.setItem('gavel-xi:volume', '0.8');

    class HeldUtterance {
      canceled = false;
      voice: SpeechSynthesisVoice | null = null;
      lang = 'en-GB';
      rate = 1;
      pitch = 1;
      volume = 1;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;

      constructor(readonly text: string) {}
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: HeldUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          {
            default: true,
            lang: 'en-GB',
            localService: true,
            name: 'Controlled English',
            voiceURI: 'controlled-english',
          },
        ],
        resume: () => undefined,
        speak: (utterance: HeldUtterance) => {
          // Ignore the silent user-gesture warm-up, but hold real narration until
          // the test explicitly calls that utterance's completion callback.
          if (!utterance.text.trim()) return;
          const probe = testWindow.__ceremonySpeech;
          probe.lines.push(utterance);
          probe.active = probe.lines.length - 1;
        },
        cancel: () => {
          const probe = testWindow.__ceremonySpeech;
          probe.cancellations += 1;
          const old = probe.active === null ? null : probe.lines[probe.active];
          probe.active = null;
          if (old) {
            old.canceled = true;
            old.onerror?.({ error: 'canceled' });
          }
        },
      },
    });
  });
}

async function speechState(page: Page) {
  return page.evaluate(() => {
    const probe = (window as SpeechProbeWindow).__ceremonySpeech;
    return {
      active: probe.active,
      activeText: probe.active === null ? null : probe.lines[probe.active]?.text,
      count: probe.lines.length,
      cancellations: probe.cancellations,
    };
  });
}

async function finishSpeech(page: Page, index: number): Promise<void> {
  await page.evaluate((utteranceIndex) => {
    const probe = (window as SpeechProbeWindow).__ceremonySpeech;
    const line = probe.lines[utteranceIndex];
    if (!line) throw new Error('Expected a captured narration utterance');
    if (probe.active === utteranceIndex) probe.active = null;
    // Retain callbacks after cancellation so stale browser events are testable.
    line.onend?.();
  }, index);
}

async function expectNarrationLifecycle(page: Page, roomCode: string): Promise<void> {
  await installHeldNarrator(page);
  await page.goto(`/results/${roomCode}`);
  await expect(page.getByTestId('results-podium')).toBeVisible();
  await page.getByTestId('replay-ceremony').click();
  const ceremony = page.getByTestId('results-ceremony');
  const counter = page.getByTestId('ceremony-counter');
  await expect(ceremony).toHaveAttribute('data-phase', 'category');
  await page.getByTestId('ceremony-speed').selectOption('3');
  await expect.poll(async () => (await speechState(page)).active).not.toBeNull();
  const categorySpeech = await speechState(page);
  const categoryCounter = await counter.innerText();
  await page.waitForTimeout(2_100);
  await expect(counter).toHaveText(categoryCounter);
  expect((await speechState(page)).active).toBe(categorySpeech.active);

  await finishSpeech(page, categorySpeech.active!);
  await expect(ceremony).toHaveAttribute('data-phase', 'metric');
  await expect(page.getByTestId('ceremony-metric')).toHaveAttribute('data-metric-index', '1');
  await expect
    .poll(async () => (await speechState(page)).active ?? -1)
    .toBeGreaterThan(categorySpeech.active!);
  const firstMetricSpeech = await speechState(page);
  const firstMetricCounter = await counter.innerText();

  await page.getByTestId('ceremony-pause').click();
  await expect(page.getByTestId('ceremony-pause')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await speechState(page)).active).toBeNull();
  expect((await speechState(page)).cancellations).toBeGreaterThan(firstMetricSpeech.cancellations);
  await page.waitForTimeout(2_100);
  await expect(counter).toHaveText(firstMetricCounter);
  await page.getByTestId('ceremony-pause').click();
  await expect
    .poll(async () => (await speechState(page)).active ?? -1)
    .toBeGreaterThan(firstMetricSpeech.active!);
  const resumedSpeech = await speechState(page);
  expect(resumedSpeech.activeText).toBe(firstMetricSpeech.activeText);
  await expect(counter).toHaveText(firstMetricCounter);

  await page.getByTestId('ceremony-next').click();
  await expect(page.getByTestId('ceremony-metric')).toHaveAttribute('data-metric-index', '2');
  await expect
    .poll(async () => (await speechState(page)).active ?? -1)
    .toBeGreaterThan(resumedSpeech.active!);
  const secondMetricSpeech = await speechState(page);
  const secondMetricCounter = await counter.innerText();
  // A late end event from the canceled first metric must not release the new
  // metric's narration gate, even after the new scene's minimum duration.
  await finishSpeech(page, resumedSpeech.active!);
  await page.waitForTimeout(2_100);
  await expect(counter).toHaveText(secondMetricCounter);
  expect((await speechState(page)).active).toBe(secondMetricSpeech.active);
  await finishSpeech(page, secondMetricSpeech.active!);
  await expect(page.getByTestId('ceremony-metric')).toHaveAttribute('data-metric-index', '3');
  await page.getByTestId('ceremony-finish').click();
  await expect(ceremony).not.toBeVisible();
  await expect(page.getByTestId('results-tab-podium')).toBeVisible();
  await expect.poll(async () => (await speechState(page)).active).toBeNull();
}

test('three directors see every locked metric, team analysis, champion and rated lineup before the dashboard', async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const host = await newDirector(browser, 'Ceremony Host', {
    viewport: { width: 1440, height: 1000 },
  });
  const second = await newDirector(browser, 'Ceremony Rival');
  const third = await newDirector(browser, 'Ceremony Challenger');
  const directors = [host, second, third];
  const page = host.page;

  try {
    const roomCode = await createRoom(page, host.name);
    for (const guest of [second, third]) await joinRoom(guest.page, roomCode, guest.name);
    await setLargeBudget(page, roomCode);
    await readyAndStart(host, [second, third], roomCode, { preserveLargeBudget: true });
    await playToResults(host, directors, roomCode, { skipCeremony: false });
    const ceremony = page.getByTestId('results-ceremony');
    await expect(ceremony).toBeVisible();
    await expect(ceremony).toHaveAttribute('data-phase', 'category');
    await page.getByTestId('ceremony-pause').click();
    await expect(page.getByTestId('ceremony-pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('results-tab-podium')).not.toBeVisible();

    const response = await page.request.get(`${SERVER_URL}/api/rooms/${roomCode}/results`);
    expect(response.ok()).toBe(true);
    const { room } = (await response.json()) as { room: RoomView };
    const evaluation = room.evaluation!;
    expect(evaluation.metrics).toHaveLength(100);
    expect(evaluation.teams).toHaveLength(3);
    const memberIds = evaluation.teams.map((team) => team.memberId).sort();
    const champion = evaluation.teams.find((team) => team.rank === 1)!;
    const categories = [...new Set(evaluation.metrics.map((metric) => metric.category))];
    expect(categories).toHaveLength(10);

    // The other directors can finish their personal broadcast independently.
    for (const guest of [second, third]) {
      await guest.page.getByTestId('ceremony-finish').click();
      await expect(guest.page.getByTestId('results-podium')).toBeVisible();
    }
    await page.getByTestId('ceremony-speed').selectOption('3');
    await expect(page.getByTestId('ceremony-speed')).toHaveValue('3');
    const counter = page.getByTestId('ceremony-counter');
    const pausedCounter = await counter.innerText();
    await page.waitForTimeout(1_800);
    await expect(counter).toHaveText(pausedCounter);
    await page.getByTestId('ceremony-pause').click();
    await expect(counter).not.toHaveText(pausedCounter);
    await page.getByTestId('ceremony-pause').click();
    await expect(page.getByTestId('ceremony-pause')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('ceremony-previous').click();
    await expect(ceremony).toHaveAttribute('data-phase', 'category');
    await page.getByTestId('ceremony-speed').selectOption('1');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('.app-shell').evaluate((element) => element.removeAttribute('data-e2e'));
    const seenMetrics: number[] = [];
    for (const [categoryIndex, category] of categories.entries()) {
      await expect(ceremony).toHaveAttribute('data-phase', 'category');
      await expect(ceremony).toContainText(category.replaceAll(' & ', ' + '));
      await page.getByTestId('ceremony-next').click();
      const metrics = evaluation.metrics.filter((metric) => metric.category === category);
      expect(metrics).toHaveLength(10);
      for (const metric of metrics) {
        await expectMetricResult(ceremony, metric, room);
        seenMetrics.push(metric.index);
        if (metric.index === evaluation.metrics[0]!.index) {
          await expectContained(page, 'desktop metric ceremony');
          await attachPhase(page, testInfo, 'ceremony-metric-desktop');
          const firstMetricCounter = await counter.innerText();
          await page.getByTestId('ceremony-previous').click();
          await expect(ceremony).toHaveAttribute('data-phase', 'category');
          await page.getByTestId('ceremony-next').click();
          await expect(counter).toHaveText(firstMetricCounter);
          await expectMetricResult(ceremony, metric, room);
        }
        if (categoryIndex === 1 && metric.index === metrics[0]!.index) {
          await expectContained(page, 'phone metric ceremony');
          await attachPhase(page, testInfo, 'ceremony-metric-phone');
        }
        await page.getByTestId('ceremony-next').click();
      }
      if (categoryIndex === 0) {
        await page.setViewportSize({ width: 360, height: 780 });
        await expectContained(page, 'phone category ceremony');
        await attachPhase(page, testInfo, 'ceremony-category-phone');
      }
      if (categoryIndex === 1) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect
          .poll(() =>
            ceremony.evaluate(
              (element) =>
                element.getAnimations({ subtree: true }).filter((animation) => {
                  const duration = Number(animation.effect?.getTiming().duration ?? 0);
                  return animation.playState === 'running' && duration > 20;
                }).length,
            ),
          )
          .toBe(0);
      }
    }
    expect(seenMetrics).toEqual(evaluation.metrics.map((metric) => metric.index));
    expect(new Set(seenMetrics).size).toBe(100);

    const analysedMembers: string[] = [];
    for (let index = 0; index < evaluation.teams.length; index += 1) {
      await expect(ceremony).toHaveAttribute('data-phase', 'analysis');
      const analysis = page.getByTestId('ceremony-analysis');
      const memberId = (await analysis.getAttribute('data-member-id'))!;
      analysedMembers.push(memberId);
      const member = room.members.find((candidate) => candidate.id === memberId)!;
      expect(member).toBeTruthy();
      await expect(analysis).toContainText(member.name);
      const report = evaluation.analystReport?.teamVerdicts.find(
        (verdict) => verdict.memberId === memberId,
      );
      if (report) {
        await expect(analysis).toContainText(report.tacticalIdentity);
        await expect(analysis).toContainText(report.decisiveEdge);
        await expect(analysis).toContainText(report.concern);
      }
      await expectContained(page, `phone analysis ${index + 1}`);
      if (index === 0) await attachPhase(page, testInfo, 'ceremony-analysis-phone');
      await page.getByTestId('ceremony-next').click();
    }
    expect(analysedMembers.sort()).toEqual(memberIds);

    await expect(ceremony).toHaveAttribute('data-phase', 'verdict');
    await expect(page.getByTestId('ceremony-verdict')).toHaveAttribute(
      'data-winner-id',
      champion.memberId,
    );
    await expect(page.getByTestId('ceremony-verdict')).toContainText(
      room.members.find((member) => member.id === champion.memberId)!.name,
    );
    await expectContained(page, 'phone final champion');
    await attachPhase(page, testInfo, 'ceremony-verdict-phone');
    await page.getByTestId('ceremony-next').click();

    const shownLineups: string[] = [];
    for (let index = 0; index < evaluation.teams.length; index += 1) {
      await expect(ceremony).toHaveAttribute('data-phase', 'lineup');
      const lineup = page.getByTestId('ceremony-lineup');
      const memberId = (await lineup.getAttribute('data-member-id'))!;
      shownLineups.push(memberId);
      const teamResult = evaluation.teams.find((team) => team.memberId === memberId)!;
      expect(teamResult).toBeTruthy();
      await expect(lineup.getByTestId('ceremony-lineup-score')).toContainText(
        teamResult.overallScore.toFixed(1),
      );
      await expect(lineup.getByTestId('ceremony-lineup-metric-wins')).toHaveText(
        `${teamResult.metricWins} / ${evaluation.metrics.length}`,
      );
      const categoryScores = lineup
        .getByTestId('ceremony-lineup-categories')
        .locator('.ceremony-lineup__category');
      await expect(categoryScores).toHaveCount(Object.keys(teamResult.categoryScores).length);
      for (const [category, score] of Object.entries(teamResult.categoryScores)) {
        const categoryScore = categoryScores.filter({ hasText: category });
        await expect(categoryScore.locator('strong')).toHaveText(score.toFixed(1));
      }
      const signedPlayers = room.squads.filter(
        (entry) => entry.memberId === memberId && entry.candidate.kind === 'PLAYER',
      );
      expect(signedPlayers).toHaveLength(11);
      const playerTiles = lineup.locator(
        'button[data-testid^="pitch-player-"][data-occupied="true"]',
      );
      await expect(playerTiles).toHaveCount(11);
      const tileBounds = await playerTiles.evaluateAll((tiles) => {
        const board = document
          .querySelector('.ceremony-lineup .tactical-board')!
          .getBoundingClientRect();
        const dock = document.querySelector('.ceremony-controls')!.getBoundingClientRect();
        return tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            boardLeft: board.left,
            boardRight: board.right,
            dockTop: dock.top,
          };
        });
      });
      for (const tile of tileBounds) {
        expect(tile.left).toBeGreaterThanOrEqual(tile.boardLeft);
        expect(tile.right).toBeLessThanOrEqual(tile.boardRight);
        expect(tile.bottom).toBeLessThanOrEqual(tile.dockTop);
      }
      await expect(playerTiles.locator('.tactical-player__rating small')).toHaveText(
        Array.from({ length: 11 }, () => 'FORM'),
      );
      const presentedPlayers = await playerTiles.evaluateAll((elements) =>
        elements.map((element) => ({
          name: element.querySelector('.tactical-player__name')?.textContent,
          rating: element.querySelector('.tactical-player__rating')?.textContent,
        })),
      );
      for (const player of signedPlayers) {
        expect(presentedPlayers).toContainEqual({
          name: player.candidate.commonName || player.candidate.fullName,
          rating: `FORM${Math.round(player.candidate.currentFormRating)}`,
        });
      }
      await expectContained(page, `phone rated lineup ${index + 1}`);
      if (index === 0) await attachPhase(page, testInfo, 'ceremony-lineup-phone');
      await page.getByTestId('ceremony-next').click();
    }
    expect(shownLineups.sort()).toEqual(memberIds);
    await expect(ceremony).not.toBeVisible();
    await expect(page.getByTestId('results-tab-podium')).toBeVisible();

    // Replay is a fresh presentation. Chapter controls let a returning viewer
    // move between the same sections without waiting through every metric.
    await page.getByTestId('replay-ceremony').click();
    await expect(ceremony).toHaveAttribute('data-phase', 'category');
    await page.getByTestId('ceremony-pause').click();
    await page.getByTestId('ceremony-skip-chapter').click();
    await expect(ceremony).toHaveAttribute('data-phase', 'analysis');
    await page.getByTestId('ceremony-skip-chapter').click();
    await expect(ceremony).toHaveAttribute('data-phase', 'verdict');
    await page.getByTestId('ceremony-skip-chapter').click();
    await expect(ceremony).toHaveAttribute('data-phase', 'lineup');
    await page.getByTestId('ceremony-skip-chapter').click();
    await expect(ceremony).not.toBeVisible();
    await expect(page.getByTestId('results-tab-podium')).toBeVisible();
    await test.step('narration gates playback and stale speech cannot advance another scene', async () => {
      const listener = await newDirector(browser, 'Ceremony Listener');
      directors.push(listener);
      await expectNarrationLifecycle(listener.page, roomCode);
    });
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
