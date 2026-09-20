import { createHash } from 'node:crypto';
import { readCatalogFile } from './catalog-file.js';
import { loadConfig, loadRootEnvironment } from './config.js';
import { PrismaPersistence } from './persistence.js';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) throw new Error('Usage: catalog:import <catalog.json>');
  loadRootEnvironment();
  const config = loadConfig();
  if (config.DATABASE_URL === undefined)
    throw new Error('DATABASE_URL is required for catalog import.');
  const document = await readCatalogFile(path);
  const { source, players, managers } = document;
  const persistence = new PrismaPersistence({ connectionString: config.DATABASE_URL });
  await persistence.connect();
  try {
    await persistence.replaceCatalog({ source, players, managers });
    process.stdout.write(
      `${JSON.stringify({ source, players: players.length, managers: managers.length, sha256: createHash('sha256').update(JSON.stringify(document)).digest('hex') }, null, 2)}\n`,
    );
  } finally {
    await persistence.close();
  }
}

await main();
