import { ensureRouteMeta } from './metadata.js';
import { joinPath } from './path.js';
import type { ClassDecorator } from './types.js';

function normalizeBasePath(path?: string): string {
  if (!path) return '';
  return joinPath('', path);
}

export function Controller(path?: string): ClassDecorator {
  return (target) => {
    const meta = ensureRouteMeta(target);
    meta.basePath = normalizeBasePath(path);
  };
}

export function RestController(path?: string): ClassDecorator {
  return (target) => {
    const meta = ensureRouteMeta(target);
    meta.basePath = normalizeBasePath(path);
    meta.isRest = true;
  };
}