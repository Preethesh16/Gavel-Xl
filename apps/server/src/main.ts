import { loadRootEnvironment } from './config.js';
import { buildServer } from './server.js';

loadRootEnvironment();
const server = await buildServer({ logger: true });
const address = await server.start();
server.app.log.info({ address }, 'GAVEL XI realtime server listening');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.app.log.info({ signal }, 'Stopping GAVEL XI realtime server');
  await server.stop();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
