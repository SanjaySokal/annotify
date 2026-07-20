import type { RouteEntry, ParamMeta } from '../types/metadata.js';
import type { RequestContext } from './context.js';

/**
 * Resolve handler arguments from the request context, using each parameter's
 * ParamMeta (if set by a decorator) or a positional fallback:
 *   param 0 → req, param 1 → res, param 2 → ctx.
 *
 * Path-variable name inference: if @PathVariable() is used without a name, we
 * look up the first :var in the route pattern. Best-effort fallback — callers
 * are encouraged to pass the name explicitly.
 */
export async function resolveArgs(
  entry: RouteEntry,
  ctx: RequestContext,
): Promise<unknown[]> {
  // Use `entry.paramTypes.length` as the source of truth for parameter count.
  // This is the metadata recorded by the @GetMapping / @PostMapping decorator
  // (via consumeParamRegistry) — it survives wrapping via Function.prototype.bind
  // (which resets `.length` to 0 on the bound function) and any cache /
  // interceptor wrappers in the prototype.
  //
  // If there are no parameter decorators, fall back to the original
  // (un-bound) handler arity so handlers like `(_req, res) => …` still get
  // `req`, `res`, `ctx` injected positionally.
  let arity = entry.paramTypes.length;
  if (arity === 0 && entry.handlerArity && entry.handlerArity > 0) {
    arity = entry.handlerArity;
  }
  const args: unknown[] = [];
  const pattern = entry.path;
  const segs = pattern.split('/').filter(Boolean);

  for (let i = 0; i < arity; i++) {
    const meta: ParamMeta | undefined = entry.paramTypes[i];
    if (!meta) {
      if (i === 0) args.push(ctx.req);
      else if (i === 1) args.push(ctx.res);
      else if (i === 2) args.push(ctx);
      else args.push(undefined);
      continue;
    }
    switch (meta.kind) {
      case 'req':
        args.push(ctx.req);
        break;
      case 'res':
        args.push(ctx.res);
        break;
      case 'context':
        args.push(ctx);
        break;
      case 'path': {
        const name = meta.name ?? inferPathVar(segs);
        args.push(ctx.pathVars[name]);
        break;
      }
      case 'param': {
        const name = meta.name ?? '';
        const raw = name ? ctx.query[name] : undefined;
        let value: string | undefined;
        if (Array.isArray(raw)) value = raw[0];
        else value = raw as string | undefined;
        if (value === undefined || value === '') {
          if (meta.defaultValue !== undefined) value = meta.defaultValue;
        }
        args.push(value);
        break;
      }
      case 'body':
        args.push(ctx.body);
        break;
      case 'header': {
        const name = (meta.name ?? '').toLowerCase();
        const v = ctx.req.headers[name];
        let value: string | string[] | undefined = Array.isArray(v) ? v.join(', ') : v;
        if (value === undefined && meta.defaultValue !== undefined) {
          value = meta.defaultValue;
        }
        args.push(value);
        break;
      }
    }
  }
  return args;
}

function inferPathVar(segs: string[]): string {
  for (const s of segs) if (s.startsWith(':')) return s.slice(1);
  return '';
}