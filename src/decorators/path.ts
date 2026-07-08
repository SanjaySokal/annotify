// Path normalization helpers shared by all routing decorators.

export function joinPath(base: string, sub: string): string {
  const b = normalize(base);
  const s = normalize(sub);
  if (!b) return s || '/';
  if (!s) return b;
  return b + s;
}

function normalize(p: string): string {
  if (!p) return '';
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function splitSegments(path: string): string[] {
  const trimmed = path.split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return [];
  return trimmed.split('/');
}