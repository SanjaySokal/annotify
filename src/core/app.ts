import type { Server } from 'node:http';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { Router } from './router.js';
import { createApp } from './server.js';
import { scanControllers } from './scanner.js';
import { getRouteMeta } from '../decorators/metadata.js';
import { RequestLogger, type LoggerOptions } from './logger.js';
import { ejsEngine, renderFile } from './template.js';
import type {
  EngineFn,
  MiddlewareFn,
  MiddlewareEntry,
  RenderCallback,
} from '../types/middleware.js';

export interface ClusterOptions {
  /** 'auto' = one worker per CPU core (default). A number pins the count. */
  workers?: 'auto' | number;
  /** Port the workers should listen on. Required when calling cluster(). */
  port: number;
  /** Host the workers should bind to. */
  host?: string;
}

export class AppBuilder {
  private router = new Router();
  private controllers: Function[] = [];
  private defaultIsRest = true;
  private logger: RequestLogger = new RequestLogger({ enabled: false });
  /** Path that exposes the routes introspection endpoint. Empty string disables. */
  private introspectionPath = '/__annotify/routes';
  /** Whether cluster() has already been called. */
  private clusterStarted = false;
  /**
   * Cross-cutting interceptors: functions that run against every registered
   * controller class BEFORE instantiation in `build()`. Lets external packages
   * (caching, transactions, auth) mutate the controller prototype to wire
   * in behavior. Multiple interceptors run in registration order, every time
   * `build()` is called.
   */
  private interceptors: Array<(controllerClass: Function) => void> = [];
  /**
   * Express-style middleware chain. Each entry has an optional path prefix;
   * an empty string means the middleware applies to every request. The chain
   * runs between body parsing and route matching.
   */
  private middlewares: MiddlewareEntry[] = [];
  /**
   * Registered template engines. The default view engine (configured via
   * `app.set('view engine', '...')`) selects which one `res.render(name)`
   * uses at request time.
   */
  private engines: Map<string, EngineFn> = new Map();
  /**
   * Settings bag — `views`, `view engine`, etc. Mirrors Express's
   * `app.set`/`app.get` shape.
   */
  private settings: Map<string, unknown> = new Map();

  /** Recursively scan a directory for compiled controllers and register them. */
  async scan(dir: string): Promise<this> {
    const found = await scanControllers(dir);
    for (const ctor of found) this.register(ctor);
    return this;
  }

  /** Register a controller class explicitly. */
  register(ctor: Function): this {
    this.controllers.push(ctor);
    return this;
  }

  /** Configure whether controllers default to JSON responses. */
  setDefaultIsRest(v: boolean): this {
    this.defaultIsRest = v;
    return this;
  }

  /**
   * Configure the request logger.
   *
   *   app.useLogger({ enabled: true });                      // turn on, default format
   *   app.useLogger({ enabled: true, format: (e) => '...' }); // custom line shape
   *   app.useLogger({ enabled: false });                     // turn off (default)
   */
  useLogger(opts: LoggerOptions): this {
    this.logger = new RequestLogger(opts);
    return this;
  }

  /**
   * Configure the introspection endpoint path.
   *
   *   app.exposeRoutes();                 // default '/__annotify/routes'
   *   app.exposeRoutes('/api/__routes'); // custom path
   *   app.exposeRoutes(null);             // disable
   */
  exposeRoutes(path: string | null = '/__annotify/routes'): this {
    this.introspectionPath = path ?? '';
    return this;
  }

  /**
   * Register a function that runs against every registered controller class,
   * BEFORE instantiation in `build()`. Use this to wire cross-cutting
   * concerns (caching, transactions, auth) that need to mutate the
   * controller prototype.
   *
   * The interceptor receives the controller class as its only argument.
   * Multiple interceptors run in registration order, every time `build()` is
   * called. Interceptors run BEFORE the controller is instantiated, so they
   * can safely replace or wrap methods on the prototype.
   *
   * Example — wire Redis caching into every controller:
   *
   *   import { enableCaching, RedisCacheManager } from 'annotify-redis';
   *   const cache = new RedisCacheManager(adapter);
   *   enableCaching(app, cache);
   *
   * Or call the interceptor directly:
   *
   *   app.useInterceptor((Ctor) => { console.log('wrapping', Ctor.name); });
   */
  useInterceptor(fn: (controllerClass: Function) => void): this {
    this.interceptors.push(fn);
    return this;
  }

