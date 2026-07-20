// Bench driver for annotify. Pure Node, no deps.
// Usage: node bench.mjs [path] [durationSec]
// Default: GET /users/1, 6s per concurrency level.

import http from 'node:http';
import { availableParallelism } from 'node:os';

const BASE = 'http://127.0.0.1:3000';
const PATH = '/__annotify/routes';
const DURATION = Number(process.argv[3] ?? 6);
const CONCURRENCY = [50, 100, 250, 500, 1000, 2000, 4000];
const agent = new http.Agent({ keepAlive: true, maxSockets: 6000 });

async function fetchOnce() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(BASE + PATH, { agent }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        const ns = process.hrtime.bigint() - start;
        resolve({ status: res.statusCode, latencyMs: Number(ns) / 1_000_000 });
      });
    });
    req.on('error', (err) => resolve({ status: 0, latencyMs: 0, error: err.message }));
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}
function pct(s, p) { return s[Math.floor((s.length * p) / 100)]; }

async function runAt(c, dur) {
  const stop = Date.now() + dur * 1000;
  const lats = [];
  let ok = 0, err = 0;
  async function w() {
    while (Date.now() < stop) {
      const r = await fetchOnce();
      if (r.status === 200) ok++; else err++;
      lats.push(r.latencyMs);
    }
  }
  const t = Date.now();
  await Promise.all(Array.from({length:c}, w));
  const ms = Date.now() - t;
  lats.sort((a,b)=>a-b);
  const sum = lats.reduce((a,b)=>a+b,0);
  return { c, ms, n: lats.length, rps: Math.round(lats.length/ms*1000), ok, err,
    mean: Math.round(sum/lats.length*100)/100,
    p50: pct(lats,50), p95: pct(lats,95), p99: pct(lats,99), p999: pct(lats,99.9) };
}

console.log(`Cores: ${availableParallelism()} | Target: ${BASE}${PATH} | ${DURATION}s per level`);
console.log('');
console.log('  conc    rps    mean    p50    p95    p99   p99.9   ok/err');
for (const c of CONCURRENCY) {
  const r = await runAt(c, DURATION);
  console.log(`  ${String(c).padStart(4)}  ${String(r.rps).padStart(5)}  ${r.mean.toFixed(2).padStart(5)}  ${r.p50.toFixed(2).padStart(5)}  ${r.p95.toFixed(2).padStart(5)}  ${r.p99.toFixed(2).padStart(5)}  ${r.p999.toFixed(2).padStart(6)}    ${r.ok}/${r.err}`);
}
agent.destroy();