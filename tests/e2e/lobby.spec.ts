import { expect, test } from '@playwright/test';
import {
  closeDirectors,
  createRoom,
  joinRoom,
  newDirector,
  readyAndStart,
  setLargeBudget,
} from './helpers';

test('desktop directors create, join, ready and start with host authority enforced', async ({
  browser,
}) => {
  const host = await newDirector(browser, 'Preetesh');
  const guest = await newDirector(browser, 'Abhinav');
  const directors = [host, guest];

  try {
    const roomCode = await createRoom(host.page, host.name);
    await expect(host.page.getByTestId('start-game')).toBeDisabled();
    await expect(host.page.getByTestId('waiting-for-player')).toBeVisible();
    await expect(host.page.getByTestId('copy-invite')).toHaveAttribute(
      'aria-label',
      `Copy room code ${roomCode} and invite link`,
    );
    await host.page.getByTestId('copy-invite').click();
    await expect(host.page.getByTestId('notice-toast')).toContainText(
      new RegExp(`Room ${roomCode} copied|Room code: ${roomCode}`),
    );

    await joinRoom(guest.page, roomCode, guest.name);
    await Promise.all(
      directors.map(({ page }) => expect(page.getByTestId('participant-count')).toContainText('2')),
    );
    for (const { page } of directors) {
      await expect(page.getByTestId('participant-list')).toContainText('Preetesh');
      await expect(page.getByTestId('participant-list')).toContainText('Abhinav');
      await expect(page.getByTestId('lobby-room-code')).toHaveText(roomCode);
    }

    await expect(guest.page.getByTestId('settings-formation')).toBeDisabled();
    await expect(guest.page.getByTestId('settings-mode')).toBeDisabled();
    await setLargeBudget(host.page, roomCode);
    await readyAndStart(host, [guest], roomCode);

    await Promise.all(
      directors.map(async ({ page, name }) => {
        await expect(page.getByTestId('room-code')).toHaveText(roomCode);
        await expect(page.getByTestId('my-name')).toContainText(name);
        await expect(page.getByTestId('connection-status')).toContainText('LIVE');
        await expect(page.getByTestId('current-formation')).toHaveText('4-2-1-3');
      }),
    );
    expect(directors.flatMap(({ runtimeErrors }) => runtimeErrors)).toEqual([]);

    await expect(host.page.getByTestId('back-to-home')).toBeVisible();
    await host.page.getByTestId('back-to-home').click();
    await expect(host.page.getByTestId('landing-screen')).toBeVisible();
    await expect(host.page).toHaveURL(/\/$/);
  } finally {
    await closeDirectors(directors);
  }
});

test('landing rejects malformed entry details before contacting the room', async ({ browser }) => {
  const director = await newDirector(browser, 'Edge');
  try {
    await director.page.goto('/');
    await expect(director.page.getByTestId('landing-screen')).toBeVisible();
    await director.page.getByTestId('join-room-open').click();
    await director.page.getByTestId('join-room-code-input').fill('IO01');
    await director.page.getByTestId('join-name-input').fill('<');
    await director.page.getByTestId('join-room-submit').click();
    await expect(director.page.locator('.form-error')).toContainText(
      'valid six-character room code',
    );
    await expect(director.page.getByTestId('landing-screen')).toBeVisible();
    expect(director.runtimeErrors).toEqual([]);
  } finally {
    await director.context.close();
  }
});

test('fresh room creation waits for a dropped connection instead of showing a reconnecting-room error', async ({
  browser,
}) => {
  const director = await newDirector(browser, 'ColdStart');
  try {
    await director.page.goto('/');
    await expect(director.page.getByTestId('landing-screen')).toBeVisible();
    await director.context.setOffline(true);
    await director.page.waitForTimeout(500);
    await director.page.getByTestId('create-room-open').click();
    await director.page.getByTestId('create-name-input').fill(director.name);
    await director.page.getByTestId('create-room-submit').click();
    await expect(director.page.getByTestId('create-room-submit')).toBeDisabled();
    await expect(director.page.getByTestId('error-toast')).toHaveCount(0);

    await director.context.setOffline(false);
    await expect(director.page.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });
    await expect(director.page.getByTestId('error-toast')).toHaveCount(0);
    expect(
      director.runtimeErrors.filter((message) => !message.includes('ERR_INTERNET_DISCONNECTED')),
    ).toEqual([]);
  } finally {
    await director.context.setOffline(false).catch(() => undefined);
    await director.context.close();
  }
});

