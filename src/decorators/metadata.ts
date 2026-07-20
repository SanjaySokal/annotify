import type { RouteMetadata, ParamMeta } from '../types/metadata.js';
import type { MiddlewareFn } from '../types/middleware.js';

// Storage key on each controller class. In legacy decorator mode TS does not automatically
// attach Symbol.metadata, so we use a unique property name on the class constructor itself.
// We attach it as a non-enumerable property so it doesn't pollute `Object.keys(ctor)`.
export const ROUTE_METADATA = Symbol.for('annotify.route');

// ---------- Parameter decorator side-channel ----------
type ParamRegistry = Record<string, ParamMeta[]>;
const paramRegistry = new WeakMap<object, ParamRegistry>();

export function getOrCreateParamRegistry(proto: object): ParamRegistry {
  let reg = paramRegistry.get(proto);
  if (!reg) {
    reg = {};
    paramRegistry.set(proto, reg);
  }
  return reg;
}

export function consumeParamRegistry(proto: object, methodName: string): ParamMeta[] {
  const reg = paramRegistry.get(proto);
  const params = reg?.[methodName];
  if (reg) delete reg[methodName];
  return params ?? [];
}

// ---------- Cross-method metadata side-channel ----------
//
// Used for per-method data written by method decorators other than the HTTP-verb mapping.
// Right now: ResponseStatus, CorsConfig (when applied per-route), and @Use middleware lists.
//
// Keyed by the class prototype (same key as paramRegistry).
//
// IMPORTANT: Reading is non-destructive. Multiple per-method decorators
// (e.g. @PostMapping, @ResponseStatus, @CrossOrigin at method level) all
// need to peek at the slot. __decorate runs them in reverse, so the
// mapping decorator should not consume the slot — non-metadata decorators
// only ever WRITE to it, while the mapping decorator READS from it.
export interface RouteMetaRegistry {
  statusCodes?: Record<string, number>;
  corsByMethod?: Record<string, import('../types/metadata.js').CorsConfig>;
  middlewaresByMethod?: Record<string, MiddlewareFn[]>;
}

export function getOrCreateRouteMetaRegistry(proto: object): RouteMetaRegistry {
  let reg = routeMetaRegistry.get(proto);
  if (!reg) {
    reg = {};
    routeMetaRegistry.set(proto, reg);
  }
  return reg;
}

const routeMetaRegistry = new WeakMap<object, RouteMetaRegistry>();

// ---------- Class-level metadata ----------
export function ensureRouteMeta(ctor: object): RouteMetadata {
  const anyCtor = ctor as any;
  if (!anyCtor[ROUTE_METADATA]) {
    Object.defineProperty(ctor, ROUTE_METADATA, {
      value: { basePath: '', isRest: false, routes: [] },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return anyCtor[ROUTE_METADATA] as RouteMetadata;
}

export function getRouteMeta(ctor: object): RouteMetadata | undefined {
  return (ctor as any)[ROUTE_METADATA] as RouteMetadata | undefined;
}