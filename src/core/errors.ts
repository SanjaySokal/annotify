import type { ServerResponse } from 'node:http';
import type { HttpMethod } from '../types/http.js';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendNotFound(res: ServerResponse, extraHeaders?: Record<string, string>): void {
  sendJson(
    res,
    404,
    { error: 'Not Found', message: 'The requested route does not exist.' },
    extraHeaders,
  );
}

export function sendMethodNotAllowed(
  res: ServerResponse,
  allowed: HttpMethod[],
  extraHeaders?: Record<string, string>,
): void {
  const allow = allowed.join(', ');
  sendJson(
    res,
    405,
    { error: 'Method Not Allowed', message: `Allowed methods: ${allow}` },
    { Allow: allow, ...extraHeaders },
  );
}

export function sendUnsupportedMediaType(
  res: ServerResponse,
  extraHeaders?: Record<string, string>,
): void {
  sendJson(
    res,
    415,
    { error: 'Unsupported Media Type', message: 'Expected application/json.' },
    extraHeaders,
  );
}

export function sendPayloadTooLarge(
  res: ServerResponse,
  extraHeaders?: Record<string, string>,
): void {
  sendJson(
    res,
    413,
    { error: 'Payload Too Large', message: 'Request body exceeds 1 MB limit.' },
    extraHeaders,
  );
}

export function sendInternalError(
  res: ServerResponse,
  err: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof HttpError ? err.status : 500;
  const body: Record<string, unknown> = {
    error: status === 500 ? 'Internal Server Error' : message,
    message,
  };
  if (err instanceof HttpError && err.details) body.details = err.details;
  sendJson(res, status, body, extraHeaders);
}