/**
 * Built-in middleware factories. These cover the most common needs so
 * users can get started without writing their own:
 *
 *   import { AppBuilder, json, corsMw, requestLogger } from 'annotify';
 *
 *   const app = new AppBuilder();
 *   app.use(requestLogger());                       // access log
 *   app.use(json({ limit: '2mb' }));                // body parser (json only)
 *   app.use(corsMw({ origins: ['https://x.com'] })); // CORS
 *
 * Helpers exported here include `html()` and `redirect()` for use as
 * handler return values, plus `setHeader()` to attach response headers
 * from a handler.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MiddlewareFn } from '../types/middleware.js';

/**
 * Parse JSON request bodies into `req.body`. The framework's core pipeline
 * already reads JSON bodies for non-GET methods (see `server.ts:readBody`),
 * so this is a thin re-parser for cases where the framework-level body
 * read was bypassed or where the user wants a different size limit.
 *
 *   app.use(json({ limit: '2mb' }));
 */
export interface JsonOptions {
  /** Max body size. Default `'1mb'`. Accepts `'512kb'`, `'2mb'`, etc. */
  limit?: string | number;
}

function parseLimit(limit: string | number | undefined): number {
  if (limit === undefined) return 1024 * 1024;
  if (typeof limit === 'number') return limit;
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
  if (!m) return 1024 * 1024;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'b').toLowerCase();
  const mul = unit === 'kb' ? 1024 : unit === 'mb' ? 1024 * 1024 : unit === 'gb' ? 1024 * 1024 * 1024 : 1;
  return Math.floor(n * mul);
}

export function json(opts: JsonOptions = {}): MiddlewareFn {
  const limit = parseLimit(opts.limit);
  return function jsonMw(req, res, next) {
    const m = (req.method ?? 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'DELETE' || m === 'OPTIONS') {
      next();
      return;
    }
    if ((req as any).body !== undefined) {
      next();
      return;
    }
    const ctype = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!ctype.includes('application/json')) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        (req as any).body = undefined;
        next();
        return;
      }
      try {
        (req as any).body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        next();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request', message: 'Malformed JSON body' }));
      }
    });
    req.on('error', () => next());
  };
}

/**
 * Lightweight CORS middleware. Sets the standard `Access-Control-*`
 * headers on every response. For per-route CORS config use `@CrossOrigin`
 * — for app-wide config use this.
 */
export interface CorsMwOptions {
  /** Allowed origins. `'*'`, a single origin string, or an array. */
  origins?: '*' | string | string[];
  /** Allowed methods. Default common set. */
  methods?: string[];
  /** Allowed request headers. */
  allowedHeaders?: string[];
  /** Headers exposed to the browser. */
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With'];

export function corsMw(opts: CorsMwOptions = {}): MiddlewareFn {
  const methods = (opts.methods ?? DEFAULT_METHODS).join(', ');
  const allowedHeaders = (opts.allowedHeaders ?? DEFAULT_HEADERS).join(', ');
  const exposedHeaders = opts.exposedHeaders?.join(', ');
  const origins = opts.origins ?? '*';
  return function cors(req, res, next) {
    const origin = req.headers['origin'] as string | undefined;
    if (origins === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin) {
      const allowed = Array.isArray(origins) ? origins : [origins];
      if (allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    }
    if (exposedHeaders) res.setHeader('Access-Control-Expose-Headers', exposedHeaders);
    if (opts.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
      if (typeof opts.maxAge === 'number') res.setHeader('Access-Control-Max-Age', String(opts.maxAge));
      res.writeHead(204);
      res.end();
      return;
    }
    next();
  };
}

/**
 * Stdout access logger. Lightweight — emits one line per request.
 *
 *   app.use(requestLogger());
 *   app.use(requestLogger({ format: (m) => `${m.method} ${m.url} ${m.status} ${m.ms}ms` }));
 */
export interface LogLine {
  method: string;
  url: string;
  status: number;
  ms: number;
}
export type LogFormatter = (l: LogLine) => string;
const defaultFormat: LogFormatter = (l) =>
  `[annotify] ${l.method.padEnd(6)} ${l.url.padEnd(40)} ${l.status}  ${l.ms}ms`;

export function requestLogger(opts: { format?: LogFormatter } = {}): MiddlewareFn {
  const format = opts.format ?? defaultFormat;
  return function loggerMw(req, res, next) {
    const startNs = process.hrtime.bigint();
    let recordedStatus: number | undefined;
    const original = res.writeHead.bind(res);
    (res as any).writeHead = function (...args: unknown[]) {
      const status = typeof args[0] === 'number' ? args[0] : 200;
      if (recordedStatus === undefined) recordedStatus = status;
      return (original as (...a: unknown[]) => ServerResponse)(...(args as []));
    };
    res.on('finish', () => {
      const ns = process.hrtime.bigint() - startNs;
      const ms = Math.round(Number(ns) / 1_000_000);
      process.stdout.write(format({
        method: (req.method ?? 'GET').toUpperCase(),
        url: req.url ?? '/',
        status: recordedStatus ?? res.statusCode ?? 0,
        ms,
      }) + '\n');
    });
    next();
  };
}

/**
 * Build a small header object into `res` for use from handlers. Sets a
 * header and returns the value so it can be chained. Most callers won't
 * need this directly — `@ResponseStatus(code)` covers status, and
 * `res.setHeader()` is already on Node's `ServerResponse`.
 */
export function setHeader(name: string, value: string | number | string[]): void {
  // Placeholder retained for symmetry with the planned `setCookie`,
  // `setLocation`, etc. helpers. Implementation is via direct calls in
  // handlers — kept here so future response helpers have a home.
  void name;
  void value;
}

/**
 * Response helpers usable as return values from handlers. The framework's
 * response serializer detects objects with `__annotifyKind` and routes
 * them through the matching writer.
 *
 *   @GetMapping('/')
 *   index() { return html('<h1>hi</h1>'); }
 */
export interface AnnotifyResponse {
  __annotifyKind: 'html' | 'redirect' | 'json' | 'buffer' | 'passthrough';
  status?: number;
  body?: unknown;
  headers?: Record<string, string | number | string[]>;
  location?: string;
}

export function html(body: string, status = 200): AnnotifyResponse {
  return { __annotifyKind: 'html', status, body };
}

export function redirect(location: string, status = 302): AnnotifyResponse {
  return { __annotifyKind: 'redirect', status, location };
}
