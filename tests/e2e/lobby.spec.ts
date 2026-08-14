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
