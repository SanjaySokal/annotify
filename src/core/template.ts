/**
 * Tiny built-in template engine.
 *
 * Syntax (EJS-style, deliberately small):
 *
 *   <% code %>           scriptlet — runs JS, emits nothing.
 *   <%= expr %>          escaped HTML interpolation. Runs `htmlEscape(expr)`.
 *   <%- expr %>          raw HTML interpolation. No escape.
 *   <%# comment %>       comment. Emits nothing.
 *
 * Templates are compiled to a single `new Function('locals', body)` call
 * and cached by absolute path + mtime. Templates are server-controlled,
 * so `new Function` is acceptable here — do NOT pass user-supplied strings
 * as templates.
 *
 *   const ejs = { render: (tpl, data) => ... };
 *   app.engine('html', ejs);
 *   app.set('views', './views');
 *   app.set('view engine', 'html');
 *
 * Then in a handler:
 *
 *   @GetMapping('/')
 *   index() { return res.render('home', { name: 'Ada' }); }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EngineFn } from '../types/middleware.js';

/** Escape `&`, `<`, `>`, `"`, `'` for safe HTML interpolation. */
export function htmlEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compile an EJS-style template to a function body. The body looks roughly
 * like:
 *
 *   let __out = '';
 *   __out += '...literal...';
 *   __out += __escape(user.name);
 *   if (cond) { __out += '...'; }
 *   return __out;
 *
 * The compiled function receives `locals` (the data object) and an
 * `__escape` helper for `<%= %>` interpolation. `<%- %>` skips the helper.
 */
function compileToBody(template: string): string {
  // Tokenize: split on `<%...%>` segments. Use a single regex pass.
  const re = /<%([=#\-]?)([\s\S]*?)%>/g;
  // Each token is either:
  //   { kind: 'literal', text: string }
  //   { kind: 'scriptlet', code: string }    (plain <% %>)
  //   { kind: 'escape', code: string }        (<%= %>)
  //   { kind: 'raw', code: string }          (<%- %>)
  //   { kind: 'comment' }                    (<%# %>)
  type Tok = { kind: 'literal' | 'scriptlet' | 'escape' | 'raw' | 'comment'; text?: string; code?: string };
  const tokens: Tok[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: 'literal', text: template.slice(lastIndex, m.index) });
    }
    const tag = m[1];
    const body = m[2];
    if (tag === '#') tokens.push({ kind: 'comment' });
    else if (tag === '=') tokens.push({ kind: 'escape', code: body });
    else if (tag === '-') tokens.push({ kind: 'raw', code: body });
    else tokens.push({ kind: 'scriptlet', code: body });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < template.length) {
    tokens.push({ kind: 'literal', text: template.slice(lastIndex) });
  }

  // Walk tokens and emit a syntactically valid JS body. Adjacent
  // literals are concatenated with `+` so the `__out += …` chain stays
  // syntactically clean.
  //
  // We wrap the whole body in a `with (locals)` so `<%= user.name %>`
  // resolves `user` against the data object without needing manual
  // destructuring. `with` is non-strict, which is fine for server-side
  // templates (server-controlled source).
  let body = 'let __out="";with(locals){';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'comment') continue;
    if (t.kind === 'literal') {
      body += '__out+=' + jsStringLiteral(t.text ?? '') + ';';
      continue;
    }
    if (t.kind === 'escape') {
      body += '__out+=__escape(' + (t.code ?? '') + ');';
      continue;
    }
    if (t.kind === 'raw') {
      body += '__out+=' + (t.code ?? '') + ';';
      continue;
    }
    // scriptlet — inline raw JS. Don't wrap in a block, or `let`/`const`
    // declarations in `<% for (let i = …) { %>` would be block-scoped and
    // unreachable from `<%= items[i] %>` after the closing `%>`.
    body += ';' + (t.code ?? '');
  }
  body += '}return __out;';
  return body;
}

function jsStringLiteral(s: string): string {
  // Wrap as a template literal so multi-line templates work. Escape
  // backticks, backslashes, and `${` so the runtime template literal
  // stays syntactically valid.
  const escaped = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return '`' + escaped + '`';
}

/**
 * The built-in EJS engine. Implements `EngineFn`.
 */
export const ejsEngine: EngineFn = {
  render(template: string, data: Record<string, unknown>): string {
    const body = compileToBody(template);
    const fn = new Function('locals', '__escape', body);
    return fn(data, htmlEscape);
  },
};

/**
 * Compiled-template cache keyed by `${absolutePath}::${mtimeMs}`.
 * Vite/webpack-style invalidation — cheap and good enough.
 */
type CompiledFn = (data: Record<string, unknown>) => string;
const compiledCache = new Map<string, CompiledFn>();

function loadCompiled(viewPath: string): CompiledFn {
  const stat = fs.statSync(viewPath);
  const key = `${viewPath}::${stat.mtimeMs}`;
  const cached = compiledCache.get(key);
  if (cached) return cached;
  const src = fs.readFileSync(viewPath, 'utf8');
  const body = compileToBody(src);
  // Compiled body references `__escape`. Compile as a two-arg function,
  // then wrap as a single-arg `(locals) => string` that binds `htmlEscape`.
  const inner = new Function('locals', '__escape', body) as (
    data: Record<string, unknown>,
    esc: (v: unknown) => string,
  ) => string;
  const wrapped: CompiledFn = (data) => inner(data, htmlEscape);
  compiledCache.set(key, wrapped);
  // Evict previous mtime entry for this path to avoid leaks.
  for (const k of compiledCache.keys()) {
    if (k.startsWith(viewPath + '::') && k !== key) compiledCache.delete(k);
  }
  return wrapped;
}

/**
 * Resolve a view name to an absolute file path using the supplied options.
 * Adds the configured extension when the name has none. Accepts `ext` with
 * or without a leading dot.
 */
export function resolveView(
  view: string,
  viewsDir: string,
  ext: string,
): string {
  if (path.isAbsolute(view)) return view;
  const normalized = ext.startsWith('.') ? ext : '.' + ext;
  const hasExt = path.extname(view) !== '';
  return path.resolve(viewsDir, hasExt ? view : view + normalized);
}

/**
 * Render a view to a string. Reads the file from disk, compiles (cached
 * by path + mtime), executes with `data`. The engine is invoked by
 * `AppBuilder.render` after resolving extension and views directory.
 */
export function renderFile(
  view: string,
  data: Record<string, unknown>,
  viewsDir: string,
  ext: string,
  engine: EngineFn,
): string {
  const filePath = resolveView(view, viewsDir, ext);
  // For built-in ejsEngine, use the cached compiler path (it has a single
  // shared implementation). For user-supplied engines, just delegate.
  if (engine === ejsEngine) {
    const fn = loadCompiled(filePath);
    return fn(data);
  }
  const src = fs.readFileSync(filePath, 'utf8');
  return engine.render(src, data);
}

/**
 * Small utility used by `app.render` and the `res.render` shim. Returns the
 * file path a view name would resolve to, given the supplied settings.
 * Exposed so consumers can resolve paths for custom engines.
 */
export function viewFilePath(view: string, viewsDir: string, ext: string): string {
  return resolveView(view, viewsDir, ext);
}