  /**
   * Register an Express-style middleware.
   *
   *   app.use((req, res, next) => { ... next(); });         // global
   *   app.use('/api', authMw);                              // prefixed
   *   app.use(['/api', '/v1'], authMw);                    // multi-prefix
   *
   * When a prefix is given, only requests whose path starts with that
   * prefix trigger the middleware, and `req.url` is rewritten so downstream
   * handlers/middlewares see the path relative to the mount point.
   */
  use(pathOrMw: string | string[] | MiddlewareFn, mw?: MiddlewareFn): this {
    if (typeof pathOrMw === 'function') {
      this.middlewares.push({ prefix: '', mw: pathOrMw });
      return this;
    }
    if (!mw) {
      throw new Error('app.use(path, mw) requires a middleware function as the second argument');
    }
    const prefixes = Array.isArray(pathOrMw) ? pathOrMw : [pathOrMw];
    for (const p of prefixes) {
      this.middlewares.push({ prefix: normalizePrefix(p), mw });
    }
    return this;
  }

  /**
   * Register a template engine under a name. The built-in EJS-style engine
   * is pre-registered under `'html'` and `'ejs'`.
   *
   *   app.engine('html', ejsEngine);
   *   app.engine('hbs', myHandlebarsAdapter);
   */
  engine(name: string, engine: EngineFn): this {
    this.engines.set(name, engine);
    return this;
  }

  /**
   * Set a settings value. Used for `views`, `view engine`, etc.
   *
   *   app.set('views', './views');
   *   app.set('view engine', 'html');
   */
  set(key: string, value: unknown): this {
    this.settings.set(key, value);
    return this;
  }

  /** Read a setting. Returns `undefined` if unset. */
  get(key: string): unknown {
    return this.settings.get(key);
  }

  /**
   * Render a view template. Used by `res.render(name, data)` in handlers
   * — most callers won't invoke this directly.
   */
  render(name: string, data: Record<string, unknown> = {}, cb?: RenderCallback): Promise<string> | void {
    const viewsDir = String(this.settings.get('views') ?? './views');
    const ext = String(this.settings.get('view engine') ?? 'html');
    const engine = this.engines.get(ext) ?? ejsEngine;
    try {
      const html = renderFile(name, data, viewsDir, '.' + ext, engine);
      if (cb) cb(null, html);
      else return Promise.resolve(html);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (cb) cb(e);
      else return Promise.reject(e);
    }
    return;
  }

  /** Read-only snapshot of the middleware chain. Used by the server pipeline. */
  getMiddlewares(): readonly MiddlewareEntry[] {
    return this.middlewares;
  }

  /** Read-only snapshot of the engines map. Used by the server pipeline. */
  getEngines(): ReadonlyMap<string, EngineFn> {
    return this.engines;
  }

  /** Read-only snapshot of the settings map. Used by the server pipeline. */
  getSettings(): ReadonlyMap<string, unknown> {
    return this.settings;
  }

  /** Build all registered controllers into the router. */
  build(): Router {
    for (const ctor of this.controllers) {
      // Run user-registered interceptors first, so any prototype mutations
      // (cache wrappers, transaction proxies, etc.) are in place before we
      // instantiate the controller.
      for (const fn of this.interceptors) fn(ctor);
      const meta = getRouteMeta(ctor as unknown as object);
      if (!meta) {
        throw new Error('Class is not decorated with @Controller or @RestController: ' + (ctor as any).name);
      }
      const instance = new (ctor as any)();
      this.router.addController(meta, instance);
    }
    return this.router;
  }

