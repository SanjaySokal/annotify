/**
 * annotify — annotation-based HTTP routing for Node.js + TypeScript.
 *
 * Public entry point. Import decorators from here, plus the AppBuilder
 * and HttpError for runtime use.
 */

export {
  Controller,
  RestController,
  RequestMapping,
  GetMapping,
  PostMapping,
  PutMapping,
  DeleteMapping,
  PatchMapping,
  RequestParam,
  PathVariable,
  RequestBody,
  RequestHeader,
  ResponseStatus,
  CrossOrigin,
  Use,
  UseClass,
} from './decorators/index.js';

export { AppBuilder, bootstrap, type ClusterOptions } from './core/app.js';
export { HttpError } from './core/errors.js';
export { Router } from './core/router.js';
export { scanControllers } from './core/scanner.js';
export { RequestLogger, defaultLogFormat, type LogEntry, type LogFormatter, type LoggerOptions } from './core/logger.js';

// Middleware + static + templates (v0.6.0)
export { runChain } from './core/middleware.js';
export { staticFiles, type StaticOptions } from './core/static-files.js';
export { ejsEngine, htmlEscape, renderFile, resolveView, viewFilePath } from './core/template.js';
export {
  json,
  corsMw,
  requestLogger,
  html,
  redirect,
  type JsonOptions,
  type CorsMwOptions,
  type LogLine,
  type LogFormatter as MwLogFormatter,
  type AnnotifyResponse,
} from './core/built-in-mw.js';
export type {
  MiddlewareFn,
  EngineFn,
  Locals,
  MiddlewareEntry,
  StaticEntry,
  RenderCallback,
} from './types/middleware.js';