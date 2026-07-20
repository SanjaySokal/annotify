# annotify

> Annotation-based HTTP routing for Node.js + TypeScript — Spring Boot feel, zero runtime dependencies.

**Latest: v0.6.0** — adds Express-style middleware, per-route `@Use`, static files, and a built-in EJS-style template engine. See the [What's new in v0.6.0](#whats-new-in-v060) section below.

Annotify gives you `@RestController`, `@GetMapping`, `@PathVariable`, `@RequestBody`, `@RequestHeader`, and friends on top of Node's native `http` module. No Express, no Koa, no router libraries — just decorators and a small framework.

- npm: [https://www.npmjs.com/package/annotify](https://www.npmjs.com/package/annotify)
- GitHub: [https://github.com/SanjaySokal/annotify](https://github.com/SanjaySokal/annotify)
- Author: [https://www.sanjaysokal.com/](https://www.sanjaysokal.com/)

---

## Table of contents

- [What's new in v0.6.0](#whats-new-in-v060)
- [What's new in v0.5.2](#whats-new-in-v052)
- [What's new in v0.5.0](#whats-new-in-v050)
- [What's new in v0.3.0](#whats-new-in-v030)
- [Install](#install)
- [Quick start](#quick-start)
- [Middleware](#middleware)
- [Templates](#templates)
- [API reference](#api-reference)
  - [Class decorators](#class-decorators)
  - [Method decorators](#method-decorators)
  - [Parameter decorators](#parameter-decorators)
  - [Runtime API](#runtime-api)
- [Examples](#examples)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [HTTP response model](#http-response-model)
- [Request logger](#request-logger)
- [Routes introspection](#routes-introspection)
- [Documentation](#documentation)
- [Project structure](#project-structure)
- [Why legacy TypeScript decorators](#why-legacy-typescript-decorators)
- [License](#license)

---

## What's new in v0.6.0

Adds the missing cross-cutting layer — middleware, static files, and HTML rendering — without dropping any of the v0.5.x surface. No breaking API changes.

- **`app.use((req, res, next) => …)`** — Express-style middleware. Single global chain runs pre-routing; prefix-mounted middleware (`app.use('/static', …)`) only fires for matching paths and rewrites `req.url` so downstream sees the mount-relative path.
- **`@Use(...mws)` and `@UseClass(...mws)`** — per-method and per-class middleware (Spring's `@ControllerAdvice` analog). Class-level middlewares run first.
- **Built-in middleware** — `json`, `corsMw`, `requestLogger`, `staticFiles`, plus the response helpers `html()` and `redirect()`.
- **`staticFiles(dir)`** — GET/HEAD-only file server with a tiny mime map, `ETag` + `Last-Modified`, byte-range support, path-traversal guard, and an index fallback.
- **Built-in EJS-style template engine** with `<% %>`, `<%= %>`, `<%- %>`, `<%# %>`. `res.render(name, data)` from a handler. `app.set('views', dir)` + `app.set('view engine', 'html')` to configure.
- **`app.engine(name, fn)`** — register your own template engine (Handlebars, Mustache, anything). Same `EngineFn` contract as the built-in EJS.
- **AppBuilder settings bag** — `app.set(key, value)` and `app.get(key)`.
- **Pre-routing middleware + post-routing fallthrough chain** — when no annotation route matches, the global chain runs again before falling back to `404 Not Found`.

Example web demo: `examples/main-web.ts`. See [Middleware](#middleware) and [Templates](#templates) below.

---

## Middleware

```ts
import { AppBuilder, staticFiles, json, corsMw } from 'annotify';

const app = new AppBuilder();

app.use(corsMw({ origins: ['https://my.app'] }));
app.use((req, _res, next) => { console.log(req.method, req.url); next(); });
app.use('/static', staticFiles('./public'));      // prefix-mounted

app.set('views', './views');
app.set('view engine', 'html');
app.register(PageController);
await app.listen(3000);
```

Per-route middleware via `@Use`:

```ts
import { Controller, GetMapping, Use } from 'annotify';
import type { MiddlewareFn } from 'annotify';

const requireAuth: MiddlewareFn = (req, res, next) => {
  if (!req.headers['x-token']) { res.writeHead(401); res.end(); return; }
  next();
};

@Controller('/api')
export class ApiController {
  @GetMapping('/public') public() { return { ok: true }; }
  @GetMapping('/private') @Use(requireAuth) private() { return { secret: 42 }; }
}
```

See [`docs/middleware.html`](docs/middleware.html) for the full reference.

## Templates

```ts
@GetMapping('/')
index(_req, res) {
  return res.render('home', { title: 'annotify', items: ['a','b'] });
}
```

`examples/views/home.html`:

```html
<h1><%= title %></h1>
<% if (items.length > 0) { %>
  <ul>
    <% for (let i = 0; i < items.length; i++) { %>
      <li><%= items[i] %></li>
    <% } %>
  </ul>
<% } %>
```

Custom engine: `app.engine('hbs', myHandlebarsAdapter)`.

See [`docs/templates.html`](docs/templates.html) for the full reference.

---

## What's new in v0.5.2

Bug-fix patch over v0.5.0. No breaking API changes.

- **Malformed query strings return 200, not 500.** `?foo=%ZZ`, `?foo=%`, `?foo=%G1` used to crash the request with `Internal Server Error` because `decodeURIComponent` throws on bad percent-encoding. The query parser now treats malformed sequences as raw strings. `GET /users/?q=%ZZ` returns an empty `q` value (or whatever other params survived) instead of 500.
- **Malformed JSON bodies return 400, not 500.** Previously, `POST /users/` with `Content-Type: application/json` and a body like `{not-json}` would crash with 500. The body parser now returns a clean 400 `{"error":"Bad Request","message":"Malformed JSON body: ..."}` and the handler is not invoked.
- **`HEAD` responses no longer claim a body that isn't sent.** RFC 7231 §4.3.2 requires HEAD responses to have no message body. Annotify was including `Content-Length` for the JSON body but Node would strip the bytes — now the headers are correct.
- **`@RequestHeader` accepts an optional default value.** `@RequestHeader('X-Admin', '')` now matches Spring's behavior — when the header is absent, the parameter receives the default instead of `undefined`. This means handlers can safely do `auth.startsWith(...)` without `?? ''` guards.
- **Documentation updated** — both the public README and the bundled HTML docs site (`docs/`) were refreshed to reflect these changes.

## What's new in v0.5.0

**Original v0.5.0 release notes** — adds `AppBuilder.useInterceptor(fn)` for cross-cutting concerns (e.g. `annotify-redis` caching).

## What's new in v0.3.0

- `@ResponseStatus(code)` — declare a method's success status (e.g. 201 for create) instead of throwing or writing to `res` manually.
- `@CrossOrigin(opts?)` — class- or method-level CORS configuration. Annotify auto-handles `OPTIONS` preflight.
- `app.useLogger({ enabled: true })` — one access-log line per request, with timestamp, method, path, status, and duration.
- `app.exposeRoutes()` — exposes `GET /__annotify/routes` returning the full route table as JSON (method, path, handler, param types, status code, CORS config).

What's new in **v0.2.0** — `@ResponseStatus` and `@CrossOrigin` decorators + smoke tests 11–13 covering CORS.

What's new in **v0.1.x** — initial release: routing, all parameter decorators, scanner, build & smoke tests.

---

## Install

```bash
npm install annotify
```

`annotify` is a runtime package with **zero dependencies**. You only need `typescript` in your project to compile your own controllers:

```bash
npm install --save-dev typescript @types/node
```

Annotify declares `"type": "module"` and ships ES modules with TypeScript declarations.

---

## Quick start

```ts
// src/controllers/UserController.ts
import {
  RestController, GetMapping, PostMapping,
  PathVariable, RequestBody, RequestHeader,
  HttpError,
} from 'annotify';

interface User {
  id: number;
  name: string;
}

const users: User[] = [{ id: 1, name: 'Ada' }];

@RestController('/users')
export class UserController {
  @GetMapping('/:id')
  get(@PathVariable('id') id: string) {
    const user = users.find(u => u.id === Number(id));
    if (!user) throw new HttpError(404, `User ${id} not found`);
    return user;
  }

  @PostMapping('/')
  create(
    @RequestBody() body: User,
    @RequestHeader('X-Token') token: string,
  ) {
    if (!token) throw new HttpError(400, 'X-Token required');
    users.push(body);
    return { created: body, token };
  }
}
```

```ts
// src/main.ts
import { AppBuilder } from 'annotify';

const app = new AppBuilder();
await app.scan('./dist/controllers'); // compiled .js controllers
await app.listen(3000);
```

Add scripts to `package.json`:

```json
"scripts": {
  "build": "tsc",
  "start": "node dist/main.js"
}
```

Then `npm run build && npm start`.

---

## API reference

### Import surface

```ts
import {
  // Class decorators
  Controller, RestController,

  // Method decorators
  RequestMapping, GetMapping, PostMapping,
  PutMapping, DeleteMapping, PatchMapping,

  // Parameter decorators
  RequestParam, PathVariable, RequestBody, RequestHeader,

  // Runtime
  AppBuilder, HttpError, Router, scanControllers, RequestLogger,
} from 'annotify';
```

### Class decorators

#### `@Controller(path?: string)`

Marks a class as a controller and optionally sets a path prefix that every route declared on its methods is joined to.

```ts
@Controller('/api/v1/products')
export class ProductController { /* ... */ }
```

- `path` (optional) — leading slash recommended; trailing slashes are normalized.
- The decorator stores `basePath` and `isRest = false` on the class.

#### `@RestController(path?: string)`

Same as `@Controller`, but additionally sets the `isRest` flag so the framework knows to JSON-encode the return value (this is the default behavior of `AppBuilder`; the flag is exposed for completeness).

```ts
@RestController('/users')
export class UserController { /* ... */ }
```

### Method decorators

Each method decorator maps a method to an HTTP verb + path. The path is joined to the class-level prefix. Paths use `:name` for variables.

| Decorator | HTTP method |
|---|---|
| `@GetMapping(path?)` | GET |
| `@PostMapping(path?)` | POST |
| `@PutMapping(path?)` | PUT |
| `@DeleteMapping(path?)` | DELETE |
| `@PatchMapping(path?)` | PATCH |
| `@RequestMapping(path, method)` | any |

```ts
@GetMapping('/:id')           // → GET  /users/:id
@PostMapping('/')            // → POST /users/
@DeleteMapping('/:id')       // → DELETE /users/:id
@RequestMapping('/x', 'OPTIONS')
```

**Path normalization:** trailing slashes are stripped, leading slashes are enforced. `'/users/'` and `'/users'` are equivalent.

**Path variables** use a colon prefix and are URL-decoded automatically:

```ts
@GetMapping('/orders/:orderId/items/:itemId')
item(
  @PathVariable('orderId') orderId: string,
  @PathVariable('itemId')  itemId: string,
) {
  return { orderId, itemId };
}
```

### Parameter decorators

Parameter decorators bind parts of the incoming request to handler arguments. They can appear in any order — the resolver uses positional metadata captured at decoration time.

#### `@PathVariable(name?: string)`

Reads a path variable from the matched route. If you omit the name, the resolver falls back to the first `:var` in the pattern. Explicit names are recommended.

```ts
@GetMapping('/users/:id')
get(@PathVariable('id') id: string) { /* ... */ }
```

#### `@RequestParam(name?: string, defaultValue?: string)`

Reads a URL query parameter. If the parameter is missing or empty, `defaultValue` is used. Repeated keys collapse to the first value.

```ts
@GetMapping('/search')
search(@RequestParam('q', '') q: string, @RequestParam('limit', '20') limit: string) {
  // GET /search?q=foo&limit=10  → q='foo', limit='10'
  // GET /search                  → q='',     limit='20'
}
```

You can also pass an options object:

```ts
@RequestParam({ name: 'limit', defaultValue: '20' })
```

#### `@RequestBody()`

Parses the request body as JSON. If `Content-Type` is not `application/json`, the server returns `415 Unsupported Media Type` before the handler runs. Bodies larger than 1&nbsp;MB trigger `413 Payload Too Large`.

```ts
@PostMapping('/users')
create(@RequestBody() body: User) { /* ... */ }
```

#### `@RequestHeader(name?: string)`

Reads a single request header. Header lookup is case-insensitive (Node lowercases all incoming header names).

```ts
@GetMapping('/me')
me(@RequestHeader('Authorization') auth: string) { /* ... */ }
```

#### `@ResponseStatus(code)`

Method decorator. Sets the HTTP status code returned by the handler. The default is 200 for handlers that return a value, or 204 for handlers that return undefined. Use this to return, say, 201 on a successful create or 202 on an accepted request:

```ts
@PostMapping('/')
@ResponseStatus(201)
create(@RequestBody() body: User) { return body; }
```

The status is applied to `res.statusCode` before the body is serialized.

#### `@CrossOrigin(opts?)`

Method or class decorator. Adds CORS headers to the response and auto-handles OPTIONS preflight requests. See [CORS](#cors) below for full details.

### Positional fallback

If a parameter has no decorator at all, the resolver applies a positional fallback:

| Index | Value |
|---|---|
| 0 | `IncomingMessage` (raw `req`) |
| 1 | `ServerResponse` (raw `res`) |
| 2 | `RequestContext` (full context) |
| other | `undefined` |

```ts
@GetMapping('/stream')
stream(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.write('data: hello\n\n');
  // Already wrote to res — returning a value won't be re-serialized.
}
```

### Runtime API

#### `AppBuilder`

The main façade for building and starting your application.

```ts
class AppBuilder {
  scan(dir: string): Promise<this>;          // auto-discover controllers in a directory
  register(ctor: Function): this;             // manual registration
  setDefaultIsRest(v: boolean): this;         // default JSON behavior (default: true)
  useInterceptor(fn: (ctor: Function) => void): this; // wire cross-cutting concerns (caching, etc.)
  build(): Router;                            // instantiate + bind handlers
  listen(port: number, host?: string): Promise<http.Server>;
}
```

Typical usage:

```ts
const app = new AppBuilder();
await app.scan('./dist/controllers');
const server = await app.listen(3000, '127.0.0.1');

// Graceful shutdown
process.on('SIGINT', () => server.close(() => process.exit(0)));
```

`scan(dir)` walks the directory recursively, dynamically imports every `.js` / `.mjs` file, and registers any export whose class has `ROUTE_METADATA` set (i.e., is decorated with `@Controller` or `@RestController`).

`listen(port, host?)` returns the underlying `http.Server`. If you don't pass a host, it defaults to `127.0.0.1`.

#### `useInterceptor(fn)` (added in v0.5.0)

Register a function that runs against every registered controller class BEFORE instantiation in `build()`. Lets external packages (caching, transactions, auth) mutate the controller prototype to wire in cross-cutting behavior. Multiple interceptors run in registration order.

```ts
app.useInterceptor((controllerClass) => {
  // mutate controllerClass.prototype here
});
```

The canonical example is [`annotify-redis`](https://www.npmjs.com/package/annotify-redis), which uses this hook to auto-wrap `@Cacheable`/`@CachePut`/`@CacheEvict` methods — so end users only need to call `enableCaching(app, cache)` once instead of `wrapController(...)` per class.

#### `HttpError`

Throw from a handler to return a specific HTTP status code with a JSON envelope.

```ts
class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown);
}
```

```ts
@GetMapping('/:id')
get(@PathVariable('id') id: string) {
  const user = users.find(u => u.id === Number(id));
  if (!user) throw new HttpError(404, `User ${id} not found`);
  return user;
}
```

Non-`HttpError` exceptions become `500 Internal Server Error`.

#### `Router`

The trie-based router. Most users won't need this directly — `AppBuilder` exposes it via `build()` for advanced cases.

```ts
class Router {
  addEntry(entry: RouteEntry): void;
  addController(meta: RouteMetadata, instance: object): void;
  match(method: HttpMethod, requestPath: string):
    { entry: RouteEntry; pathVars: Record<string, string> } | null;
  methodsAt(requestPath: string): HttpMethod[] | null;
}
```

#### `scanControllers(rootDir: string): Promise<Function[]>`

The lower-level scanner. Walks `rootDir` recursively, imports each `.js` / `.mjs`, and returns constructors with route metadata. `AppBuilder.scan` is built on top of this.

---

## Examples

### Full CRUD with all parameter decorators

```ts
import {
  RestController, GetMapping, PostMapping, PutMapping, DeleteMapping,
  RequestParam, PathVariable, RequestBody, RequestHeader, HttpError,
} from 'annotify';

const users: { id: number; name: string }[] = [{ id: 1, name: 'Ada' }];

@RestController('/users')
export class UserController {
  @GetMapping('/')
  list(@RequestParam('limit', '10') limit: string) {
    const n = Math.max(0, Math.min(users.length, Number(limit) || users.length));
    return { count: users.length, items: users.slice(0, n) };
  }

  @GetMapping('/:id')
  get(@PathVariable('id') id: string) {
    const user = users.find(u => u.id === Number(id));
    if (!user) throw new HttpError(404, `User ${id} not found`);
    return user;
  }

  @PostMapping('/')
  create(
    @RequestBody() body: { id: number; name: string },
    @RequestHeader('X-Token') token: string,
  ) {
    if (!token) throw new HttpError(400, 'X-Token header is required');
    users.push(body);
    return { created: body, echoedToken: token };
  }

  @PutMapping('/:id')
  update(
    @PathVariable('id') id: string,
    @RequestBody() body: { id: number; name: string },
  ) {
    const i = users.findIndex(u => u.id === Number(id));
    if (i < 0) throw new HttpError(404, `User ${id} not found`);
    users[i] = body;
    return users[i];
  }

  @DeleteMapping('/:id')
  remove(@PathVariable('id') id: string) {
    const i = users.findIndex(u => u.id === Number(id));
    if (i < 0) throw new HttpError(404, `User ${id} not found`);
    const [removed] = users.splice(i, 1);
    return { deleted: removed };
  }
}
```

### Class-level path prefix + multi-variable routes

```ts
import { Controller, GetMapping, PathVariable, RequestParam } from 'annotify';

@Controller('/api/v1/products')
export class ProductController {
  @GetMapping('/')
  all(@RequestParam('q') q: string = '') {
    // GET /api/v1/products?q=widget
    return q ? products.filter(p => p.name.includes(q)) : products;
  }

  @GetMapping('/:id/reviews/:reviewId')
  review(
    @PathVariable('id') id: string,
    @PathVariable('reviewId') reviewId: string,
  ) {
    return { productId: id, reviewId };
  }
}
```

---

## Configuration

### `tsconfig.json`

Annotify requires legacy TypeScript decorators. Use this as a starting point:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "./",
    "outDir": "./dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": false,
    "useDefineForClassFields": false,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

The pivotal options and what they do:

| Option | Value | Why |
|---|---|---|
| `experimentalDecorators` | `true` | Required for `@PathVariable` etc. to be emitted as runtime calls |
| `emitDecoratorMetadata` | `false` | We don't use `Reflect.metadata` — annotify has its own side-channel |
| `useDefineForClassFields` | `false` | Ensures decorator-applied class fields behave correctly |
| `module` / `moduleResolution` | `NodeNext` | Matches `package.json`'s `"type": "module"` |
| `declaration` | `true` | Emits `.d.ts` files alongside the compiled output |

### `package.json`

For a project that uses annotify:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "annotify": "^0.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

---

## CORS

Use `@CrossOrigin` to attach CORS headers and auto-handle preflight. It works at class level (default for every route in the controller) or method level (override for one route).

```ts
import { CrossOrigin, RestController, GetMapping } from 'annotify';

// Class-level: every route in this controller allows the listed origin.
@CrossOrigin({
  origins: ['http://localhost:5173'],
  credentials: true,
  maxAge: 3600,
})
@RestController('/users')
export class UserController {
  @GetMapping('/') all() { /* ... */ }
}
```

Or shorthand:

```ts
@CrossOrigin()                              // '*' for all origins
@CrossOrigin('https://app.example.com')    // single origin
@CrossOrigin(['https://a.com', 'https://b.com'])
@CrossOrigin({ origins: '*', methods: ['GET', 'POST'] })
```

### What it does

- Adds `Access-Control-Allow-Origin` (and `Vary: Origin` when origins is a list).
- Adds `Access-Control-Allow-Methods` (defaults to all methods registered at the path).
- Adds `Access-Control-Allow-Headers` (defaults to a sensible set; configurable).
- Adds `Access-Control-Allow-Credentials: true` if `credentials: true`.
- Adds `Access-Control-Max-Age: <seconds>` if `maxAge` is set.
- Adds `Access-Control-Expose-Headers` if `exposedHeaders` is set.
- Auto-replies to `OPTIONS` preflight requests at known paths with `204` + all of the above.

### Method-level override

```ts
@RestController('/items')
@CrossOrigin()                // default '*'
export class ItemController {
  @CrossOrigin({ origins: ['https://admin.example'] })   // this route only
  @DeleteMapping('/:id')
  adminRemove(@PathVariable('id') id: string) { /* ... */ }
}
```

---

## Request logger

Turn on per-request logging with `app.useLogger(...)`:

```ts
import { AppBuilder } from 'annotify';

const app = new AppBuilder();
app.useLogger({ enabled: true });
```

Default output (one line per request):

```
[annotify] 2026-07-06T15:32:18.123Z  GET    /users/1                                 200  3 ms
[annotify] 2026-07-06T15:32:18.158Z  POST   /users/                                  201  1 ms
[annotify] 2026-07-06T15:32:18.221Z  GET    /nope                                    404  0 ms
```

Format: timestamp, method, path, status, duration in milliseconds. Pass a custom format function for total control:

```ts
app.useLogger({
  enabled: true,
  format: (e) => `${e.method} ${e.path} ${e.status} ${e.durationMs}ms`,
});
```

The `LogEntry` interface: `{ time, method, path, status, durationMs, handler?, controller? }`.

## Routes introspection

`app.exposeRoutes()` exposes a JSON snapshot of every registered route. Default path: `GET /__annotify/routes`.

```ts
app.exposeRoutes();                   // default '/__annotify/routes'
app.exposeRoutes('/api/__routes');    // custom path
app.exposeRoutes(null);                // disable
```

Sample output:

```json
{
  "routes": [
    {
      "method": "GET",
      "path": "/users/:id",
      "handlerName": "get",
      "paramTypes": [{ "kind": "path", "name": "id" }],
      "classCors": {
        "origins": ["http://localhost:5173"],
        "credentials": true,
        "maxAge": 3600
      }
    },
    {
      "method": "POST",
      "path": "/users/",
      "handlerName": "create",
      "paramTypes": [
        { "kind": "body" },
        { "kind": "header", "name": "X-Token" }
      ],
      "statusCode": 201,
      "classCors": { "origins": ["http://localhost:5173"], "credentials": true, "maxAge": 3600 }
    }
  ]
}
```

Each entry includes `method`, `path`, `handlerName`, `paramTypes` (with each parameter's `kind`/`name`/`defaultValue`), optional `statusCode` (from `@ResponseStatus`), and CORS config (`cors` from a method-level `@CrossOrigin` or `classCors` from the class).

---

## Architecture

The request lifecycle:

```
HTTP request
   │
   ▼
┌──────────────────┐
│  http.Server     │   (createServer in annotify core)
│  - read body     │
│  - parse query   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Router.match()  │   (trie walk: literal first, :var fallback)
└────────┬─────────┘
         │  match?
         ├─ no path exists    → 404 Not Found
         ├─ path exists,      → 405 Method Not Allowed + Allow header
         │  wrong method
         │
         ▼ yes
┌──────────────────┐
│  Resolver        │   (reads ParamMeta[] and binds handler args)
│  resolveArgs()   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Handler call    │   (entry._handler bound to controller instance)
│  await fn(...args)
└────────┬─────────┘
         │
         ├─ returns value   → JSON 200
         ├─ returns void    → 204
         └─ throws          → HttpError status, else 500
```

### Trie routing

Each trie node carries:
- a map of literal-segment children
- at most one `:var` child
- a map from HTTP method to handler entry

On a match attempt, the router tries the literal child first; if absent, falls back to the `:var` child and records the variable binding. This means `/users/me` is matched before `/users/:id` when both are registered.

### Metadata side-channel

There is no `reflect-metadata` dependency. Parameter decorators write to a `WeakMap` keyed by the class prototype; method decorators snapshot the per-method slot and push a `RouteEntry`. Once consumed, the slot is freed.

Class-level metadata (basePath, isRest, the array of route entries) lives on the class itself under the symbol key `Symbol.for('annotify.route')`, attached via `Object.defineProperty` with `enumerable: false`.

---

## HTTP response model

| Situation | Status | Body |
|---|---|---|
| Handler returns a value | `200` | `JSON.stringify(value)` |
| Handler returns `undefined` | `204` | empty |
| Handler throws `HttpError(s, msg)` | `s` | `{ error, message, details? }` |
| Handler throws anything else | `500` | `{ error: "Internal Server Error", message }` |
| Path doesn't exist | `404` | `{ error: "Not Found", message }` |
| Path exists, wrong method | `405` + `Allow: …` | `{ error: "Method Not Allowed", message }` |
| Body > 1 MB | `413` | `{ error: "Payload Too Large", message }` |
| Body content-type ≠ JSON | `415` | `{ error: "Unsupported Media Type", message }` |

---

## Documentation

A complete multi-page HTML documentation site ships with the package at `annotify/docs/`. After `npm install annotify`, open it from `node_modules/annotify/docs/index.html`, or browse the source on GitHub: [github.com/SanjaySokal/annotify/tree/main/docs](https://github.com/SanjaySokal/annotify/tree/main/docs).

Pages included:

- `index.html` — landing page
- `install.html` — prerequisites and install
- `quickstart.html` — five-minute walkthrough
- `decorators.html` — full decorator reference
- `core.html` — Router, Scanner, Resolver, Server, AppBuilder
- `errors.html` — HttpError and the response model
- `examples.html` — UserController and ProductController walkthroughs
- `testing.html` — the 10 end-to-end smoke tests
- `configuration.html` — `tsconfig.json` and `package.json` reference
- `source.html` — annotated source files

To preview locally:

```bash
node node_modules/annotify/docs/serve.mjs
# → http://127.0.0.1:8123
```

## Project structure

A typical annotify-based project:

```
my-app/
├── src/
│   ├── controllers/
│   │   ├── UserController.ts
│   │   └── ProductController.ts
│   └── main.ts                ← AppBuilder + listen()
├── dist/                      ← tsc output
├── package.json
└── tsconfig.json
```

The `controllers/` directory is what you pass to `app.scan(...)`.

---

## Why legacy TypeScript decorators

Annotify uses `experimentalDecorators: true`. The TC39 Stage 3 decorator proposal does **not** include parameter decorators, and TypeScript 5 strips them from compiled output when `experimentalDecorators` is off. Without parameter decorators there is no way to express `@PathVariable`, `@RequestBody`, etc. as runtime calls — they would simply not exist.

When TC39 ships parameter decorators and TypeScript implements them, annotify can migrate to Stage 3 without changing its public API. The metadata side-channel in `src/decorators/metadata.ts` would still work — it does not depend on legacy decorator specifics.

---

## Author

**Sanjay Sokal** — [https://www.sanjaysokal.com/](https://www.sanjaysokal.com/)

## Links

- npm: [https://www.npmjs.com/package/annotify](https://www.npmjs.com/package/annotify)
- GitHub: [https://github.com/SanjaySokal/annotify](https://github.com/SanjaySokal/annotify)
- Issues: [https://github.com/SanjaySokal/annotify/issues](https://github.com/SanjaySokal/annotify/issues)

## License

MIT