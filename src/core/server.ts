import { createServer as httpCreateServer, IncomingMessage, ServerResponse } from 'node:http';
import { Router } from './router.js';
import { resolveArgs } from './resolver.js';
import {
  HttpError,
  sendBadRequest,
  sendInternalError,
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
  sendPayloadTooLarge,
  sendUnsupportedMediaType,
} from './errors.js';
import type { RequestContext } from './context.js';
import type { HttpMethod } from '../types/http.js';
import type { CorsConfig } from '../types/metadata.js';
import { buildCorsHeaders, CORS_DEFAULTS } from '../decorators/cors.js';
import type { RequestLogger, LogEntry } from './logger.js';
import { runChain } from './middleware.js';
import { ejsEngine, renderFile, resolveView } from './template.js';
import type { EngineFn, Locals, MiddlewareEntry } from '../types/middleware.js';
import type { AnnotifyResponse } from './built-in-mw.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;

function safeDecodeURIComponent(s: string): string {
  // decodeURIComponent throws URIError on malformed percent-encoding
  // (e.g. %ZZ, lone %, %G1). Treat those as raw strings rather than 500ing
  // the request. RFC 3986 says malformed sequences should be reported; we
  // choose graceful degradation over failing the entire request.
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
  }
}

function parseQuery(url: string): Record<string, string | string[]> {
  const qs = url.split('?')[1];
  const out: Record<string, string | string[]> = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = safeDecodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const v = safeDecodeURIComponent(eq === -1 ? '' : pair.slice(eq + 1));
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, v] : [prev as string, v];
    } else {
      out[k] = v;
    }
  }
  return out;
}

const ABORTED = Symbol('aborted');

async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE' || method === 'OPTIONS') {
    return undefined;
  }
  const ctype = (req.headers['content-type'] ?? '').toLowerCase();
  if (!ctype.includes('application/json')) {
    sendUnsupportedMediaType(res);
    return ABORTED;
  }
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        sendPayloadTooLarge(res);
        req.destroy();
        resolveBody(ABORTED);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        resolveBody(undefined);
        return;
      }
      try {
        resolveBody(JSON.parse(buf.toString('utf8')));
      } catch (err) {
        // Malformed JSON body — surface as 400, not 500. The request is
        // bad, not the server.
        const detail = err instanceof Error ? err.message : String(err);
        sendBadRequest(res, `Malformed JSON body: ${detail}`);
        resolveBody(ABORTED);
      }
    });
    req.on('error', reject);
  });
}

export interface ServerOptions {
  defaultIsRest?: boolean;
  logger?: RequestLogger;
  /** Empty string disables the introspection endpoint. */
  introspectionPath?: string;
  /** Express-style middleware chain registered via `app.use(...)`. */
  middlewares?: MiddlewareEntry[];
  /** Registered template engines. */
  engines?: ReadonlyMap<string, EngineFn>;
  /** App settings — `views`, `view engine`, etc. */
  settings?: ReadonlyMap<string, unknown>;
}

/**
 * Response helper interface used by handlers via `res.render(...)`.
 * We augment Node's `ServerResponse` with these methods at request time.
 */
interface ResponseWithHelpers {
  render: (name: string, data?: Record<string, unknown>) => Promise<string>;
}

/**
 * Build a `res.render` shim bound to the supplied engine + settings.
 */
function buildRender(
  res: ServerResponse,
  settings: ReadonlyMap<string, unknown> | undefined,
  engines: ReadonlyMap<string, EngineFn> | undefined,
): (name: string, data?: Record<string, unknown>) => Promise<string> {
  return async function render(name: string, data: Record<string, unknown> = {}): Promise<string> {
    const viewsDir = String(settings?.get('views') ?? './views');
    const ext = '.' + String(settings?.get('view engine') ?? 'html');
    const engine = engines?.get(ext.slice(1)) ?? ejsEngine;
    const filePath = resolveView(name, viewsDir, ext);
    const html = renderFile(name, data, viewsDir, ext.slice(1), engine);
    // Mark the response so the success branch sends HTML instead of JSON.
    (res as any).__annotifyRenderedPath = filePath;
    return html;
  };
}

/**
 * Wrap a `ServerResponse` so handlers can call `res.render(name, data)`.
 * The render method computes the HTML, marks the response, and returns the
 * string. The actual writeHead/end is done by the post-handler branch in
 * `handle()`.
 */
