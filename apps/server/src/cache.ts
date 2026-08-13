import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
  increment(key: string, windowMs: number): Promise<number>;
  health(): Promise<'ok' | 'degraded'>;
  connect?(): Promise<void>;
  close?(): Promise<void>;
}

interface CachedValue {
  value: unknown;
  expiresAt: number | null;
}

/** Serializes mutations per room exactly like a distributed Redis mutex would. */
export class InMemoryCache implements CacheAdapter {
  readonly #values = new Map<string, CachedValue>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #rates = new Map<string, { count: number; resetAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const cached = this.#values.get(key);
    if (cached === undefined) return null;
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      this.#values.delete(key);
      return null;
    }
    return structuredClone(cached.value) as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.#values.set(key, {
      value: structuredClone(value),
      expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
    });
  }

  async delete(key: string): Promise<void> {
    this.#values.delete(key);
  }

  async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.#tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const existing = this.#rates.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.#rates.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async health(): Promise<'ok'> {
    return 'ok';
  }

  async close(): Promise<void> {
    // The process-local adapter owns no external resources.
  }
}

/** Redis implementations provide atomic locks/increments and pub/sub invalidation. */
export interface RedisCache extends CacheAdapter {
  publish(channel: string, payload: unknown): Promise<void>;
}

/** Narrow structural surface for deterministic tests without a Redis daemon. */
export interface RedisClientLike {
  readonly status?: string;
  connect?(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
  publish(channel: string, payload: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  disconnect(reconnect?: boolean): void;
}

export interface RedisCacheAdapterOptions {
  url?: string;
  client?: RedisClientLike;
  /** Defaults to true only when the adapter creates the client. */
  ownsClient?: boolean;
  lockTtlMs?: number;
  lockAcquireTimeoutMs?: number;
  lockRetryMs?: number;
}

const RATE_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

function positiveMilliseconds(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
  return Math.max(1, Math.ceil(value));
}

function serialize(value: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, entry: unknown) => {
      if (entry === undefined) throw new TypeError(`${label} contains undefined`);
      if (typeof entry === 'bigint') throw new TypeError(`${label} contains bigint`);
      if (typeof entry === 'function' || typeof entry === 'symbol') {
        throw new TypeError(`${label} contains ${typeof entry}`);
      }
      if (typeof entry === 'number' && !Number.isFinite(entry)) {
        throw new TypeError(`${label} contains a non-finite number`);
      }
      return entry;
    });
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(label)) throw error;
    throw new TypeError(`${label} could not be serialized`, { cause: error });
  }
  if (serialized === undefined) throw new TypeError(`${label} is undefined`);
  return serialized;
}

