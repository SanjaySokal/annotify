import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  pathVars: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  isRest: boolean;
}