function attachResponseHelpers(
  res: ServerResponse,
  settings: ReadonlyMap<string, unknown> | undefined,
  engines: ReadonlyMap<string, EngineFn> | undefined,
): void {
  const r = res as ServerResponse & ResponseWithHelpers;
  r.render = buildRender(res, settings, engines);
}

/**
 * Rewrite `req.url` for path-prefixed middleware mounts. The supplied
 * prefix is stripped, leaving the path relative to the mount. Returns the
 * new URL string or `null` if the path does not match the prefix.
 */
function rewriteForPrefix(rawUrl: string, prefix: string): string | null {
  if (!prefix) return rawUrl;
  const [pathPart, queryPart] = rawUrl.split('?');
  if (!pathPart.startsWith(prefix)) return null;
  // Ensure boundary: the prefix is followed by `/` or end-of-string.
  const rest = pathPart.slice(prefix.length);
  if (rest === '' || rest.startsWith('/')) {
    const newPath = rest === '' ? '/' : rest;
    return queryPart ? `${newPath}?${queryPart}` : newPath;
  }
  return null;
}

/**
 * Resolve CORS config: per-route first, then class-level.
 */
function resolveCors(entry: { cors?: CorsConfig; classCors?: CorsConfig }): CorsConfig | undefined {
  return entry.cors ?? entry.classCors;
}

/**
 * Pre-computed CORS header bundle for an entry. Built once at registration
 * time so the request hot-path doesn't recompute methods, allowed headers,
 * credentials, maxAge, and exposed headers on every request.
 *
 * `origin` is the only per-request header (it may echo the request's
 * Origin). For wildcard configs we precompute everything; for allowlist
 * configs we keep a static set and the origin echo is added on the fly.
 */
interface PrecomputedCors {
  /** Headers that are always sent (when config is matched). */
  base: Record<string, string>;
  /** Allowed methods as a comma-separated string, with `*` fallback. */
  methods: string;
  /** True when origins is '*' (skip origin echo). */
  wildcard: boolean;
  /** Allowlist of origins, used when not wildcard. */
  origins?: string[];
}

function precomputeCors(cfg: CorsConfig, allowedMethods: string): PrecomputedCors {
  const methods =
    cfg.methods && cfg.methods.length > 0 ? cfg.methods.join(', ') : allowedMethods;
  const base: Record<string, string> = {};
  if (cfg.origins === '*') {
    base['Access-Control-Allow-Origin'] = '*';
  }
  base['Access-Control-Allow-Methods'] = methods;
  if (cfg.allowedHeaders && cfg.allowedHeaders.length > 0) {
    base['Access-Control-Allow-Headers'] = cfg.allowedHeaders.join(', ');
  } else if (cfg.origins !== '*') {
    base['Access-Control-Allow-Headers'] = CORS_DEFAULTS.DEFAULT_ALLOWED_HEADERS;
  }
  if (cfg.exposedHeaders && cfg.exposedHeaders.length > 0) {
    base['Access-Control-Expose-Headers'] = cfg.exposedHeaders.join(', ');
  }
  if (cfg.credentials) {
    base['Access-Control-Allow-Credentials'] = 'true';
  }
  if (typeof cfg.maxAge === 'number' && cfg.maxAge > 0) {
    base['Access-Control-Max-Age'] = String(cfg.maxAge);
  }
  return {
    base,
    methods,
    wildcard: cfg.origins === '*',
    ...(cfg.origins !== '*' && Array.isArray(cfg.origins) ? { origins: cfg.origins } : {}),
  };
}

/**
 * Build the actual response headers for a given precomputed bundle + request.
 * Returns `null` when the request origin is not allowed.
 */
