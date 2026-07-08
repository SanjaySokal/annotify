import type { MethodDecorator } from './types.js';
import { getOrCreateRouteMetaRegistry } from './metadata.js';

/**
 * @ResponseStatus(code)
 *
 * Method decorator. Sets the HTTP status code returned by this handler.
 * The default is 200 for handlers that return a value, or 204 for handlers
 * that return undefined. Use @ResponseStatus to declare a different code —
 * e.g. 201 for a successful create, 202 for accepted, etc.
 *
 *   @PostMapping('/')
 *   @ResponseStatus(201)
 *   create(@RequestBody() body: User) { return body; }
 *
 * The status is stored in a per-prototype side-channel and copied onto the
 * RouteEntry by Router.addController at registration time.
 */
export function ResponseStatus(code: number): MethodDecorator {
  return (target, propertyKey) => {
    const reg = getOrCreateRouteMetaRegistry(target as unknown as object);
    const key = String(propertyKey);
    (reg.statusCodes ??= {})[key] = code;
  };
}