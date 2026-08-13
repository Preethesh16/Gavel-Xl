import { loadConfig, loadRootEnvironment } from './config.js';
import { configuredProviders } from './server.js';

loadRootEnvironment();
const providers = configuredProviders(loadConfig());
const reports = await Promise.all(
  providers.map(async (provider) => {
    if (provider.getDataHealth === undefined)
      return { provider: provider.name, error: 'No provider diagnostic is implemented.' };
    return provider.getDataHealth();
  }),
);
process.stdout.write(`${JSON.stringify({ reports }, null, 2)}\n`);