function buildCorsHeadersFast(
  pre: PrecomputedCors,
  requestOrigin: string | undefined,
): Record<string, string> | null {
  if (pre.wildcard) {
    return { ...pre.base };
  }
  if (pre.origins && pre.origins.length > 0) {
    if (requestOrigin && pre.origins.includes(requestOrigin)) {
      return { ...pre.base, 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin' };
    }
    return null; // origin not allowed — emit nothing
  }
  return { ...pre.base };
}

/**
 * Get the configured or default list of HTTP methods at this path.
 */
function methodListAt(router: Router, reqPath: string): string {
  const methods = router.methodsAt(reqPath);
  if (methods && methods.length > 0) return methods.join(', ');
  return CORS_DEFAULTS.ALL_METHODS;
}

/**
 * Write a response with content-type chosen automatically for strings and
 * Buffers, or application/json for everything else. Used by the fast-path
 * when a handler returns a primitive value.
 */
function sendFast(
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders?: Record<string, string>,
): void {
  let body: string | Buffer;
  let contentType: string;
  if (typeof value === 'string') {
    body = value;
    contentType = 'text/plain; charset=utf-8';
  } else if (Buffer.isBuffer(value)) {
    body = value;
    contentType = 'application/octet-stream';
  } else if (value === undefined) {
    body = '';
    contentType = 'text/plain; charset=utf-8';
  } else {
    // Anything else — fall back to JSON. This keeps the function safe for
    // objects/arrays/numbers/booleans without changing the contract.
    body = JSON.stringify(value);
    contentType = 'application/json; charset=utf-8';
  }
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(payload.length),
    ...extraHeaders,
  });
  res.end(payload);
}

