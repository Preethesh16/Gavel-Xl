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
});
