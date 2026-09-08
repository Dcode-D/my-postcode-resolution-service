import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { Database } from './db/database.js';
import { createModelProvider } from './providers/index.js';
import { ResolutionService } from './services/resolution-service.js';

const config = loadConfig();
const database = new Database(config);
const provider = createModelProvider(config);
const service = new ResolutionService(database, provider, config);
const app = createApp(config, database, service);

const server = app.listen(config.PORT, () => {
  console.log(`postcode-resolution-service listening on :${config.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; stopping service`);
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
