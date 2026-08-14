import { generateCandidatePool, poolCandidateCount } from '@gavel-xi/game-engine';
import { roomSettingsSchema } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryPersistence } from '../src/persistence.js';
import { CatalogProvider } from '../src/providers/catalog.js';
import { DevelopmentSnapshotProvider } from '../src/providers/development.js';

describe('durable player catalog', () => {
  it('reads only the stored catalog and preserves exact player positions', async () => {
    const persistence = new InMemoryPersistence();
    const source = new DevelopmentSnapshotProvider(2);
    const [players, managers] = await Promise.all([
      source.getActivePlayers(),
      source.getManagers(),
    ]);
    const leftBack = players.find((player) => player.preferredPosition === 'LB')!;
    const centreBack = players.find((player) => player.preferredPosition === 'CB')!;
    await persistence.replaceCatalog({
      source: 'test-import',
      players: [leftBack, centreBack],
      managers,
    });
    const catalog = new CatalogProvider(persistence);
    const stored = await catalog.getActivePlayers();

    expect(stored).toHaveLength(2);
    expect(stored.find((player) => player.id === leftBack.id)?.positions).toEqual(['LB']);
    expect(stored.find((player) => player.id === centreBack.id)?.positions).toEqual(['CB']);
    expect(await catalog.getCurrentSquad(leftBack.club)).toHaveLength(2);
  });

  it('fails honestly instead of falling back to a live football API when empty', async () => {
    const catalog = new CatalogProvider(new InMemoryPersistence());
    await expect(catalog.getActivePlayers()).rejects.toThrow('catalog is empty');
  });

  it.each([2, 3, 4, 5, 6, 7, 8])(
    'supplies exactly N exact-position candidates per formation cycle for N=%i',
    async (participantCount) => {
      const persistence = new InMemoryPersistence();
      const source = new DevelopmentSnapshotProvider(32);
      const [sourcePlayers, sourceManagers] = await Promise.all([
        source.getActivePlayers(),
        source.getManagers(),
      ]);
      await persistence.replaceCatalog({
        source: 'complete-test-catalog',
        // The durable Transfermarkt catalog verifies full-backs as LB/RB; it
        // does not manufacture separate LWB/RWB identities.
        players: sourcePlayers.filter(
          ({ preferredPosition }) => !['LWB', 'RWB'].includes(preferredPosition),
        ),
        managers: sourceManagers,
      });
      const catalog = new CatalogProvider(persistence);
      const [players, managers] = await Promise.all([
        catalog.getActivePlayers(),
        catalog.getManagers(),
      ]);
      const settings = roomSettingsSchema.parse({ formation: '3-5-2' });
      const pool = generateCandidatePool({
        seed: `catalog-position-capacity-${participantCount}`,
        settings,
        members: Array.from({ length: participantCount }, (_, index) => ({
          id: `catalog-member-${index + 1}`,
          budgetEUR: settings.budgetEUR,
          joinedAt: index,
        })),
        snapshot: {
          id: 'catalog-position-capacity',
          provider: catalog.name,
          createdAt: new Date(0).toISOString(),
          sourceUpdatedAt: new Date(0).toISOString(),
          candidates: [...players, ...managers],
        },
      });

      expect(pool.cycles).toHaveLength(12);
      expect(poolCandidateCount(pool, 'CB')).toBe(participantCount * 3);
      expect(poolCandidateCount(pool, 'ST')).toBe(participantCount * 2);
      for (const cycle of pool.cycles) {
        expect(cycle.candidates).toHaveLength(participantCount);
        expect(
          cycle.candidates.every(
            ({ candidate }) =>
              candidate.preferredPosition === cycle.position &&
              candidate.positions.length === 1 &&
              candidate.positions[0] === cycle.position,
          ),
        ).toBe(true);
      }
    },
  );
});
