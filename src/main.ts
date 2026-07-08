import { AppBuilder } from './index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = new AppBuilder();

// Per-request access log. Disable by passing { enabled: false }.
app.useLogger({ enabled: true });

// Routes introspection endpoint — GET /__annotify/routes returns the
// full route table as JSON. Pass null to disable.
app.exposeRoutes();

const controllersDir = resolve(__dirname, '..', 'examples');
console.log(`[scanner] scanning ${controllersDir}`);

await app.scan(controllersDir);
const server = await app.listen(PORT, HOST);

// Graceful shutdown on Ctrl-C / kill.
const shutdown = (signal: string) => {
  console.log(`\n[server] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));