import type { CorsConfig } from '../types/metadata.js';
import { ensureRouteMeta, getOrCreateRouteMetaRegistry } from './metadata.js';
import type { ClassDecorator, MethodDecorator } from './types.js';

/**
 * @CrossOrigin(...)
 *
 * Adds CORS headers to responses for the decorated scope:
 *
 *   @CrossOrigin()                          // default: '*', all standard methods
 *   @CrossOrigin('https://app.example.com') // single allowed origin
 *   @CrossOrigin({ origins: [...], credentials: true, maxAge: 3600 })
 *
 * Usable at class level (applies to every route in the controller) and at
 * method level (overrides the class default for that route).
 *
 * Effects:
 *   - Adds `Access-Control-Allow-Origin` (and friends) to every response.
 *   - Auto-replies to OPTIONS preflight requests at the matching path with
 *     a 204 + the configured headers + an Allow header.
 */

function normalizeConfig(input: string | string[] | CorsConfig | undefined): CorsConfig {
  if (!input) return { origins: '*' };
  if (typeof input === 'string') {
    if (input === '*') return { origins: '*' };
    return { origins: [input] };
  }
  if (Array.isArray(input)) {
    if (input.length === 1 && input[0] === '*') return { origins: '*' };
    return { origins: input };
  }
  // For CorsConfig input, merge with wildcard default for the origin.
  const { origins, ...rest } = input;
  let resolvedOrigins: string[] | '*';
  if (origins === undefined) resolvedOrigins = '*';
  else if (origins === '*') resolvedOrigins = '*';
  else resolvedOrigins = origins;
  return { origins: resolvedOrigins, ...rest };
}

const ALL_METHODS = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS';
const DEFAULT_ALLOWED_HEADERS =
  'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Token';

interface CrossOriginRegistry {
  corsByMethod?: Record<string, CorsConfig>;
}

/**
 * Combined decorator. TypeScript picks the right signature based on usage:
 *   @CrossOrigin()    at the class → ClassDecorator
 *   @CrossOrigin()    on a method → MethodDecorator
 *
 * Implementation note: legacy TS class decorators receive `(target)` only —
 * no descriptor. Method decorators receive `(target, key, descriptor)`. We
 * use the presence of `key` (and the kind string it carries) at runtime to
 * pick the right branch.
 */
export function CrossOrigin(input?: string | string[] | CorsConfig): ClassDecorator & MethodDecorator {
  const cfg = normalizeConfig(input);

  // Class path: only called with one arg (the constructor).
  const classImpl: ClassDecorator = (target) => {
    const meta = ensureRouteMeta(target as unknown as object);
    meta.cors = cfg;
  };

  // Method path: called with prototype, key, descriptor.
  const methodImpl: MethodDecorator = (target, propertyKey, _descriptor) => {
    const reg = getOrCreateRouteMetaRegistry(target as unknown as object) as CrossOriginRegistry;
    const key = String(propertyKey);
    reg.corsByMethod ??= {};
    reg.corsByMethod[key] = cfg;
  };

  // Hybrid function: branches based on arg count.
  const hybrid = (...args: any[]): any => {
    if (args.length >= 3 && typeof args[1] !== 'function') {
      // Method decorator signature: (target, propertyKey, descriptor)
      return methodImpl(args[0], args[1], args[2]);
    }
    if (args.length === 1) {
      // Class decorator signature: (target)
      return classImpl(args[0]);
    }
    // Fallback: assume method
    return methodImpl(args[0], args[1] ?? '', args[2]);
  };

  return hybrid as unknown as ClassDecorator & MethodDecorator;
}

/** Internal: read the per-method CORS override from the side-channel. */
export function takeMethodCors(proto: object, methodName: string): CorsConfig | undefined {
  const reg = getOrCreateRouteMetaRegistry(proto) as CrossOriginRegistry;
  const cfg = reg.corsByMethod?.[methodName];
  if (cfg && reg.corsByMethod) delete reg.corsByMethod[methodName];
  return cfg;
}

/** Render CORS headers for a given config onto a header bag. */
export function buildCorsHeaders(
  cfg: CorsConfig,
  requestOrigin: string | undefined,
  allowedMethods: string,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Origin
  if (cfg.origins === '*') {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (Array.isArray(cfg.origins)) {
    if (requestOrigin && cfg.origins.includes(requestOrigin)) {
      headers['Access-Control-Allow-Origin'] = requestOrigin;
      headers['Vary'] = 'Origin';
    } else {
      return headers;
    }
  }

  const methods = cfg.methods && cfg.methods.length > 0 ? cfg.methods.join(', ') : allowedMethods;
  headers['Access-Control-Allow-Methods'] = methods;

  if (cfg.allowedHeaders && cfg.allowedHeaders.length > 0) {
    headers['Access-Control-Allow-Headers'] = cfg.allowedHeaders.join(', ');
  } else if (cfg.origins !== '*') {
    headers['Access-Control-Allow-Headers'] = DEFAULT_ALLOWED_HEADERS;
  }

  if (cfg.exposedHeaders && cfg.exposedHeaders.length > 0) {
    headers['Access-Control-Expose-Headers'] = cfg.exposedHeaders.join(', ');
  }

  if (cfg.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  if (typeof cfg.maxAge === 'number' && cfg.maxAge > 0) {
    headers['Access-Control-Max-Age'] = String(cfg.maxAge);
  }

  return headers;
}

export const CORS_DEFAULTS = { ALL_METHODS, DEFAULT_ALLOWED_HEADERS };