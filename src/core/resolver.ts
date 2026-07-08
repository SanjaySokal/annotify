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
  const fn = entry._handler as Function | undefined;
  const arity = fn ? fn.length : 0;
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
        args.push(Array.isArray(v) ? v.join(', ') : v);
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