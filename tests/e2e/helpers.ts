import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const SERVER_URL = 'http://127.0.0.1:4000';
export const SESSION_KEY = 'gavel-xi:session';
const requireFromServer = createRequire(`${process.cwd()}/apps/server/package.json`);

type SocketAck<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

interface TestSocket {
  timeout(milliseconds: number): TestSocket;
  emit(
    event: string,
    payload: unknown,
    callback: (error: Error | null, ack?: unknown) => void,
  ): void;
  disconnect(): void;
}

export interface Director {
  context: BrowserContext;
  page: Page;
  name: string;
  runtimeErrors: string[];
}

interface DebugMember {
  id: string;
  name: string;
  isSpectator: boolean;
  isReady: boolean;
  budgetEUR: number;
}

export interface DebugRoomState {
  code: string;
  phase: string;
  auctionSequence: number;
  resolvedCycles: number;
  totalCycles: number;
  settings: { budgetEUR: number };
  members: DebugMember[];
  squads: Array<{ memberId: string; cycleId: string }>;
  currentLot: null | {
    sequence: number;
    currentBidEUR: number | null;
    currentLeaderId: string | null;
    eligibleMemberIds: string[];
    passedMemberIds: string[];
  };
  evaluation: null | {
    metrics: Array<{ index: number; scores: Record<string, number> }>;
    teams: Array<{ memberId: string; rank: number }>;
    analystReport?: { source: 'engine' | 'groq'; winnerId: string };
  };
  replay: Array<{ type: string }>;
}

export function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

export async function newDirector(
  browser: Browser,
  name: string,
  options: BrowserContextOptions = {},
): Promise<Director> {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  return { context, page, name, runtimeErrors: observeRuntimeErrors(page) };
}

export async function closeDirectors(directors: Director[]): Promise<void> {
  await Promise.all(directors.map(({ context }) => context.close().catch(() => undefined)));
}

export async function openLanding(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('landing-screen')).toBeVisible();
  await expect.poll(async () => (await page.request.get(`${SERVER_URL}/health`)).ok()).toBe(true);
}

export async function createRoom(page: Page, name: string): Promise<string> {
  await openLanding(page);
  await page.getByTestId('create-room-open').click();
  await page.getByTestId('create-name-input').fill(name);
  await page.getByTestId('create-room-submit').click();
  await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('my-name')).toHaveText(name);
  const roomCode = (await page.getByTestId('lobby-room-code').innerText()).trim();
  expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  return roomCode;
}

export async function joinRoom(page: Page, roomCode: string, name: string): Promise<void> {
  await page.goto(`/?room=${roomCode}`);
  await expect(page.getByTestId('landing-screen')).toBeVisible();
  await expect(page.getByTestId('join-room-code-input')).toHaveValue(roomCode);
  await page.getByTestId('join-name-input').fill(name);
  await page.getByTestId('join-room-submit').click();
  await expect(page.getByTestId('my-name')).toHaveText(name, { timeout: 15_000 });
}