export function createApp(router: Router, opts: ServerOptions = {}) {
  const defaultIsRest = opts.defaultIsRest ?? true;
  const logger = opts.logger;
  const introspectionPath = opts.introspectionPath ?? '';
  const loggerEnabled = !!logger?.isEnabled();
  const middlewares = opts.middlewares ?? [];
  const engines = opts.engines;
  const settings = opts.settings;

  /**
   * Cache: introspection payload, generated once and reused. The route
   * table is frozen at registration time, so this is safe.
   */
  let introspectionCache: Buffer | null = null;
  function getIntrospectionBody(): Buffer {
    if (!introspectionCache) {
      const json = JSON.stringify({ routes: router.listRoutes() });
      introspectionCache = Buffer.from(json, 'utf8');
    }
    return introspectionCache;
  }

  /**
   * Filter the global middleware list to those whose prefix matches the
   * request path. Path-prefixed middlewares have their `req.url` rewritten
   * to drop the prefix so downstream sees the mount-relative path.
   */
  function selectMiddlewares(rawUrl: string): {
    mws: Array<{ prefix: string; mw: (typeof middlewares)[number]['mw'] }>;
    rewrittenUrl: string;
  } {
    const out: Array<{ prefix: string; mw: (typeof middlewares)[number]['mw'] }> = [];
    let lastRewritten = rawUrl;
    for (const entry of middlewares) {
      if (!entry.prefix) {
        out.push(entry);
        continue;
      }
      const rewritten = rewriteForPrefix(rawUrl, entry.prefix);
      if (rewritten === null) continue;
      out.push(entry);
      lastRewritten = rewritten;
    }
    return { mws: out, rewrittenUrl: lastRewritten };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Attach res.render shim before any handler/middleware can use it.
    attachResponseHelpers(res, settings, engines);
    // Per-request locals bag.
    (req as any).locals = {} as Locals;

    const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
    const rawUrl = req.url ?? '/';
    const pathOnly = rawUrl.split('?')[0];
    const requestOrigin = (req.headers['origin'] as string | undefined) ?? undefined;
    const defaultAllowedMethods = methodListAt(router, pathOnly);

    // ---------- Routes introspection (short-circuit) ----------
    if (introspectionPath && method === 'GET' && pathOnly === introspectionPath) {
      const body = getIntrospectionBody();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length),
      };
      // Logging wrapper has already captured timing; we still need to set
      // status. writeHead writes the final status.
      res.writeHead(200, headers);
      res.end(body);
      return;
    }

    // ---------- OPTIONS preflight (handled before body read) ----------
    if (method === 'OPTIONS') {
      const methods = router.methodsAt(pathOnly);
      if (methods && methods.length > 0) {
        let sampleCors: CorsConfig | undefined;
        for (const m of methods) {
          const sample = router.match(m, pathOnly)?.entry;
          if (sample) {
            sampleCors = resolveCors(sample as any);
            if (sampleCors) break;
          }
        }
        if (sampleCors) {
          const pre = precomputeCors(sampleCors, defaultAllowedMethods);
          // buildCorsHeadersFast returns null when the request origin is not
          // in the allowlist. We still reply 204 — the browser will block
          // the request because no Access-Control-Allow-Origin was sent —
          // matching the original behavior.
          const headers = buildCorsHeadersFast(pre, requestOrigin) ?? {};
          headers['Allow'] = defaultAllowedMethods;
          res.writeHead(204, headers);
          res.end();
          return;
        }
      }
    }

    const bodyResult = await readBody(req, res);
    if (bodyResult === ABORTED) return;

    // ---------- Pre-routing middleware chain ----------
    //
    // Runs BEFORE the router. A middleware can short-circuit by writing
    // to res, or pass through via next(). If the chain falls through,
    // we proceed to route matching. We rewrite req.url for path-prefixed
    // mounts so downstream code sees the mount-relative path.
    const sel = selectMiddlewares(rawUrl);
    if (sel.mws.length > 0) {
      if (sel.rewrittenUrl !== rawUrl) {
        req.url = sel.rewrittenUrl;
      }
      try {
        await runChain(
          sel.mws.map((e) => e.mw),
          req,
          res,
          () => {
            // Terminal: continue to routing.
          },
        );
      } catch (err) {
        if (!res.writableEnded) {
          sendInternalError(res, err);
        }
        return;
      }
      if (res.writableEnded) return;
    }

    const matched = router.match(method, (req.url ?? '/').split('?')[0]);
    let cors: CorsConfig | undefined;
    let preCors: PrecomputedCors | null = null;
    if (matched) {
      cors = resolveCors(matched.entry as any);
      if (cors) preCors = precomputeCors(cors, defaultAllowedMethods);
    }

    if (!matched) {
      const allowed = router.methodsAt((req.url ?? '/').split('?')[0]);
      if (allowed && allowed.length > 0) {
        const headers: Record<string, string> = { Allow: allowed.join(', ') };
        for (const m of allowed) {
          const sample = router.match(m, (req.url ?? '/').split('?')[0])?.entry;
          if (sample) {
            const c = resolveCors(sample as any);
            if (c) {
              const pre = precomputeCors(c, allowed.join(', '));
              const cs = buildCorsHeadersFast(pre, requestOrigin);
              if (cs) Object.assign(headers, cs);
              break;
            }
          }
        }
        sendMethodNotAllowed(res, allowed, headers);
        return;
      }
      // ---------- Post-routing fallthrough chain ----------
      // No annotation route matched AND no explicit method-list. Run the
      // global middleware chain again as a fallthrough. If nothing writes
      // a response, default to 404. This lets middleware like the static
      // file handler serve 404 with a custom page, or a fallback
      // middleware to render a templated 404.
      if (middlewares.length > 0) {
        try {
          await runChain(
            middlewares.map((e) => e.mw),
            req,
            res,
            () => {
              sendNotFound(res);
            },
          );
          return;
        } catch (err) {
          if (!res.writableEnded) sendInternalError(res, err);
          return;
        }
      }
      sendNotFound(res);
      return;
    }

    const query = parseQuery(req.url ?? '/');
    const ctx: RequestContext = {
      req, res,
      pathVars: matched.pathVars,
      query,
      body: bodyResult,
      isRest: defaultIsRest,
    };

    try {
      const entry = matched.entry;
      // ---------- Per-route @Use middleware chain ----------
      // Runs after route match, before resolveArgs. Class-level middlewares
      // are prepended at registration time, so entry.middlewares here is
      // [classMws..., ...methodMws].
      const routeMws = entry.middlewares;
      if (routeMws && routeMws.length > 0) {
        await runChain(routeMws, req, res, () => {
          // Terminal: continue to resolveArgs + handler.
        });
        if (res.writableEnded) return;
      }
      const args = await resolveArgs(entry, ctx);
      const fn = entry._handler as (...a: unknown[]) => unknown;
      if (!fn) throw new Error('Handler not bound for route ' + entry.path);
      const result = await fn(...args);

      if (res.writableEnded) return;

      // Status code resolution:
      //   1. @ResponseStatus(code) — explicit override.
      //   2. handler returned undefined → 204.
      //   3. otherwise → 200.
      let status: number;
      if (entry.statusCode !== undefined) {
        status = entry.statusCode;
      } else if (result === undefined) {
        status = 204;
      } else {
        status = 200;
      }

      // Compute CORS headers once for this request.
      let corsHeaders: Record<string, string> | undefined;
      if (preCors) {
        const h = buildCorsHeadersFast(preCors, requestOrigin);
        if (h) corsHeaders = h;
      }

      // Fast path: handler returned a string/Buffer/undefined → use sendFast.
      // Object/array/etc → JSON-encode via sendJson (existing path).
      if (result === undefined) {
        // 204 (or @ResponseStatus(204) with empty body)
        res.writeHead(status, corsHeaders ?? {});
        res.end();
        return;
      }

      // Built-in response helpers (html, redirect, etc.).
      if (isAnnotifyResponse(result)) {
        await writeAnnotifyResponse(res, method, result, status, corsHeaders);
        return;
      }

      // Rendered template (via res.render(...)) — return value of render is
      // the rendered HTML string; the side effect on res has already marked
      // it. Write it out as text/html.
      if (typeof result === 'string' && (res as any).__annotifyRenderedPath) {
        const body = result;
        res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          ...corsHeaders,
        });
        res.end(body);
        return;
      }

      if (typeof result === 'string' || Buffer.isBuffer(result)) {
        sendFast(res, status, result, corsHeaders);
        return;
      }
      // RFC 7231 §4.3.2: HEAD responses MUST NOT include a message body.
      // Send headers + Content-Length so the client knows what the body
      // WOULD be, but omit the actual bytes.
      if (method === 'HEAD') {
        const payload = JSON.stringify(result);
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          ...corsHeaders,
        });
        res.end();
        return;
      }
      sendJson(res, status, result, corsHeaders);
    } catch (err) {
      if (res.writableEnded) return;
      sendInternalError(res, err);
    }
  }

  return httpCreateServer((req, res) => {
    if (!loggerEnabled) {
      // Fast path: no logging wrapper, no per-request overhead beyond
      // the handler itself.
      handle(req, res).catch((err) => {
        if (!res.writableEnded) sendInternalError(res, err);
      });
      return;
    }

    // Logging path: wrap `res.writeHead` to record actual status, run the
    // handler, then log on response end.
    const startNs = process.hrtime.bigint();
    let recordedStatus: number | undefined;
    const originalWriteHead = res.writeHead.bind(res) as (...args: any[]) => ServerResponse;
    (res as any).writeHead = function (...args: any[]) {
      const status = typeof args[0] === 'number' ? args[0] : (args[1]?.statusCode ?? 200);
      if (recordedStatus === undefined) recordedStatus = status;
      return (originalWriteHead as any)(...args);
    } as typeof res.writeHead;

    const m = router.match((req.method ?? 'GET').toUpperCase() as HttpMethod, (req.url ?? '/').split('?')[0]);

    handle(req, res)
      .catch((err) => {
        if (!res.writableEnded) sendInternalError(res, err);
      })
      .finally(() => {
        const ns = process.hrtime.bigint() - startNs;
        const status = recordedStatus ?? res.statusCode ?? 0;
        const pathOnly = (req.url ?? '/').split('?')[0];
        const entry: LogEntry = {
          time: new Date().toISOString(),
          method: (req.method ?? 'GET').toUpperCase(),
          path: pathOnly,
          status,
          durationMs: Math.round(Number(ns) / 1_000_000),
        };
        if (m) entry.handler = m.entry.handlerName;
        logger!.log(entry);
      });
  });
}

