/**
 * Web-mode demo entry point. Boots the dashboard example with full
 * middleware + static-files + templates wired in.
 *
 *   node dist/src/main-web.js   (after `npm run build`)
 *   npx ts-node src/main-web.ts  (dev)
 */

import { AppBuilder, staticFiles } from './index.js';
import { DashboardController } from './dashboard.controller.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = new AppBuilder();
app.useLogger({ enabled: true });

// Global request logger middleware (built-in).
app.use((req, _res, next) => {
  // Note: built-in `requestLogger()` is also available; we keep this
  // tiny inline version so the example compiles with no extra setup.
  console.log(`[mw] ${(req.method ?? 'GET').toUpperCase()} ${req.url}`);
  next();
});

// Static files: mounted under /static, served from examples/public/.
// A request to /static/style.css reads examples/public/style.css.
app.use('/static', staticFiles('./examples/public'));

// Templates: views directory + EJS-style engine (default).
app.set('views', './examples/views');
app.set('view engine', 'html');

app.register(DashboardController);
app.listen(PORT, HOST);
