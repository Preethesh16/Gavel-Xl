import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

function optionalConnectionUrl(protocols: readonly string[]) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z
      .string()
      .url()
      .refine((value) => protocols.includes(new URL(value).protocol), {
        message: `Expected a ${protocols.join(' or ')} URL`,
      })
      .optional(),
  );
}

const optionalNonemptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const optionalSessionSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(32).optional(),
);

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    CLIENT_ORIGIN: z.string().optional(),
    SESSION_SECRET: optionalSessionSecret,
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .default(60 * 60 * 24 * 7),
    HOST_TRANSFER_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
    PRESENCE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
    DATABASE_URL: optionalConnectionUrl(['postgresql:', 'postgres:']),
    REDIS_URL: optionalConnectionUrl(['redis:', 'rediss:']),
    FOOTBALL_DATA_PROVIDER: z.enum(['auto', 'demo', 'sportmonks', 'api-football']).default('auto'),
    SPORTMONKS_API_TOKEN: optionalNonemptyString,
    API_FOOTBALL_KEY: optionalNonemptyString,
    API_FOOTBALL_LEAGUE_IDS: z.string().default('39,140,135,78,61,94,88,307,203'),
    API_FOOTBALL_SEASON: z.coerce.number().int().min(2000).max(2200).optional(),
    VALUATION_PROVIDER: z.enum(['game-estimate']).default('game-estimate'),
    VALUATION_API_KEY: optionalNonemptyString,
    GROQ_API_KEY: optionalNonemptyString,
    GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
    GROQ_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(5_000),
    DEBUG_ROUTES: z.preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean().optional(),
    ),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.SESSION_SECRET === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Production requires an explicit unique SESSION_SECRET',
      });
    }
    if (
      config.FOOTBALL_DATA_PROVIDER === 'sportmonks' &&
      config.SPORTMONKS_API_TOKEN === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SPORTMONKS_API_TOKEN'],
        message: 'The sportmonks provider requires SPORTMONKS_API_TOKEN',
      });
    }
    if (config.FOOTBALL_DATA_PROVIDER === 'api-football' && config.API_FOOTBALL_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['API_FOOTBALL_KEY'],
        message: 'The api-football provider requires API_FOOTBALL_KEY',
      });
    }
    if (config.NODE_ENV === 'production' && config.FOOTBALL_DATA_PROVIDER === 'demo') {
      context.addIssue({
        code: 'custom',
        path: ['FOOTBALL_DATA_PROVIDER'],
        message: 'The synthetic demo football provider is disabled in production',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.FOOTBALL_DATA_PROVIDER === 'auto' &&
      config.SPORTMONKS_API_TOKEN === undefined &&
      config.API_FOOTBALL_KEY === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['FOOTBALL_DATA_PROVIDER'],
        message: 'Production auto mode requires at least one live football provider credential',
      });
    }
  });

export type ServerConfig = z.infer<typeof configSchema>;

/** Loads the documented monorepo-root .env without overriding exported values. */
export function loadRootEnvironment(
  path = fileURLToPath(new URL('../../../.env', import.meta.url)),
): void {
  const result = loadDotenv({ path, override: false, quiet: true });
  if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw result.error;
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  return configSchema.parse(environment);
}

export function parseConfig(input: unknown): ServerConfig {
  return configSchema.parse(input);
}