test('room actions wait for player identity to resume after a disconnect', async ({ browser }) => {
  const host = await newDirector(browser, 'ComebackHost');
  try {
    const roomCode = await createRoom(host.page, host.name);
    await host.context.setOffline(true);
    await expect(host.page.getByTestId('connection-status')).not.toContainText('LIVE');

    const formationChange = host.page.getByTestId('settings-formation').selectOption('4-4-2');
    await host.page.waitForTimeout(250);
    await host.context.setOffline(false);
    await formationChange;

    await expect(host.page.getByTestId('connection-status')).toContainText('LIVE', {
      timeout: 25_000,
    });
    await expect(host.page.getByTestId('settings-formation')).toHaveValue('4-4-2');
    await expect(host.page.getByTestId('error-toast')).toHaveCount(0);
    await expect(host.page.getByTestId('lobby-room-code')).toHaveText(roomCode);
  } finally {
    await host.context.setOffline(false).catch(() => undefined);
    await host.context.close();
  }
});

test('a malformed saved session does not block a fresh room on the same connection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'gavel-xi:session',
      JSON.stringify({ sessionToken: 'expired-token', memberId: 'old-member', roomCode: 'ABCDEF' }),
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('landing-screen')).toBeVisible();
  await page.getByTestId('create-room-open').click();
  await page.getByTestId('create-name-input').fill('FreshDirector');
  await page.getByTestId('create-room-submit').click();
  await expect(page.getByTestId('lobby-screen')).toBeVisible();
});

test('formation preview responds to keyboard and pointer selection', async ({ page }) => {
  await page.goto('/');
  const shape = page.getByRole('button', { name: '3-5-2', exact: true });
  await shape.click();
  await expect(shape).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('3-5-2 formation preview')).toBeVisible();
  const alternate = page.getByRole('button', { name: '4-4-2', exact: true });
  await alternate.focus();
  await page.keyboard.press('Enter');
  await expect(alternate).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tactics-player')).toHaveCount(11);
});

test('every budget supports all formations and the custom amount stays synchronized', async ({
  browser,
}) => {
  const host = await newDirector(browser, 'TacticsHost');
  const guest = await newDirector(browser, 'TacticsGuest');
  try {
    const code = await createRoom(host.page, host.name);
    await joinRoom(guest.page, code, guest.name);
    for (const budget of [500, 600, 750, 1000]) {
      await host.page.getByTestId(`settings-budget-${budget}`).click();
      await expect(host.page.getByTestId('settings-custom-budget')).toHaveValue(String(budget));
      for (const formation of [
        '4-2-1-3',
        '4-3-3',
        '4-2-3-1',
        '4-4-2',
        '3-4-2-1',
        '3-5-2',
        '5-2-1-2',
      ]) {
        await host.page.getByTestId('settings-formation').selectOption(formation);
        await expect(guest.page.getByTestId('settings-formation')).toHaveValue(formation);
        await expect(host.page.getByLabel(`${formation} starting eleven`)).toBeVisible();
        await expect(host.page.locator('.lobby-tactics .tactics-player')).toHaveCount(11);
        await expect(host.page.getByTestId('settings-custom-budget')).toHaveValue(String(budget));
      }
    }
    await host.page.getByTestId('settings-custom-budget').focus();
    await host.page.getByTestId('settings-formation').selectOption('4-3-3');
    await expect(guest.page.getByTestId('settings-custom-budget')).toHaveValue('1000');
    expect([...host.runtimeErrors, ...guest.runtimeErrors]).toEqual([]);
  } finally {
    await closeDirectors([host, guest]);
  }
});
