import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRootEnvironment, parseConfig } from '../src/config.js';
import { DevelopmentSnapshotProvider } from '../src/providers/index.js';
import { buildServer, configuredProviders, type GavelServer } from '../src/server.js';

const servers: GavelServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

function unsignedPayload(roomCode: string, memberId: string): string {
  const claims = {
    roomCode,
    memberId,
    issuedAt: 0,
    expiresAt: 4_102_444_800,
    nonce: 'known-nonce',
  };
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

function signedWithHistoricalDefault(roomCode: string, memberId: string): string {
  const payload = unsignedPayload(roomCode, memberId);
  const signature = createHmac('sha256', 'development-only-change-this-secret-now')
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

describe('runtime configuration honesty and session safety', () => {
  it('generates an unpredictable secret when omitted so the historical default cannot forge', async () => {
    const server = await buildServer({
      config: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: 0,
        FOOTBALL_DATA_PROVIDER: 'demo',
      },
    });
    servers.push(server);
    const url = await server.start({ host: '127.0.0.1', port: 0 });
    expect(server.config.SESSION_SECRET).toHaveLength(64);
    expect(server.config.SESSION_SECRET).not.toBe('development-only-change-this-secret-now');
    const forged = signedWithHistoricalDefault('ABC234', '00000000-0000-4000-8000-000000000001');
    expect(
      (
        await fetch(`${url}/debug/rooms/ABC234`, {
          headers: { authorization: `Bearer ${forged}` },
        })
      ).status,
    ).toBe(401);
  });

  it('requires an explicit production secret and configured provider credentials', () => {
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow();
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'a-production-secret-that-is-at-least-32-bytes',
        FOOTBALL_DATA_PROVIDER: 'sportmonks',
      }),
    ).toThrow(/SPORTMONKS_API_TOKEN/);
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'a-production-secret-that-is-at-least-32-bytes',
        FOOTBALL_DATA_PROVIDER: 'demo',
      }),
    ).toThrow(/synthetic demo/i);
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'a-production-secret-that-is-at-least-32-bytes',
        FOOTBALL_DATA_PROVIDER: 'auto',
      }),
    ).toThrow(/live football provider credential/i);
    expect(() => parseConfig({ VALUATION_PROVIDER: 'silently-unsupported' })).toThrow();
  });

  it('honors explicit provider selection and deterministic auto ordering', () => {
    const common = {
      SPORTMONKS_API_TOKEN: 'sportmonks-token',
      API_FOOTBALL_KEY: 'api-football-key',
    };
    const auto = configuredProviders(parseConfig({ ...common, FOOTBALL_DATA_PROVIDER: 'auto' }));
    expect(auto.map(({ name }) => name)).toEqual([
      'sportmonks',
      'api-football',
      'development-snapshot',
    ]);
    expect(
      configuredProviders(parseConfig({ ...common, FOOTBALL_DATA_PROVIDER: 'api-football' })).map(
        ({ name }) => name,
      ),
    ).toEqual(['api-football']);
    const demo = configuredProviders(parseConfig({ FOOTBALL_DATA_PROVIDER: 'demo' }));
    expect(demo).toHaveLength(1);
    expect(demo[0]).toBeInstanceOf(DevelopmentSnapshotProvider);
  });

  it('normalizes blank optional secrets instead of treating them as configured', () => {
    expect(
      parseConfig({
        SESSION_SECRET: '',
        SPORTMONKS_API_TOKEN: '',
        API_FOOTBALL_KEY: '   ',
        GROQ_API_KEY: '',
        VALUATION_API_KEY: '',
      }),
    ).toMatchObject({
      SESSION_SECRET: undefined,
      SPORTMONKS_API_TOKEN: undefined,
      API_FOOTBALL_KEY: undefined,
      GROQ_API_KEY: undefined,
      VALUATION_API_KEY: undefined,
    });
  });

  it('loads the root env file without overriding explicitly exported values', () => {
    const key = 'GAVEL_XI_ENV_LOADER_PROBE';
    const previous = process.env[key];
    delete process.env[key];
    try {
      loadRootEnvironment(new URL('./fixtures/root-env.fixture', import.meta.url).pathname);
      expect(process.env[key]).toBe('loaded-from-root-env');
      process.env[key] = 'explicitly-exported';
      loadRootEnvironment(new URL('./fixtures/root-env.fixture', import.meta.url).pathname);
      expect(process.env[key]).toBe('explicitly-exported');
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });
});
