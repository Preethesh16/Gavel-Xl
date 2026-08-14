import { expect, test } from '@playwright/test';
import {
  attachScreenshot,
  createRoom,
  joinRoom,
  newDirector,
  observeRuntimeErrors,
  playToResults,
  readyAndStart,
  setLargeBudget,
  type Director,
} from './helpers';

async function expectNoHorizontalOverflow(page: Director['page'], screen: string): Promise<void> {
  const measurement = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          testId: element.dataset.testid,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(({ left, right, width }) => width > 0 && (left < -1 || right > viewportWidth + 1))
      .slice(0, 8);
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth,
      offenders,
    };
  });
  expect(
    measurement.documentWidth,
    `${screen} must not overflow ${measurement.viewportWidth}px; offenders: ${JSON.stringify(measurement.offenders)}`,
  ).toBeLessThanOrEqual(measurement.viewportWidth + 1);
}

test('landing, lobby, auction and results stay readable without browser errors', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const host: Director = {
    context: page.context(),
    page,
    name: 'Preetesh',
    runtimeErrors: observeRuntimeErrors(page),
  };
  const guest = await newDirector(browser, 'Abhinav', {
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
  });

  try {
    await page.goto('/');
    await expect(page.getByTestId('landing-screen')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'landing');
    await attachScreenshot(page, testInfo, 'landing');

    const roomCode = await createRoom(page, host.name);
    await joinRoom(guest.page, roomCode, guest.name);
    await expect(page.getByTestId('participant-list')).toContainText(guest.name);
    await expectNoHorizontalOverflow(page, 'lobby');
    await attachScreenshot(page, testInfo, 'lobby');

    await setLargeBudget(page, roomCode);
    await readyAndStart(host, [guest], roomCode, { preserveLargeBudget: true });
    await expect(page.getByTestId('player-card')).toBeVisible();
    const pause = page.getByTestId('auction-pause');
    await expect(pause).toHaveText('PAUSE AUCTION');
    await expectNoHorizontalOverflow(page, 'auction');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop),
          ),
        {
          message:
            'entering the auction should reset lobby scroll so the sticky header cannot mask it',
        },
      )
      .toBe(0);
    await attachScreenshot(page, testInfo, 'auction');

    await playToResults(host, [host, guest], roomCode);
    await expect(page.getByTestId('results-podium')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'results');
    await attachScreenshot(page, testInfo, 'results');

    const viewport = page.viewportSize();
    if (testInfo.project.name.includes('mobile')) {
      expect(viewport?.width).toBeLessThanOrEqual(600);
      expect(await page.evaluate(() => window.innerWidth)).toBe(viewport?.width);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        'content',
        /width=device-width/,
      );
      for (const locator of [
        page.getByTestId('results-screen'),
        page.getByTestId('results-podium'),
      ]) {
        const box = await locator.boundingBox();
        expect(box?.width ?? 0).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
      }
    }
    expect([...host.runtimeErrors, ...guest.runtimeErrors]).toEqual([]);
  } finally {
    await guest.context.close();
  }
});