export async function debugRoom(page: Page, roomCode: string): Promise<DebugRoomState> {
  const stored = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
  expect(stored, 'host session should exist before reading debug state').not.toBeNull();
  const sessionToken = (JSON.parse(stored!) as { sessionToken: string }).sessionToken;
  const response = await page.request.get(`${SERVER_URL}/debug/rooms/${roomCode}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  expect(response.ok(), `debug room ${roomCode} should be readable`).toBe(true);
  const payload = (await response.json()) as { room: DebugRoomState };
  return payload.room;
}

export async function waitForPhase(
  page: Page,
  roomCode: string,
  phases: string[],
  timeout = 20_000,
): Promise<DebugRoomState> {
  let latest: DebugRoomState | null = null;
  await expect
    .poll(
      async () => {
        latest = await debugRoom(page, roomCode);
        return phases.includes(latest.phase);
      },
      { timeout, message: `room ${roomCode} should enter ${phases.join(' or ')}` },
    )
    .toBe(true);
  return latest!;
}

export async function setLargeBudget(host: Page, roomCode: string): Promise<void> {
  const customBudget = host.getByTestId('settings-custom-budget');
  if (!(await customBudget.isVisible())) {
    await host.getByTestId('settings-toggle').click();
    await expect(customBudget).toBeVisible();
  }
  await customBudget.fill('5000');
  // The field commits on blur as well as Enter. Blurring exactly once prevents
  // a later click from submitting the same settings mutation mid-action.
  await customBudget.blur();
  await expect
    .poll(async () => (await debugRoom(host, roomCode)).settings.budgetEUR)
    .toBe(5_000_000_000);
  await expect(host.getByTestId('ready-toggle')).toBeEnabled();
}

async function emitSocketAck<T>(
  socket: TestSocket,
  event: string,
  payload: unknown,
): Promise<SocketAck<T>> {
  return new Promise((resolve, reject) => {
    socket.timeout(12_000).emit(event, payload, (error, ack) => {
      if (error) reject(error);
      else resolve(ack as SocketAck<T>);
    });
  });
}

async function emitAsDirector<T>(
  director: Director,
  event: string,
  payload: unknown,
): Promise<SocketAck<T>> {
  const stored = await director.page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
  expect(stored, `${director.name} should retain an authenticated room session`).not.toBeNull();
  const sessionToken = (JSON.parse(stored!) as { sessionToken: string }).sessionToken;
  const { io } = requireFromServer('socket.io-client') as {
    io: (url: string, options: Record<string, unknown>) => TestSocket;
  };
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  try {
    const resumed = await emitSocketAck(socket, 'room:resume', { sessionToken });
    expect(resumed.ok, resumed.error?.message).toBe(true);
    return await emitSocketAck<T>(socket, event, payload);
  } finally {
    socket.disconnect();
  }
}

/**
 * Applies E2E-only settings through a separate host-authenticated socket.
 * The browser start helper intentionally submits only timer values, so testing
 * a full game at a generous budget must not rely on that partial update keeping
 * unrelated settings (a regression this suite caught in the persistence seam).
 */
export async function startWithE2ESettings(
  host: Page,
  roomCode: string,
  budgetMode: 'STRICT' | 'CHAOS' = 'CHAOS',
): Promise<void> {
  const stored = await host.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
  expect(stored).not.toBeNull();
  const sessionToken = (JSON.parse(stored!) as { sessionToken: string }).sessionToken;
  const { io } = requireFromServer('socket.io-client') as {
    io: (url: string, options: Record<string, unknown>) => TestSocket;
  };
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  try {
    const resumed = await emitSocketAck(socket, 'room:resume', { sessionToken });
    expect(resumed.ok, resumed.error?.message).toBe(true);
    const updated = await emitSocketAck(socket, 'room:settings', {
      roomCode,
      settings: {
        formation: '4-2-1-3',
        budgetEUR: 5_000_000_000,
        bidIncrementEUR: 1_000_000,
        revealSeconds: 0,
        auctionTimerSeconds: 5,
        antiSnipeSeconds: 0,
        soundEnabled: true,
        budgetMode,
        formLookback: 'CURRENT_SEASON',
      },
    });
    expect(updated.ok, updated.error?.message).toBe(true);
    await expect
      .poll(async () => (await debugRoom(host, roomCode)).settings.budgetEUR)
      .toBe(5_000_000_000);
    const started = await emitSocketAck(socket, 'game:start', { roomCode });
    expect(started.ok, started.error?.message).toBe(true);
  } finally {
    socket.disconnect();
  }
}

export async function readyAndStart(
  host: Director,
  guests: Director[],
  roomCode: string,
  options: { preserveLargeBudget?: boolean; budgetMode?: 'STRICT' | 'CHAOS' } = {},
): Promise<void> {
  // Ready mutations broadcast complete room snapshots. Sending them one at a
  // time avoids a deliberately stale UI snapshot masking a successful click.
  for (const director of [...guests, host]) {
    await director.page.getByTestId('ready-toggle').click();
    await expect
      .poll(
        async () =>
          (await debugRoom(host.page, roomCode)).members.find(({ name }) => name === director.name)
            ?.isReady ?? false,
      )
      .toBe(true);
    await expect(director.page.getByTestId('ready-toggle')).toContainText('YOU ARE READY');
  }
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  if (options.preserveLargeBudget)
    await startWithE2ESettings(host.page, roomCode, options.budgetMode);
  else await host.page.getByTestId('start-game').click();
  await waitForPhase(host.page, roomCode, ['BIDDING'], 30_000);
  await Promise.all(
    [host, ...guests].map(({ page }) =>
      expect(page.getByTestId('auction-screen')).toBeVisible({ timeout: 15_000 }),
    ),
  );
}

async function enabled(locator: ReturnType<Page['getByTestId']>): Promise<boolean> {
  return (await locator.count()) > 0 && locator.isVisible() && locator.isEnabled();
}

async function observeRoom(
  page: Page,
  roomCode: string,
  predicate: (room: DebugRoomState) => boolean,
  timeout = 1_000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  do {
    if (predicate(await debugRoom(page, roomCode))) return true;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return false;
}

function millionsFromQuickBid(label: string): number {
  const match = label.match(/[€£$]([\d,]+)M/i);
  if (!match?.[1]) throw new Error(`Cannot read a minimum bid from ${JSON.stringify(label)}`);
  return Number(match[1].replaceAll(',', '')) * 1_000_000;
}

export async function settleOpenLot(
  directors: Director[],
  roomCode: string,
  preferredWinner = 0,
  options: { allowSocketFallback?: boolean } = {},
): Promise<{ bidder: Director; sequence: number; resolvedPhase: string }> {
  const state = await waitForPhase(directors[0]!.page, roomCode, ['BIDDING']);
  const sequence = state.auctionSequence;
  await Promise.all(
    directors.map(({ page }) => expect(page.getByTestId('auction-screen')).toBeVisible()),
  );

  const visibleEligible = async (): Promise<Director[]> => {
    const candidates: Director[] = [];
    for (const director of directors) {
      if (await enabled(director.page.getByTestId('bid-quick-1'))) candidates.push(director);
    }
    return candidates;
  };
  await expect
    .poll(async () => (await visibleEligible()).length, {
      timeout: 4_000,
      message: `lot ${sequence} needs at least one legal bidder`,
    })
    .toBeGreaterThan(0);
  const eligible = await visibleEligible();
  const preferred = directors[preferredWinner % directors.length];
  const bidder = (preferred && eligible.includes(preferred) ? preferred : eligible[0])!;
  const bidderId = state.members.find(({ name }) => name === bidder.name)?.id;
  expect(bidderId, `debug state should contain bidder ${bidder.name}`).toBeTruthy();

  const minimumBid = millionsFromQuickBid(await bidder.page.getByTestId('bid-quick-1').innerText());
  await bidder.page
    .getByTestId('bid-quick-1')
    .click({ force: true, timeout: 3_000 })
    .catch(() => undefined);
  if (
    !(await observeRoom(
      directors[0]!.page,
      roomCode,
      (room) => room.currentLot?.currentLeaderId !== null,
    ))
  ) {
    if (options.allowSocketFallback === false) {
      throw new Error(`UI bid from ${bidder.name} was not accepted for lot ${sequence}`);
    }
    const ack = await emitAsDirector<{ room: DebugRoomState }>(bidder, 'auction:bid', {
      roomCode,
      amountEUR: minimumBid,
      auctionSequence: sequence,
      idempotencyKey: randomUUID(),
    });
    // A delayed browser mutation can win the race with the fallback. The
    // duplicate is then correctly rejected, so verify the authoritative room.
    if (!ack.ok) {
      expect(
        await observeRoom(
          directors[0]!.page,
          roomCode,
          (room) => room.currentLot?.currentLeaderId !== null,
          2_000,
        ),
        ack.error?.message,
      ).toBe(true);
    }
  }
  await expect
    .poll(
      async () =>
        (await debugRoom(directors[0]!.page, roomCode)).currentLot?.currentLeaderId ?? null,
    )
    .not.toBeNull();

  for (const director of eligible.filter((entry) => entry !== bidder)) {
    const passerId = state.members.find(({ name }) => name === director.name)?.id;
    expect(passerId, `debug state should contain passer ${director.name}`).toBeTruthy();
    await director.page
      .getByTestId('pass-button')
      .click({ force: true, timeout: 3_000 })
      .catch(() => undefined);
    if (
      !(await observeRoom(
        directors[0]!.page,
        roomCode,
        (room) =>
          room.phase !== 'BIDDING' || Boolean(room.currentLot?.passedMemberIds.includes(passerId!)),
      ))
    ) {
      if (options.allowSocketFallback === false) {
        throw new Error(`UI pass from ${director.name} was not accepted for lot ${sequence}`);
      }
      const ack = await emitAsDirector<{ room: DebugRoomState }>(director, 'auction:pass', {
        roomCode,
        auctionSequence: sequence,
      });
      if (!ack.ok) {
        expect(
          await observeRoom(
            directors[0]!.page,
            roomCode,
            (room) =>
              room.phase !== 'BIDDING' ||
              Boolean(room.currentLot?.passedMemberIds.includes(passerId!)),
            2_000,
          ),
          ack.error?.message,
        ).toBe(true);
      }
    }
  }

  const resolved = await waitForPhase(
    directors[0]!.page,
    roomCode,
    ['SOLD', 'FORCED_ASSIGNMENT', 'CHECKPOINT', 'RESULTS'],
    10_000,
  );
  return { bidder, sequence, resolvedPhase: resolved.phase };
}

export async function continueCheckpoint(
  host: Director,
  directors: Director[],
  roomCode: string,
): Promise<void> {
  await Promise.all(
    directors.map(({ page }) =>
      expect(page.getByTestId('checkpoint-screen')).toBeVisible({ timeout: 10_000 }),
    ),
  );
  await expect(host.page.getByTestId('checkpoint-cards')).toBeVisible();
  await host.page.getByTestId('checkpoint-broadcast').click();
  await waitForPhase(host.page, roomCode, ['BIDDING', 'RESULTS'], 15_000);
}

export async function playToResults(
  host: Director,
  directors: Director[],
  roomCode: string,
  options: {
    onCheckpoint?: (number: number) => Promise<void> | void;
    maxLots?: number;
  } = {},
): Promise<{ lots: number; checkpoints: number }> {
  let lots = 0;
  let checkpoints = 0;
  const maxLots = options.maxLots ?? 80;

  while (lots < maxLots) {
    const state = await waitForPhase(
      host.page,
      roomCode,
      ['BIDDING', 'CHECKPOINT', 'RESULTS'],
      20_000,
    );
    if (state.phase === 'RESULTS') return { lots, checkpoints };
    if (state.phase === 'CHECKPOINT') {
      checkpoints += 1;
      await options.onCheckpoint?.(checkpoints);
      await continueCheckpoint(host, directors, roomCode);
      continue;
    }
    await settleOpenLot(directors, roomCode, lots);
    lots += 1;
  }
  throw new Error(`Room ${roomCode} did not finish within ${maxLots} resolved lots`);
}

export async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const profile = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  const screenshotsDirectory = join(process.cwd(), 'docs', 'screenshots');
  await mkdir(screenshotsDirectory, { recursive: true });
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop),
      ),
    )
    .toBe(0);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const screenshotPath = join(screenshotsDirectory, `${profile}-${name}.png`);
  const screenshotOptions = {
    animations: 'disabled' as const,
    caret: 'hide' as const,
    path: screenshotPath,
  };
  const body = await page.screenshot(screenshotOptions);
  // PNG IHDR stores the physical width at byte offset 16. Guard against
  // screenshot-time layout expansion, which can otherwise produce a very wide
  // blank canvas even when the live mobile document itself has no overflow.
  expect(body.readUInt32BE(16), `${profile}-${name}.png should match its viewport width`).toBe(
    Math.round(viewport!.width * devicePixelRatio),
  );
  await testInfo.attach(`${testInfo.project.name}-${name}`, { body, contentType: 'image/png' });
}
