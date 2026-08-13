import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const claimsSchema = z.object({
  roomCode: z.string(),
  memberId: z.string().uuid(),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  nonce: z.string().min(8),
});

export type SessionClaims = z.infer<typeof claimsSchema>;

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export class SessionTokenService {
  readonly #secret: string;
  readonly #ttlSeconds: number;
  readonly #now: () => number;

  constructor(secret: string, ttlSeconds: number, now: () => number = Date.now) {
    if (Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must be at least 32 bytes');
    this.#secret = secret;
    this.#ttlSeconds = ttlSeconds;
    this.#now = now;
  }

  issue(roomCode: string, memberId: string): string {
    const issuedAt = Math.floor(this.#now() / 1_000);
    const claims: SessionClaims = {
      roomCode,
      memberId,
      issuedAt,
      expiresAt: issuedAt + this.#ttlSeconds,
      nonce: randomBytes(12).toString('base64url'),
    };
    const payload = encode(JSON.stringify(claims));
    return `${payload}.${this.#sign(payload)}`;
  }

  verify(token: string): SessionClaims | null {
    const [payload, signature, extra] = token.split('.');
    if (payload === undefined || signature === undefined || extra !== undefined) return null;
    const expected = this.#sign(payload);
    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return null;
    }
    try {
      const claims = claimsSchema.parse(JSON.parse(decode(payload)));
      if (claims.expiresAt <= Math.floor(this.#now() / 1_000)) return null;
      return claims;
    } catch {
      return null;
    }
  }

  #sign(payload: string): string {
    return createHmac('sha256', this.#secret).update(payload).digest('base64url');
  }
}
