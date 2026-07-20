import type { HttpMethod } from '../types/http.js';
import type { CorsConfig } from '../types/metadata.js';
import {
  consumeParamRegistry,
  getOrCreateRouteMetaRegistry,
  ensureRouteMeta,
} from './metadata.js';
import type { MethodDecorator } from './types.js';

function makeMapping(method: HttpMethod, path?: string): MethodDecorator {
  const subPath = path ?? '';
  return (target, propertyKey, _descriptor) => {
    const meta = ensureRouteMeta(target.constructor);
    const paramTypes = consumeParamRegistry(target, String(propertyKey));
    const reg = getOrCreateRouteMetaRegistry(target);
    const methodKey = String(propertyKey);
    const statusCode = reg.statusCodes?.[methodKey];
    const cors = reg.corsByMethod?.[methodKey];
    const methodMws = reg.middlewaresByMethod?.[methodKey];
    meta.routes.push({
      method,
      subPath,
      path: subPath, // provisional; replaced at registration
      handlerName: methodKey,
      paramTypes,
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(cors ? { cors } : {}),
      ...(methodMws ? { middlewares: [...methodMws] } : {}),
    });
  };
}

export function GetMapping(path?: string): MethodDecorator {
  return makeMapping('GET', path);
}

export function PostMapping(path?: string): MethodDecorator {
  return makeMapping('POST', path);
}

export function PutMapping(path?: string): MethodDecorator {
  return makeMapping('PUT', path);
}

export function DeleteMapping(path?: string): MethodDecorator {
  return makeMapping('DELETE', path);
}

export function PatchMapping(path?: string): MethodDecorator {
  return makeMapping('PATCH', path);
}

export function RequestMapping(path: string, method?: HttpMethod): MethodDecorator;
export function RequestMapping(opts: { path: string; method?: HttpMethod }): MethodDecorator;
export function RequestMapping(
  a: string | { path: string; method?: HttpMethod },
  b?: HttpMethod,
): MethodDecorator {
  let p: string;
  let m: HttpMethod | undefined;
  if (typeof a === 'string') {
    p = a;
    m = b;
  } else {
    p = a.path;
    m = a.method;
  }
  if (!m) {
    throw new Error('@RequestMapping requires a method when used at method level');
  }
  return makeMapping(m, p);
}