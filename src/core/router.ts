import type { HttpMethod } from '../types/http.js';
import type { RouteEntry, RouteMetadata } from '../types/metadata.js';
import { RouteNode } from './route-node.js';
import { joinPath, splitSegments } from '../decorators/path.js';

export class Router {
  private root = new RouteNode('');

  addEntry(entry: RouteEntry): void {
    const segments = splitSegments(entry.path);
    let node = this.root;
    for (const seg of segments) {
      const isVar = seg.startsWith(':');
      if (isVar) {
        if (!node.varChild) {
          node.varChild = new RouteNode(seg);
        }
        node = node.varChild;
      } else {
        let child = node.children.get(seg);
        if (!child) {
          child = new RouteNode(seg);
          node.children.set(seg, child);
        }
        node = child;
      }
    }
    node.isEnd = true;
    node.handlers.set(entry.method, entry);
  }

  addController(meta: RouteMetadata, instance: object): void {
    for (const entry of meta.routes) {
      const fn = (instance as any)[entry.handlerName];
      if (typeof fn !== 'function') {
        throw new Error(
          `Handler '${entry.handlerName}' not found on controller after instantiation`,
        );
      }
      entry._handler = fn.bind(instance);
      // Resolve the full path here — class decorators run AFTER method decorators in legacy TS,
      // so meta.basePath wasn't available when @GetMapping ran.
      entry.path = joinPath(meta.basePath, entry.subPath);
      // Carry the class-level CORS config onto the entry for fallback resolution.
      if (meta.cors && !entry.cors) entry.classCors = meta.cors;
      this.addEntry(entry);
    }
  }

  match(method: HttpMethod, requestPath: string): { entry: RouteEntry; pathVars: Record<string, string> } | null {
    const segments = splitSegments(requestPath);
    const vars: Record<string, string> = {};
    let node = this.root;
    for (const seg of segments) {
      const literal = node.children.get(seg);
      if (literal) { node = literal; continue; }
      if (node.varChild) {
        const vc = node.varChild;
        vars[vc.segment.slice(1)] = decodeURIComponent(seg);
        node = vc;
        continue;
      }
      return null;
    }
    const entry = node.handlers.get(method);
    if (!entry) return null;
    return { entry, pathVars: vars };
  }

  /**
   * Returns HTTP methods registered at this exact path, or null if no path matches.
   * Used for 405 Method Not Allowed responses.
   */
  methodsAt(requestPath: string): HttpMethod[] | null {
    const segments = splitSegments(requestPath);
    let node = this.root;
    for (const seg of segments) {
      const literal = node.children.get(seg);
      if (literal) { node = literal; continue; }
      if (node.varChild) { node = node.varChild; continue; }
      return null;
    }
    if (!node.isEnd) return null;
    return Array.from(node.handlers.keys());
  }

  /**
   * Returns a snapshot of every registered route — used by the introspection
   * endpoint to expose the API surface as JSON.
   *
   * The output is a flat list. Each entry mirrors the public shape of
   * RouteEntry (without the bound _handler function).
   */
  listRoutes(): Array<{
    method: string;
    path: string;
    handlerName: string;
    paramTypes: Array<{ kind: string; name?: string; defaultValue?: string }>;
    statusCode?: number;
    cors?: { origins: string[] | '*'; methods?: string[]; credentials?: boolean; maxAge?: number };
    classCors?: { origins: string[] | '*'; methods?: string[]; credentials?: boolean; maxAge?: number };
  }> {
    const out: any[] = [];
    const walk = (node: RouteNode) => {
      if (node.isEnd) {
        for (const [, entry] of node.handlers) {
          out.push({
            method: entry.method,
            path: entry.path,
            handlerName: entry.handlerName,
            paramTypes: entry.paramTypes.map((p) => ({
              kind: p.kind,
              name: p.name,
              defaultValue: p.defaultValue,
            })),
            ...(entry.statusCode !== undefined ? { statusCode: entry.statusCode } : {}),
            ...(entry.cors ? { cors: entry.cors } : {}),
            ...(entry.classCors ? { classCors: entry.classCors } : {}),
          });
        }
      }
      for (const child of node.children.values()) walk(child);
      if (node.varChild) walk(node.varChild);
    };
    walk(this.root);
    // Stable order: path then method.
    out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
    return out;
  }
}