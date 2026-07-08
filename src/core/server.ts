import { createServer as httpCreateServer, IncomingMessage, ServerResponse } from 'node:http';
import { Router } from './router.js';
import { resolveArgs } from './resolver.js';
import {
  HttpError,
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

const MAX_BODY_BYTES = 1 * 1024 * 1024;

function parseQuery(url: string): Record<string, string | string[]> {
  const qs = url.split('?')[1];
  const out: Record<string, string | string[]> = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const v = decodeURIComponent(eq === -1 ? '' : pair.slice(eq + 1));
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
      try {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) {
          resolveBody(undefined);
          return;
        }
        resolveBody(JSON.parse(buf.toString('utf8')));
      } catch (err) {
        reject(err);
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

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

    const matched = router.match(method, pathOnly);
    let cors: CorsConfig | undefined;
    let preCors: PrecomputedCors | null = null;
    if (matched) {
      cors = resolveCors(matched.entry as any);
      if (cors) preCors = precomputeCors(cors, defaultAllowedMethods);
    }

    if (!matched) {
      const allowed = router.methodsAt(pathOnly);
      if (allowed && allowed.length > 0) {
        const headers: Record<string, string> = { Allow: allowed.join(', ') };
        for (const m of allowed) {
          const sample = router.match(m, pathOnly)?.entry;
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
      sendNotFound(res);
      return;
    }

    const query = parseQuery(rawUrl);
    const ctx: RequestContext = {
      req, res,
      pathVars: matched.pathVars,
      query,
      body: bodyResult,
      isRest: defaultIsRest,
    };

    try {
      const entry = matched.entry;
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
      if (typeof result === 'string' || Buffer.isBuffer(result)) {
        sendFast(res, status, result, corsHeaders);
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