function parse<T>(serialized: string, label: string): T {
  try {
    return JSON.parse(serialized) as T;
  } catch (error) {
    throw new TypeError(`${label} does not contain valid JSON`, { cause: error });
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericResult(value: unknown, operation: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Redis ${operation} returned an invalid integer result`);
  }
  return result;
}

/**
 * Production Redis adapter. Locks use unique ownership tokens, compare-and-delete
 * release, and a token-checked heartbeat so a slow auction mutation cannot release
 * (or accidentally overlap) another process's lock.
 */
export class RedisCacheAdapter implements RedisCache {
  readonly #client: RedisClientLike;
  readonly #ownsClient: boolean;
  readonly #lockTtlMs: number;
  readonly #lockAcquireTimeoutMs: number;
  readonly #lockRetryMs: number;
  #connected = false;
  #closed = false;

  constructor(options: RedisCacheAdapterOptions = {}) {
    this.#client =
      options.client ??
      (new Redis(options.url ?? process.env.REDIS_URL ?? '', {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }) as unknown as RedisClientLike);
    this.#ownsClient = options.ownsClient ?? options.client === undefined;
    this.#lockTtlMs = positiveMilliseconds(options.lockTtlMs ?? 10_000, 'lockTtlMs');
    this.#lockAcquireTimeoutMs = positiveMilliseconds(
      options.lockAcquireTimeoutMs ?? 5_000,
      'lockAcquireTimeoutMs',
    );
    this.#lockRetryMs = positiveMilliseconds(options.lockRetryMs ?? 25, 'lockRetryMs');
  }

  async connect(): Promise<void> {
    if (this.#closed) throw new Error('REDIS_CACHE_CLOSED');
    if (this.#connected) return;
    if (this.#client.connect !== undefined && this.#client.status !== 'ready') {
      await this.#client.connect();
    }
    const response = await this.#client.ping();
    if (response.toUpperCase() !== 'PONG')
      throw new Error('Redis health check did not return PONG');
    this.#connected = true;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.#client.get(key);
    return value === null ? null : parse<T>(value, `Redis key ${key}`);
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = serialize(value, `Redis key ${key}`);
    if (ttlMs === undefined) {
      await this.#client.set(key, serialized);
      return;
    }
    if (!Number.isFinite(ttlMs)) throw new RangeError('ttlMs must be finite');
    if (ttlMs <= 0) {
      await this.#client.del(key);
      return;
    }
    await this.#client.set(key, serialized, 'PX', Math.ceil(ttlMs));
  }

  async delete(key: string): Promise<void> {
    await this.#client.del(key);
  }

  async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const lockKey = `__gavel_lock__:${key}`;
    const token = randomUUID();
    const deadline = Date.now() + this.#lockAcquireTimeoutMs;
    let acquired = false;
    do {
      const result = await this.#client.set(lockKey, token, 'PX', this.#lockTtlMs, 'NX');
      if (result === 'OK') {
        acquired = true;
        break;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(this.#lockRetryMs, remaining));
    } while (Date.now() <= deadline);

    if (!acquired) throw new Error(`Timed out acquiring Redis lock for ${key}`);

    let lockFailure: Error | null = null;
    let renewal = Promise.resolve();
    const refresh = (): void => {
      renewal = renewal.then(async () => {
        if (lockFailure !== null) return;
        try {
          const result = numericResult(
            await this.#client.eval(RENEW_LOCK_SCRIPT, 1, lockKey, token, this.#lockTtlMs),
            'lock renewal',
          );
          if (result !== 1) lockFailure = new Error(`Redis lock ownership was lost for ${key}`);
        } catch (error) {
          lockFailure = new Error(`Redis lock renewal failed for ${key}`, { cause: error });
        }
      });
    };
    const heartbeat = setInterval(refresh, Math.max(1, Math.floor(this.#lockTtlMs / 3)));
    heartbeat.unref();

    let result: T | undefined;
    let workFailed = false;
    let workFailure: unknown;
    try {
      result = await work();
    } catch (error) {
      workFailed = true;
      workFailure = error;
    }

    clearInterval(heartbeat);
    await renewal;
    let releaseFailure: unknown;
    try {
      const released = numericResult(
        await this.#client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token),
        'lock release',
      );
      if (released !== 1 && lockFailure === null) {
        lockFailure = new Error(`Redis lock ownership was lost for ${key}`);
      }
    } catch (error) {
      releaseFailure = error;
    }

    if (workFailed) throw workFailure;
    if (lockFailure !== null) throw lockFailure;
    if (releaseFailure !== undefined) {
      throw new Error(`Redis lock release failed for ${key}`, { cause: releaseFailure });
    }
    return result as T;
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const window = positiveMilliseconds(windowMs, 'windowMs');
    return numericResult(
      await this.#client.eval(RATE_INCREMENT_SCRIPT, 1, key, window),
      'rate increment',
    );
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.#client.publish(channel, serialize(payload, `Redis channel ${channel}`));
  }

  async health(): Promise<'ok' | 'degraded'> {
    if (this.#closed) return 'degraded';
    try {
      return (await this.#client.ping()).toUpperCase() === 'PONG' ? 'ok' : 'degraded';
    } catch {
      return 'degraded';
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#connected = false;
    if (!this.#ownsClient) return;
    try {
      await this.#client.quit();
    } catch {
      this.#client.disconnect(false);
    }
  }
}
