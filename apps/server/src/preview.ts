import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readCatalogFile } from './catalog-file.js';
import { createTransfermarktCatalog } from './catalog-bootstrap.js';
import { InMemoryPersistence } from './persistence.js';
import { InMemoryCache } from './cache.js';
import { buildServer } from './server.js';

// Keep the real-player preview independent of paid providers and managed databases.
const path = fileURLToPath(new URL('../data/real-player-catalog.json', import.meta.url));
let catalog;
try {
  catalog = await readCatalogFile(path);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  catalog = await createTransfermarktCatalog();
  await mkdir(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
  await writeFile(path, JSON.stringify(catalog));
}
const persistence = new InMemoryPersistence();
await persistence.replaceCatalog(catalog);
const server = await buildServer({
  persistence,
  cache: new InMemoryCache(),
  config: {
    NODE_ENV: 'development',
    FOOTBALL_DATA_PROVIDER: 'catalog',
    GROQ_API_KEY: undefined,
    REDIS_URL: undefined,
    DATABASE_URL: undefined,
  },
  logger: true,
});
await server.start();
server.app.log.info(
  { players: catalog.players.length, managers: catalog.managers.length },
  'Real-player preview ready',
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await server.stop();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
