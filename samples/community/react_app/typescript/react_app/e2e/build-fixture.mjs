/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Bundles the fixture page into e2e/.generated/main.js. React is aliased to this package's copy:
 * @a2ui/react comes from the monorepo through a portal, and would otherwise resolve its own.
 */
import {build} from 'esbuild';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = join(e2eDir, '.generated');
mkdirSync(outDir, {recursive: true});

/** The directory of the copy of package `name` this package resolves. */
function single(name) {
  let dir = dirname(require.resolve(name));
  while (
    !existsSync(join(dir, 'package.json')) ||
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name
  ) {
    dir = dirname(dir);
  }
  return dir;
}

await build({
  entryPoints: [join(e2eDir, 'fixture', 'main.tsx')],
  outfile: join(outDir, 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  define: {'process.env.NODE_ENV': '"development"'},
  alias: {react: single('react'), 'react-dom': single('react-dom'), lit: single('lit')},
  // The fixture passes a font to the app frame as a data: URL, as hosts should.
  loader: {'.woff2': 'dataurl'},
  logLevel: 'warning',
});

// The bindings fixture app, compiled the way the agent server does, so the page can send it in
// `compiled` and the test can check that the frame skips its own transpile.
const {createReactAppCompiler} = await import('@a2ui-labs/react-app-compiler');
const {BINDINGS_APP_SOURCE, BINDINGS_DECLARATIONS} = await import('./fixture/bindings_app.mjs');
const result = createReactAppCompiler().compile(BINDINGS_APP_SOURCE, {
  bindings: BINDINGS_DECLARATIONS,
});
if (!result.ok) {
  throw new Error(
    `The bindings fixture app doesn't compile: ${JSON.stringify(result.diagnostics)}`,
  );
}
writeFileSync(
  join(outDir, 'compiled_bindings_app.json'),
  JSON.stringify({compiled: result.compiled, timings: result.timings}),
);
