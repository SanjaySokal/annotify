/**
 * Per-request access logger for annotify.
 *
 * Default format:
 *
 *   [annotify] 2026-07-06T15:32:18.123Z  GET  /users/1         200  3 ms
 *
 * The logger is opt-in. Pass `logger({ enabled: true })` to AppBuilder to
 * turn it on. Pass a custom `format` function to override the line shape.
 */

export interface LogEntry {
  /** ISO-8601 timestamp. */
  time: string;
  method: string;
  path: string;
  status: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Resolved handler name (when known), e.g. "UserController.list". */
  handler?: string;
  /** Controller class name (when known). */
  controller?: string;
}

export type LogFormatter = (entry: LogEntry) => string;

export const defaultLogFormat: LogFormatter = (e) =>
  `[annotify] ${e.time}  ${e.method.padEnd(6)} ${e.path.padEnd(40)} ${e.status}  ${e.durationMs} ms` +
  (e.handler ? `  ${e.controller ?? '?'}.${e.handler}` : '');

export interface LoggerOptions {
  enabled?: boolean;
  format?: LogFormatter;
}

export class RequestLogger {
  private enabled: boolean;
  private format: LogFormatter;

  constructor(opts: LoggerOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.format = opts.format ?? defaultLogFormat;
  }

  isEnabled(): boolean { return this.enabled; }

  log(entry: LogEntry): void {
    if (!this.enabled) return;
    const line = this.format(entry);
    process.stdout.write(line + '\n');
  }
}