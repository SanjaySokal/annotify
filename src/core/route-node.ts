import type { HttpMethod } from '../types/http.js';
import type { RouteEntry } from '../types/metadata.js';

export interface MatchResult {
  entry: RouteEntry;
  pathVars: Record<string, string>;
}

export class RouteNode {
  /** The literal segment, or ':' for a variable child. */
  segment: string;
  children: Map<string, RouteNode> = new Map();
  /** Pointer to the ':var' child if one exists at this depth. */
  varChild: RouteNode | null = null;
  /** HTTP method → handler info. Empty at intermediate nodes. */
  handlers: Map<HttpMethod, RouteEntry> = new Map();
  /** Set true when this node represents a matched-position end (i.e. a registered route). */
  isEnd: boolean = false;

  constructor(segment: string) {
    this.segment = segment;
  }

  isVar(): boolean {
    return this.segment.startsWith(':');
  }
}