  async listen(port: number, host = '127.0.0.1'): Promise<Server> {
    this.build();
    const server = createApp(this.router, {
      defaultIsRest: this.defaultIsRest,
      logger: this.logger,
      introspectionPath: this.introspectionPath,
      middlewares: this.middlewares,
      engines: this.engines,
      settings: this.settings,
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        const addr = server.address();
        const url =
          typeof addr === 'object' && addr
            ? `http://${addr.address}:${addr.port}`
            : `http://${host}:${port}`;
        console.log(`[server] listening on ${url}`);
        console.log(
          `[router] ${this.controllers.length} controller(s), ${this.countRoutes()} route(s) registered`,
        );
        if (this.middlewares.length > 0) {
          console.log(`[middleware] ${this.middlewares.length} mw(s) registered`);
        }
        if (this.introspectionPath) {
          console.log(`[introspect] GET ${this.introspectionPath}`);
        }
        if (this.logger.isEnabled()) {
          console.log(`[logger] enabled`);
        }
        resolve(server);
      });
    });
  }

  /**
   * Run the app as a multi-process cluster. Forks N workers that all share
   * the same listening socket. Designed for production throughput — N cores
   * means roughly N× the per-process throughput.
   *
   * In the **primary** process, this method forks workers and then waits
   * indefinitely (it never resolves to user code). In **worker** processes,
   * it falls through to a normal `app.listen()`.
   *
   * Usage:
   *
   *   if (cluster.isPrimary) {
   *     await app.cluster({ port: 3000, workers: 'auto' });
   *   }
   *
   * Or use the bundled `bootstrap()` helper for a one-liner:
   *
   *   import { bootstrap } from '..\index.js';
   *   await bootstrap(app, { port: 3000, workers: 'auto' });
   *
   * Notes:
   *  - SIGINT/SIGTERM on the primary are forwarded to all workers.
   *  - Workers that crash are auto-restarted by the cluster module.
   *  - In a worker, this method behaves exactly like `app.listen(port, host)`.
   */
  async cluster(opts: ClusterOptions): Promise<Server | void> {
    // Worker path: behave exactly like listen().
    if (cluster.isWorker) {
      return this.listen(opts.port, opts.host);
    }

    if (this.clusterStarted) {
      throw new Error('app.cluster() called twice — only call it once from the primary.');
    }
    this.clusterStarted = true;

    const count =
      opts.workers === undefined || opts.workers === 'auto'
        ? availableParallelism()
        : Math.max(1, Math.floor(opts.workers));

    console.log(
      `[cluster] primary ${process.pid} forking ${count} worker(s) for port ${opts.port}...`,
    );

    // Fork workers. Each worker re-enters this same `cluster()` call (because
    // cluster.fork runs the same entry script). On the worker side, the
    // `isWorker` branch returns `app.listen(...)`.
    for (let i = 0; i < count; i++) cluster.fork();

    cluster.on('exit', (worker, code, signal) => {
      // Restart workers that die unexpectedly. Don't restart intentional
      // exits (signal === 'SIGINT' / 'SIGTERM' or code === 0).
      const intentional = signal === 'SIGINT' || signal === 'SIGTERM' || code === 0;
      if (intentional) return;
      console.warn(
        `[cluster] worker ${worker.process.pid} died (code=${code}, signal=${signal}). Restarting...`,
      );
      cluster.fork();
    });

    // Forward signals from the primary to all workers.
    const forward = (sig: NodeJS.Signals) => {
      for (const id in cluster.workers) {
        cluster.workers[id]?.process.kill(sig);
      }
    };
    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));

    // Stay alive. We don't return to user code in the primary.
    return new Promise<void>(() => {});
  }

  private countRoutes(): number {
    let n = 0;
    for (const ctor of this.controllers) {
      const meta = getRouteMeta(ctor as unknown as object);
      if (meta) n += meta.routes.length;
    }
    return n;
  }
}

/**
 * One-liner bootstrap helper. Use this in `main.ts` for production:
 *
 *   import { bootstrap } from '..\index.js';
 *   import { AppBuilder } from '..\index.js';
 *
 *   const app = new AppBuilder();
 *   await app.scan('./dist/controllers');
 *   await bootstrap(app, { port: 3000, workers: 'auto' });
 */
export async function bootstrap(app: AppBuilder, opts: ClusterOptions): Promise<Server | void> {
  return app.cluster(opts);
}

function normalizePrefix(p: string): string {
  if (!p) return '';
  if (p === '/') return '';
  // Strip trailing slashes for comparison, but keep leading slash for the
  // path-prefix match. Server pipeline does its own URL rewriting.
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

export { HttpError } from './errors.js';