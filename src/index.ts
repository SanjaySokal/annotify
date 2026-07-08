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
} from './decorators/index.js';

export { AppBuilder, bootstrap, type ClusterOptions } from './core/app.js';
export { HttpError } from './core/errors.js';
export { Router } from './core/router.js';
export { scanControllers } from './core/scanner.js';
export { RequestLogger, defaultLogFormat, type LogEntry, type LogFormatter, type LoggerOptions } from './core/logger.js';