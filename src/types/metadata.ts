import type { HttpMethod } from './http.js';
import type { MiddlewareFn } from './middleware.js';

export type ParamKind =
  | 'param'
  | 'path'
  | 'body'
  | 'header'
  | 'req'
  | 'res'
  | 'context';

export interface ParamMeta {
  kind: ParamKind;
  name?: string;
  defaultValue?: string;
}

export interface CorsConfig {
  /** Origin(s) to allow. '*' (default), a single origin, or an array of origins. */
  origins: string[] | '*';
  /** Allowed HTTP methods. Defaults to all methods registered at this path. */
  methods?: string[];
  /** Headers exposed to the browser. Defaults to common ones. */
  allowedHeaders?: string[];
  /** Headers the browser may read from the response. */
  exposedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds. Default 0 (no cache). */
  maxAge?: number;
}

export interface RouteEntry {
  method: HttpMethod;
  /** The method-level path fragment — joined with basePath at registration time. */
  subPath: string;
  /** Full path computed at registration time (basePath + subPath). */
  path: string;
  handlerName: string;
  paramTypes: ParamMeta[];
  /**
   * Original (unbound) handler arity, captured at registration. Used as a
   * positional fallback by the resolver when `paramTypes` is empty —
   * `Function.prototype.bind` resets `.length` to 0 on the bound handler,
   * so we must remember the un-bound count separately.
   */
  handlerArity?: number;
  /** Set by Router.addController after instantiation. */
  _handler?: Function;
  /** @ResponseStatus target. Default 200 (or 204 if handler returns undefined). */
  statusCode?: number;
  /** Per-route CORS config (overrides class-level). */
  cors?: CorsConfig;
  /** Class-level CORS default, copied in at registration for fallback. */
  classCors?: CorsConfig;
  /**
   * Middlewares attached via `@Use(...)` on the method. Run between route
   * match and `resolveArgs`. Class-level middlewares are prepended at request
   * time, so the effective order is: [classMws..., ...methodMws].
   */
  middlewares?: MiddlewareFn[];
}

export interface RouteMetadata {
  basePath: string;
  isRest: boolean;
  routes: RouteEntry[];
  /** Class-level CORS default — applied to every route that does not specify its own. */
  cors?: CorsConfig;
  /**
   * Class-level middlewares attached via `@Use(...)` on the controller
   * class. Applied to every method's per-route chain. (Spring's
   * `@ControllerAdvice` analog.)
   */
  classMiddlewares?: MiddlewareFn[];
}