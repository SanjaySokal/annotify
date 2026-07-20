/**
 * Middleware chain runner — the core of `app.use((req, res, next) => …)`.
 *
 * Semantics match Express's chain:
 *  - Calling `next()` advances to the next middleware in the array.
 *  - Calling `next(err)` short-circuits with an error (the framework catches
 *    it and falls through to `sendInternalError` if no error handler ran).
 *  - If `res.writableEnded` becomes true mid-chain (i.e. some middleware
 *    wrote a response), `next()` becomes a no-op and the chain resolves.
 *  - When all middlewares have run, the supplied `final` callback is
 *    invoked. For pre-routing chains, `final` is the route lookup +
 *    handler invocation. For post-routing fallthrough, `final` is the
 *    default 404.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MiddlewareFn } from '../types/middleware.js';

/**
 * Run `mws` sequentially. After every middleware calls `next()`, the next
 * one runs. If `next()` is never called but the response has been written,
 * the chain resolves. If `next(err)` is called, the chain rejects with the
 * supplied error.
 */
export function runChain(
  mws: MiddlewareFn[],
  req: IncomingMessage,
  res: ServerResponse,
  final: () => void | Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let i = 0;

    const next = (err?: unknown): void => {
      if (err) {
        reject(err);
        return;
      }
      // If a middleware wrote a response, treat the chain as terminated.
      if (res.writableEnded) {
        resolve();
        return;
      }
      if (i >= mws.length) {
        // Chain exhausted — invoke the terminal handler. Any thrown error
        // rejects the outer promise so the framework can render a 500.
        Promise.resolve()
          .then(final)
          .then(resolve, reject);
        return;
      }
      const mw = mws[i++];
      try {
        const ret = mw(req, res, next);
        if (ret && typeof (ret as Promise<unknown>).then === 'function') {
          (ret as Promise<void>).catch(reject);
        }
      } catch (e) {
        reject(e);
      }
    };

    next();
  });
}
