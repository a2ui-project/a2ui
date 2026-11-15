// Fails if any value-import cycle passes through src/catalog/types.ts.
// `import type` / `export type` edges are erased at compile time and ignored.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) files.push(p);
  }
})(src);

const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?\sfrom\s+)?['"](\.[^'"]*)['"]/gm;
const graph = new Map();
for (const f of files) {
  const deps = [];
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(re)) {
    if (m[2]) continue;
    // Skip `import {type A, type B} from` (fully type-only named imports).
    const clause = m[3] ?? '';
    const names = clause.match(/\{([^}]*)\}/)?.[1];
    if (
      names &&
      names
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .every(s => s.startsWith('type '))
    )
      continue;
    const base = resolve(dirname(f), m[4].replace(/\.js$/, ''));
    const t = [base + '.ts', join(base, 'index.ts')].find(c => files.includes(c));
    if (t) deps.push(t);
  }
  graph.set(f, deps);
}

const root = join(src, 'catalog/types.ts');
const rel = p => p.slice(src.length + 1);
const seen = new Set();
function dfs(node, path) {
  for (const d of graph.get(node) ?? []) {
    if (d === root) return [...path, d];
    if (seen.has(d)) continue;
    seen.add(d);
    const r = dfs(d, [...path, d]);
    if (r) return r;
  }
}
const cycle = dfs(root, [root]);
if (cycle) {
  console.error('Import cycle through catalog/types.ts:\n  ' + cycle.map(rel).join('\n  -> '));
  process.exit(1);
}
console.log('check-cycles: no import cycle through catalog/types.ts');