/**
 * Type-guard for objects returned from `html()`, `redirect()`, etc.
 */
function isAnnotifyResponse(value: unknown): value is AnnotifyResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__annotifyKind' in (value as Record<string, unknown>)
  );
}

/**
 * Write an `AnnotifyResponse` to the wire, choosing the appropriate
 * status / content-type / body based on `__annotifyKind`.
 */
async function writeAnnotifyResponse(
  res: ServerResponse,
  method: HttpMethod,
  resp: AnnotifyResponse,
  fallbackStatus: number,
  corsHeaders: Record<string, string> | undefined,
): Promise<void> {
  const status = resp.status ?? fallbackStatus;
  if (resp.__annotifyKind === 'redirect') {
    const location = resp.location ?? '/';
    res.writeHead(status, { Location: location, ...corsHeaders });
    res.end();
    return;
  }
  if (resp.__annotifyKind === 'html') {
    const body = typeof resp.body === 'string' ? resp.body : '';
    if (method === 'HEAD') {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...corsHeaders,
      });
      res.end();
      return;
    }
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      ...corsHeaders,
    });
    res.end(body);
    return;
  }
  if (resp.__annotifyKind === 'json') {
    sendJson(res, status, resp.body, corsHeaders);
    return;
  }
  if (resp.__annotifyKind === 'buffer' && Buffer.isBuffer(resp.body)) {
    res.writeHead(status, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': (resp.body as Buffer).length,
      ...corsHeaders,
    });
    res.end(resp.body as Buffer);
    return;
  }
  // passthrough or unknown — write whatever body as-is.
  sendJson(res, status, resp.body, corsHeaders);
}