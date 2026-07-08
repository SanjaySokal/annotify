import type { HttpMethod } from './http.js';

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
  /** Set by Router.addController after instantiation. */
  _handler?: Function;
  /** @ResponseStatus target. Default 200 (or 204 if handler returns undefined). */
  statusCode?: number;
  /** Per-route CORS config (overrides class-level). */
  cors?: CorsConfig;
  /** Class-level CORS default, copied in at registration for fallback. */
  classCors?: CorsConfig;
}

export interface RouteMetadata {
  basePath: string;
  isRest: boolean;
  routes: RouteEntry[];
  /** Class-level CORS default — applied to every route that does not specify its own. */
  cors?: CorsConfig;
}