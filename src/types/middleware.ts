/**
 * Shared types for middleware, static files, and template rendering.
 *
 * Middleware is the new extension point for cross-cutting request behavior
 * that runs on every request (logging, auth, static files, etc.) — distinct
 * from `useInterceptor`, which runs once at `build()` time to mutate
 * controller prototypes.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Express-style middleware function. Receives the raw Node `req` and `res`
 * plus a `next` callback. Calling `next()` advances the chain. Calling
 * `next(err)` short-circuits with an error. Writing to `res` short-circuits
 * without invoking downstream middleware or the matched handler.
 */
export type MiddlewareFn = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void | Promise<void>;

/**
 * Object stored on the response so handlers and middleware can stash
 * per-request state without mutating the underlying `ServerResponse`.
 * Attached by the server pipeline before the request is dispatched.
 */
export interface Locals {
  [key: string]: unknown;
}

/**
 * A template engine takes a template string plus a data object and returns
 * the rendered HTML. The framework ships a tiny EJS-style implementation
 * under `ejs`, but engines like Handlebars, Mustache, or custom logic can
 * be plugged in via `app.engine(name, engine)`.
 */
export interface EngineFn {
  /** Render a template string with the supplied data. Should not throw on missing keys. */
  render(template: string, data: Record<string, unknown>): string;
}

/**
 * Optional render callback. When supplied to `render`, errors and result are
 * delivered via Node-style callback instead of a returned Promise.
 */
export type RenderCallback = (err: Error | null, html?: string) => void;

/**
 * Mount descriptor held by `AppBuilder` for each registered `app.use(...)`.
 * `prefix` is the path scope (empty string means global).
 */
export interface MiddlewareEntry {
  prefix: string;
  mw: MiddlewareFn;
}

/**
 * Mount descriptor for static files specifically. Same shape as
 * `MiddlewareEntry` but kept distinct so future static-only config
 * (maxAge, immutable, etc.) can extend without bloating the general mw.
 */
export interface StaticEntry extends MiddlewareEntry {
  /** Absolute or process-relative directory to serve from. */
  root: string;
  /** Default file when a directory is requested. */
  index?: string;
  /** Cache-Control header value. */
  cacheControl?: string;
}
