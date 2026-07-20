/**
 * Example dashboard controller demonstrating the middleware + templates
 * + static-files feature surface added in annotify v0.6.0.
 *
 *   GET /                  → render `home.html` with data
 *   GET /greet/:name       → render `home.html` with a path variable
 *   GET /raw               → plain HTML response via `html()` helper
 *   GET /redirect          → 302 redirect via `redirect()` helper
 *   GET /protected         → per-route @Use(...) auth middleware
 *   GET /json              → existing JSON path (no middleware changes)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Controller, GetMapping, Use } from './decorators/index.js';
import { html, redirect } from './core/built-in-mw.js';
import type { MiddlewareFn } from './types/middleware.js';

/**
 * Sample auth middleware. Reads a header; if absent, writes a 401 and
 * short-circuits the chain. Otherwise calls next().
 */
const requireAuth: MiddlewareFn = (req, res, next) => {
  const token = req.headers['x-token'];
  if (!token || token === 'invalid') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid X-Token header' }));
    return;
  }
  next();
};

@Controller('/')
export class DashboardController {
  @GetMapping('/')
  async index(_req: IncomingMessage, res: ServerResponse) {
    return res.render('home', {
      title: 'annotify dashboard',
      subtitle: 'middleware + templates + static files',
      items: ['Item A', 'Item B', 'Item C'],
    });
  }

  @GetMapping('/greet/:name')
  async greet(_req: IncomingMessage, res: ServerResponse, _ctx: { pathVars: Record<string, string> }) {
    // `name` is the path variable, injected by the resolver into _ctx.pathVars.
    const name = (_req as any).annotifyPathVars?.name ?? 'world';
    return res.render('home', {
      title: `Hello, ${name}!`,
      subtitle: 'rendered from greet.ejs',
      items: ['one', 'two', 'three'],
    });
  }

  @GetMapping('/raw')
  raw() {
    return html('<h1>Plain HTML response</h1><p>Returned via html() helper.</p>');
  }

  @GetMapping('/redirect')
  r() {
    return redirect('/');
  }

  @GetMapping('/protected')
  @Use(requireAuth)
  protected() {
    return html('<h1>You are authenticated</h1>');
  }

  @GetMapping('/json')
  json() {
    return { ok: true, ts: Date.now() };
  }
}
