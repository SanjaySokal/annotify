/**
 * `@Use(...)` — Spring-style method-level middleware.
 *
 *   @RestController('/api')
 *   export class UserController {
 *     @Use(requireAuth)
 *     @GetMapping('/me')
 *     me() { return { id: 1 }; }
 *
 *     // Multiple middlewares stack top-to-bottom.
 *     @Use(requireAuth, rateLimit(60))
 *     @PostMapping('/')
 *     create() { ... }
 *   }
 *
 * A `@Use(...)` on the *class* applies to every method (Spring's
 * `@ControllerAdvice` analog).
 *
 * At registration time, class-level middlewares are copied into
 * `meta.classMiddlewares`, and method-level middlewares are copied into
 * `entry.middlewares`. The pipeline concatenates them at request time.
 *
 * Note: middlewares must be *referenceable* at decoration time, so they
 * must be defined in module scope, not inside a method body. Stash a
 * reference to each middleware in a module-level constant before
 * referencing it from `@Use(...)`.
 */

import type { ClassDecorator, MethodDecorator } from '../decorators/types.js';
import type { MiddlewareFn } from '../types/middleware.js';
import { getOrCreateRouteMetaRegistry, ensureRouteMeta } from './metadata.js';

function recordMethod(ctor: object, methodName: string, mws: MiddlewareFn[]): void {
  const reg = getOrCreateRouteMetaRegistry(ctor);
  (reg.middlewaresByMethod ??= {})[methodName] = [...mws];
}

function recordClass(ctor: object, mws: MiddlewareFn[]): void {
  const meta = ensureRouteMeta(ctor);
  (meta.classMiddlewares ??= []).push(...mws);
}

/**
 * Method decorator. Stacks middlewares to run after route match but before
 * `resolveArgs` + handler invocation. Multiple `@Use` decorators on one
 * method stack in registration order (top-to-bottom source order is
 * preserved by reversing at read time, since legacy decorators apply
 * bottom-to-top).
 */
export function Use(...middlewares: MiddlewareFn[]): MethodDecorator {
  if (middlewares.length === 0) {
    throw new Error('@Use() requires at least one middleware function');
  }
  return (_target, propertyKey, _descriptor) => {
    const proto = _target as unknown as object;
    // Reuse the existing cross-method registry so the mapping decorator
    // can pick up `middlewaresByMethod` alongside `statusCodes` and
    // `corsByMethod`.
    recordMethod(proto, String(propertyKey), middlewares);
  };
}

/**
 * Class decorator. Stacks middlewares to run for every method on the
 * controller. Class-level middlewares run BEFORE method-level middlewares
 * in the effective chain.
 */
export function UseClass(...middlewares: MiddlewareFn[]): ClassDecorator {
  if (middlewares.length === 0) {
    throw new Error('@UseClass() requires at least one middleware function');
  }
  return (ctor) => {
    recordClass(ctor, middlewares);
  };
}
