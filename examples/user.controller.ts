import {
  RestController,
  GetMapping,
  PostMapping,
  PutMapping,
  DeleteMapping,
  RequestParam,
  PathVariable,
  RequestBody,
  RequestHeader,
  ResponseStatus,
  CrossOrigin,
  HttpError,
} from '../src/index.js';

interface User {
  id: number;
  name: string;
}

const users: User[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
];

// Class-level @CrossOrigin — applies to every route in this controller
// unless overridden per-method. Here we allow a single origin and turn on
// credentials + a 1-hour preflight cache.
@CrossOrigin({
  origins: ['http://localhost:5173'],
  credentials: true,
  maxAge: 3600,
})
@RestController('/users')
export class UserController {

  @GetMapping('/')
  list(@RequestParam('limit', '10') limit: string) {
    const n = Math.max(0, Math.min(users.length, Number(limit) || users.length));
    return { count: users.length, items: users.slice(0, n) };
  }

  @GetMapping('/:id')
  get(@PathVariable('id') id: string) {
    const user = users.find((u) => u.id === Number(id));
    if (!user) throw new HttpError(404, `User ${id} not found`);
    return user;
  }

  // @ResponseStatus(201) sets the success code for this handler.
  // Demonstrates: returning a value with a custom status code.
  @PostMapping('/')
  @ResponseStatus(201)
  create(
    @RequestBody() body: User,
    @RequestHeader('X-Token') token: string,
  ) {
    if (!token) throw new HttpError(400, 'X-Token header is required');
    if (!body || typeof body.id !== 'number' || typeof body.name !== 'string') {
      throw new HttpError(400, 'Body must be { id: number, name: string }');
    }
    users.push(body);
    return { created: body, echoedToken: token };
  }

  @PutMapping('/:id')
  update(
    @PathVariable('id') id: string,
    @RequestBody() body: User,
  ) {
    const i = users.findIndex((u) => u.id === Number(id));
    if (i < 0) throw new HttpError(404, `User ${id} not found`);
    users[i] = body;
    return users[i];
  }

  @DeleteMapping('/:id')
  @ResponseStatus(204)   // 204 No Content — but we still return a body for clarity
  remove(@PathVariable('id') id: string) {
    const i = users.findIndex((u) => u.id === Number(id));
    if (i < 0) throw new HttpError(404, `User ${id} not found`);
    const [removed] = users.splice(i, 1);
    return { deleted: removed };
  }
}