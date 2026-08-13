import { createHash, randomUUID } from 'node:crypto';
import { FORMATION_NAMES, generateCandidatePool } from '@gavel-xi/game-engine';
import { roomSettingsSchema, type CandidateSnapshot } from '@gavel-xi/shared';
import type { CacheAdapter } from '../cache.js';
import type { FrozenSnapshot } from '../domain.js';
import type { SnapshotRepository } from '../persistence.js';
import type { FootballDataProvider, ValuationProvider } from './types.js';

export interface SnapshotServiceOptions {
  providers: FootballDataProvider[];
  valuationProvider: ValuationProvider;
  cache: CacheAdapter;
  snapshots: SnapshotRepository;
  freshForMs?: number;
  staleForMs?: number;
  now?: () => Date;
}

export class SnapshotUnavailableError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`No football-data snapshot is available (${failures.join('; ')})`);
    this.name = 'SnapshotUnavailableError';
  }
}

const SUPPORTED_PARTICIPANT_COUNTS = [2, 3, 4, 5, 6, 7, 8] as const;

/**
 * A non-empty provider response is not necessarily playable. Exercise the pure
 * pool generator against every supported room shape before freezing a snapshot,
 * so a structurally incomplete provider falls through to the next adapter.
 */
export function assertSnapshotPoolViable(
  candidates: CandidateSnapshot[],
  participantCounts: readonly number[] = SUPPORTED_PARTICIPANT_COUNTS,
): void {
  const createdAt = new Date(0).toISOString();
  for (const formation of FORMATION_NAMES) {
    const settings = roomSettingsSchema.parse({ formation });
    for (const participantCount of participantCounts) {
      try {
        generateCandidatePool({
          seed: `snapshot-viability:${formation}:${participantCount}`,
          settings,
          members: Array.from({ length: participantCount }, (_, index) => ({
            id: `snapshot-member-${index + 1}`,
            budgetEUR: settings.budgetEUR,
            joinedAt: index,
          })),
          snapshot: {
            id: 'snapshot-viability',
            provider: 'snapshot-viability',
            createdAt,
            sourceUpdatedAt: createdAt,
            candidates,
          },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown pool error';
        throw new Error(
          `snapshot cannot support ${participantCount} directors in ${formation}: ${reason}`,
          { cause: error },
        );
      }
    }
  }
}

/** Implements fresh cache → stale cache → alternate provider, then fails honestly. */
export class FrozenSnapshotService {
  readonly #providers: FootballDataProvider[];
  readonly #valuationProvider: ValuationProvider;
  readonly #cache: CacheAdapter;
  readonly #snapshots: SnapshotRepository;
  readonly #freshForMs: number;
  readonly #staleForMs: number;
  readonly #now: () => Date;

  constructor(options: SnapshotServiceOptions) {
    this.#providers = options.providers;
    this.#valuationProvider = options.valuationProvider;
    this.#cache = options.cache;
    this.#snapshots = options.snapshots;
    this.#freshForMs = options.freshForMs ?? 6 * 60 * 60 * 1_000;
    this.#staleForMs = options.staleForMs ?? 7 * 24 * 60 * 60 * 1_000;
    this.#now = options.now ?? (() => new Date());
  }

  async acquire(participantCount?: number): Promise<FrozenSnapshot> {
    return this.#cache.withLock('snapshot:refresh', async () => {
      const latest = await this.#snapshots.getLatestSnapshot();
      const age = latest === null ? Infinity : this.#now().getTime() - Date.parse(latest.createdAt);
      const failures: string[] = [];
      if (latest !== null) {
        try {
          await this.#assertViable(latest, participantCount);
          if (age <= this.#freshForMs) return latest;
          if (age <= this.#staleForMs) return latest;
        } catch (error) {
          failures.push(
            `cached snapshot ${latest.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }

      for (const provider of this.#providers) {
        try {
          const [players, managers] = await Promise.all([
            provider.getActivePlayers(),
            provider.getManagers(),
          ]);
          const normalized = [...players, ...managers];
          const candidates: CandidateSnapshot[] = [];
          for (const candidate of normalized) {
            const valuation = await this.#valuationProvider.getPlayerValuation(candidate);
            if (valuation.valueEUR === null || valuation.valueEUR <= 0) continue;
            candidates.push({ ...candidate, valuation });
          }
          if (candidates.length === 0)
            throw new Error('provider returned no valuated active candidates');
          const now = this.#now().toISOString();
          const digest = createHash('sha256')
            .update(
              candidates.map((candidate) => `${candidate.id}:${candidate.dataUpdatedAt}`).join('|'),
            )
            .digest('hex')
            .slice(0, 16);
          const snapshot: FrozenSnapshot = {
            id: `snapshot-${digest}-${randomUUID().slice(0, 8)}`,
            provider: provider.name,
            createdAt: now,
            sourceUpdatedAt:
              candidates
                .map((candidate) => candidate.dataUpdatedAt)
                .sort()
                .at(-1) ?? now,
            candidates,
          };
          await this.#assertViable(snapshot, participantCount);
          await this.#snapshots.putSnapshot(snapshot);
          return snapshot;
        } catch (error) {
          failures.push(
            `${provider.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }

      throw new SnapshotUnavailableError(failures);
    });
  }

  async #assertViable(snapshot: FrozenSnapshot, participantCount?: number): Promise<void> {
    const cacheKey = `snapshot:viable:${snapshot.id}:${participantCount ?? 'all'}`;
    if ((await this.#cache.get<boolean>(cacheKey)) === true) return;
    assertSnapshotPoolViable(
      snapshot.candidates,
      participantCount === undefined ? SUPPORTED_PARTICIPANT_COUNTS : [participantCount],
    );
    await this.#cache.set(cacheKey, true, this.#staleForMs);
  }
}
