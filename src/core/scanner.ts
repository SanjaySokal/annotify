import { readdirSync } from 'node:fs';
import { extname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROUTE_METADATA } from '../decorators/metadata.js';

/**
 * Recursively scan a directory for controller files and return the class
 * constructors that have route metadata.
 *
 * Production use (compiled): pass the build-output directory; scanner reads
 * .js / .mjs files only.
 *
 * Dev use (nodemon + ts-node): pass the source directory. The .ts files are
 * loaded via dynamic import() — this requires ts-node's ESM loader hook to
 * be registered at process startup. See the "Dev workflow" section of the
 * docs for the recommended nodemon.json / CLI flags.
 */
export async function scanControllers(rootDir: string): Promise<Function[]> {
  const absRoot = resolvePath(rootDir);
  const files: string[] = [];
  walk(absRoot, files);

  // Detect whether a .ts file is present in the scan tree. If yes, the
  // process should have been started with the ts-node ESM loader hook.
  const hasTsFiles = files.some((f) => extname(f).toLowerCase() === '.ts');
  if (hasTsFiles) {
    verifyTsLoaderAvailable();
  }

  const ctors: Function[] = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.js' && ext !== '.mjs' && ext !== '.ts') continue;
    if (file.endsWith('.d.ts') || file.endsWith('.map')) continue;
    const url = pathToFileURL(file).href;
    try {
      const mod = await import(url);
      for (const exp of Object.values(mod)) {
        if (typeof exp !== 'function') continue;
        const meta = (exp as any)[ROUTE_METADATA];
        if (meta) ctors.push(exp as Function);
      }
    } catch {
      // Skip files that fail to import — they're likely helpers or have
      // non-class exports.
    }
  }
  return ctors;
}

/**
 * Print a one-shot hint if .ts files are present and ts-node isn't reachable.
 * The scanner doesn't try to register the loader itself — by the time we get
 * here, the loader needs to have been installed before this module was
 * imported, which only works via process-spawn flags (--loader ts-node/esm
 * or a nodemon.json that injects them).
 */
function verifyTsLoaderAvailable(): void {
  // Best-effort hint. We try to resolve ts-node via createRequire so this
  // works inside ESM modules. If ts-node isn't installed we warn once. If it
  // IS installed but the loader wasn't registered at process startup, the
  // actual import() failures during scan() will surface as missing
  // controllers, which is the user-facing signal we want.
  import('node:module')
    .then(({ createRequire }) => {
      try {
        const req = createRequire(import.meta.url);
        req.resolve('ts-node');
      } catch {
        console.warn(
          '[annotify] Found .ts controllers but ts-node is not installed. ' +
            'Install it (npm i -D ts-node) and run with the ESM loader: ' +
            '`node --loader ts-node/esm src/main.ts` (or use the nodemon ' +
            'config in the docs).',
        );
      }
    })
    .catch(() => {
      // node:module unavailable — give up silently.
    });
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}