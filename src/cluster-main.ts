import { AppBuilder, bootstrap } from './index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

// Cluster mode — for testing the cluster helper. Run with:
//   node dist/src/cluster-main.js
//
// In production, you can also use the bootstrap() one-liner:
//   await bootstrap(app, { port: 3000, workers: 'auto' });
const app = new AppBuilder();
app.useLogger({ enabled: true });
app.exposeRoutes();
await app.scan(resolve(__dirname, '..', 'examples'));
await bootstrap(app, { port: PORT, host: HOST, workers: 'auto' });