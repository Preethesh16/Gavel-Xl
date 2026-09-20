import { expect, test, type Locator, type Page } from '@playwright/test';
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

interface LockedMetric {
  index: number;
  metric: string;
  category: string;
  scores: Record<string, number>;
}

async function expectLockedScores(card: Locator, metric: LockedMetric): Promise<void> {
  const expectedScores = Object.values(metric.scores)
    .map((score) => score.toFixed(1))
    .sort();
  const numbers = card.locator('.score-number');
  await expect(numbers).toHaveCount(expectedScores.length);
  // The readable result must remain authoritative even while decorative digit
  // reels are moving; assistive technology must not announce their extra digits.
  const actualScores = await numbers.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label')).sort(),
  );
  expect(actualScores).toEqual(expectedScores);
  await expect(card.locator('.metric-dial')).toHaveCount(expectedScores.length);
  await expect(card.locator('.score-reel')).not.toHaveCount(0);
  await expect(card.locator('.score-reel:not([aria-hidden="true"])')).toHaveCount(0);
}

async function expectNoOverflow(page: Page, screen: string): Promise<void> {
  const samples = await page.evaluate(async () => {
    const measurements = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      measurements.push({
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        viewport: window.innerWidth,
      });
    }
    return measurements;
  });
  for (const sample of samples) {
    expect(
      sample.width,
      `${screen} must fit ${sample.viewport}px while animating`,
    ).toBeLessThanOrEqual(sample.viewport + 1);
  }
}

test('the 100-metric lab keeps its animated scores accurate, selectable and contained on phones', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const host = await newDirector(browser, 'Metric Director', {
    viewport: { width: 1440, height: 1000 },
  });
  const guest = await newDirector(browser, 'Metric Rival');
  const directors = [host, guest];
  const page = host.page;

  try {
    const roomCode = await createRoom(page, host.name);
    await joinRoom(guest.page, roomCode, guest.name);
    await setLargeBudget(page, roomCode);
    await readyAndStart(host, [guest], roomCode, { preserveLargeBudget: true });
    await playToResults(host, directors, roomCode);
    await expect(page.getByTestId('results-podium')).toBeVisible();

    const response = await page.request.get(`${SERVER_URL}/api/rooms/${roomCode}/results`);
    expect(response.ok()).toBe(true);
    const result = (await response.json()) as {
      room: { evaluation: { metrics: LockedMetric[] } };
    };
    const metrics = result.room.evaluation.metrics;
    expect(metrics).toHaveLength(100);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Keep accelerated server clocks, but exercise the actual shipped CSS.
    await page.locator('.app-shell').evaluate((element) => element.removeAttribute('data-e2e'));
    await page.getByTestId('results-tab-metrics').click();
    const lab = page.getByTestId('metrics-explorer');
    const cards = page.getByTestId('metrics-list').locator('.metric-lab-card');
    await expect(cards).toHaveCount(100);
    await expect(page.getByTestId('metric-count')).toHaveText('100');
    await expect(lab.locator('.metric-bars')).toHaveCount(0);
    await expect(lab.locator('[data-testid^="lab-cell-"]')).toHaveCount(100);
    await expectLockedScores(page.getByTestId(`metric-${metrics[0]!.index}`), metrics[0]!);
    await expectNoOverflow(page, 'desktop metric lab');

    const selectedMetric = metrics[49]!;
    await page.getByTestId(`lab-cell-${selectedMetric.index}`).click();
    const selectedCard = page.getByTestId(`metric-${selectedMetric.index}`);
    await expect(selectedCard).toHaveClass(/is-focused/);
    await selectedCard.scrollIntoViewIfNeeded();
    await expect(selectedCard).toHaveAttribute('data-motion', 'active');
    await expectLockedScores(selectedCard, selectedMetric);
    const offscreenCards = page
      .getByTestId('metrics-list')
      .locator('.metric-lab-card[data-motion="idle"]');
    await expect(offscreenCards).not.toHaveCount(0);
    await expect
      .poll(() =>
        offscreenCards.evaluateAll(
          (elements) =>
            elements.flatMap((element) =>
              element.getAnimations({ subtree: true }).filter((animation) => {
                const duration = Number(animation.effect?.getTiming().duration ?? 0);
                return animation.playState === 'running' && duration > 20;
              }),
            ).length,
        ),
      )
      .toBe(0);
    await testInfo.attach('metrics-lab-desktop', {
      body: await selectedCard.screenshot({ animations: 'allow' }),
      contentType: 'image/png',
    });

    await page.getByTestId('metrics-category-filter').selectOption('ATTACK');
    const attackMetrics = metrics.filter((metric) => metric.category.toUpperCase() === 'ATTACK');
    expect(attackMetrics).toHaveLength(10);
    await expect(cards).toHaveCount(10);
    const searchMetric = attackMetrics.find(
      (candidate) =>
        attackMetrics.filter((metric) =>
          metric.metric.toLowerCase().includes(candidate.metric.toLowerCase()),
        ).length === 1,
    )!;
    expect(searchMetric).toBeTruthy();
    await page.getByTestId('metrics-search').fill(searchMetric.metric);
    await expect(cards).toHaveCount(1);
    await expectLockedScores(cards.first(), searchMetric);

    await page.setViewportSize({ width: 360, height: 780 });
    await cards.first().scrollIntoViewIfNeeded();
    await expectNoOverflow(page, 'phone metric score dials');
    await testInfo.attach('metrics-lab-phone', {
      body: await page.screenshot({ animations: 'allow', fullPage: true }),
      contentType: 'image/png',
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('metrics-search').fill('');
    await page.getByTestId('metrics-category-filter').selectOption('ALL');
    await expect(cards).toHaveCount(100);
    const reducedMetric = metrics.find((metric) => metric.index === 100)!;
    expect(reducedMetric).toBeTruthy();
    await page.getByTestId(`lab-cell-${reducedMetric.index}`).click();
    const reducedCard = page.getByTestId(`metric-${reducedMetric.index}`);
    await expect(reducedCard).toHaveClass(/is-focused/);
    await expectLockedScores(reducedCard, reducedMetric);
    await expect
      .poll(() =>
        lab.evaluate(
          (element) =>
            element.getAnimations({ subtree: true }).filter((animation) => {
              const duration = Number(animation.effect?.getTiming().duration ?? 0);
              return animation.playState === 'running' && duration > 20;
            }).length,
        ),
      )
      .toBe(0);
    await expectNoOverflow(page, 'phone 100-metric overview with reduced motion');
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);
  } finally {
    await closeDirectors(directors);
  }
});
