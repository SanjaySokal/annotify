/**
 * Type augmentations for Node's `IncomingMessage` and `ServerResponse`
 * to expose the middleware / render / locals surfaces added in v0.6.0.
 *
 * This file is automatically picked up by the build because it's inside
 * `src/` (which the tsconfig includes). Consumers do not need to do
 * anything special — once `annotify` is imported in a project, these
 * augmentations are merged into Node's types via declaration merging.
 */

import type { EngineFn, Locals } from './middleware.js';

declare module 'node:http' {
  interface IncomingMessage {
    /**
     * Per-request locals bag. Middleware can attach arbitrary data here
     * (e.g. parsed auth claims) for downstream handlers to read.
     */
    locals: Locals;
  }

  interface ServerResponse {
    /**
     * Render a template with the supplied data. The framework's response
     * writer detects the rendered result and emits it as `text/html`.
     *
     *   @GetMapping('/')
     *   index(_req, res) {
     *     return res.render('home', { name: 'Ada' });
     *   }
     */
    render: (
      name: string,
      data?: Record<string, unknown>,
    ) => Promise<string>;
  }
}

declare global {
  /**
   * Settings bag that the framework populates when a request is rendered.
   * Augment as needed in your app.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface AppSettings {
    // intentionally empty — populated by app.set()
  }
}

// Ensure engines can be referenced from JS as well.
declare const __annotifyInternalEngineMarker: EngineFn | undefined;
export {};
