/**
 * Static-file middleware. Serves files from a directory under an optional
 * mount prefix. Used as:
 *
 *   app.use(staticFiles('./public'));                          // root mount
 *   app.use('/static', staticFiles('./public'));               // prefixed
 *   app.use(staticFiles('./public', { index: 'index.html' })); // custom index
 *
 * Semantics:
 *  - GET and HEAD only. Other methods fall through (`next()`).
 *  - Path-traversal guard: any `..` segment returns `next()` (no file served).
 *  - On directory request, looks for `index.html` (or the configured
 *    `opts.index`) and serves it; otherwise falls through.
 *  - Streams the file via `fs.createReadStream` (no buffering of large
 *    files in memory).
 *  - Emits `Content-Type` from a tiny mime map, `Content-Length`,
 *    `Last-Modified`, `Cache-Control` (default `public, max-age=0`).
 *  - Honors simple `Range: bytes=start-end` requests for partial content.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createReadStream, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MiddlewareFn } from '../types/middleware.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

function safeResolve(root: string, reqPath: string): string | null {
  // Reject path-traversal attempts.
  if (reqPath.includes('..')) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(reqPath);
    } catch {
      return null;
    }
  })();
  if (decoded === null) return null;
  const full = path.resolve(root, '.' + decoded);
  // Final guard: the resolved file must stay inside the root. resolve()
  // already normalizes `..`, but double-check against the absolute root.
  if (!full.startsWith(path.resolve(root))) return null;
  return full;
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = m[1] === '' ? null : Number(m[1]);
  const end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  const s = start ?? Math.max(0, size - Number(end));
  const e = end ?? size - 1;
  if (Number.isNaN(s) || Number.isNaN(e) || s > e || e >= size) return null;
  return { start: s, end: e };
}

export interface StaticOptions {
  /** Default file when a directory is requested. Default `'index.html'`. */
  index?: string;
  /** Cache-Control header value. Default `'public, max-age=0'`. */
  cacheControl?: string;
  /** Set true to include hidden files (starting with `.`). Default `false`. */
  dotfiles?: 'ignore' | 'allow';
}

/**
 * Build a middleware that serves files from `rootDir`. Pair with
 * `app.use(mw)` or `app.use('/prefix', mw)`.
 */
export function staticFiles(rootDir: string, opts: StaticOptions = {}): MiddlewareFn {
  const root = path.resolve(rootDir);
  const indexFile = opts.index ?? 'index.html';
  const cacheControl = opts.cacheControl ?? 'public, max-age=0';
  const dotfiles = opts.dotfiles ?? 'ignore';

  return function serveStatic(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const rawPath = (req.url ?? '/').split('?')[0];
    const resolved = safeResolve(root, rawPath);
    if (!resolved) {
      next();
      return;
    }

    fs.promises
      .stat(resolved)
      .then((stat) => serveFile(res, resolved, stat, req, next, indexFile, cacheControl, dotfiles))
      .catch(() => next());
  };
}

function serveFile(
  res: ServerResponse,
  filePath: string,
  stat: Stats,
  req: IncomingMessage,
  next: (err?: unknown) => void,
  indexFile: string,
  cacheControl: string,
  dotfiles: 'ignore' | 'allow',
): void {
  if (stat.isDirectory()) {
    // Redirect /dir -> /dir/ so relative asset URLs resolve.
    if (!filePath.endsWith(path.sep)) {
      const url = req.url ?? '/';
      res.writeHead(301, { Location: url.replace(/\/?$/, '/') });
      res.end();
      return;
    }
    fs.promises
      .stat(path.join(filePath, indexFile))
      .then((idxStat) => serveFile(res, path.join(filePath, indexFile), idxStat, req, next, indexFile, cacheControl, dotfiles))
      .catch(() => next());
    return;
  }

  // Dotfile guard.
  const base = path.basename(filePath);
  if (dotfiles === 'ignore' && base.startsWith('.')) {
    next();
    return;
  }

  const size = stat.size;
  const mtime = stat.mtime;
  const lastModified = mtime.toUTCString();
  const etag = `"${size.toString(16)}-${Math.floor(mtime.getTime() / 1000).toString(16)}"`;

  // Handle If-None-Match / If-Modified-Since for cheap 304s.
  const ifNoneMatch = req.headers['if-none-match'];
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifNoneMatch === etag || (ifModifiedSince && Date.parse(ifModifiedSince) >= mtime.getTime())) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
    res.end();
    return;
  }

  const range = parseRange(req.headers['range'] as string | undefined, size);
  const isHead = req.method === 'HEAD';

  const headers: Record<string, string> = {
    'Content-Type': mimeFor(filePath),
    'Cache-Control': cacheControl,
    'Last-Modified': lastModified,
    ETag: etag,
    'Accept-Ranges': 'bytes',
  };

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    res.writeHead(206, headers);
    if (isHead) {
      res.end();
      return;
    }
    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    stream.on('error', (err) => next(err));
    stream.pipe(res);
    return;
  }

  headers['Content-Length'] = String(size);
  res.writeHead(200, headers);
  if (isHead) {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', (err) => next(err));
  stream.pipe(res);
}
