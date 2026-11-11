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
 * Builds the runtime into `dist/v1/`: content-hashed ES modules for every import map entry
 * (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `a2ui`, `a2ui-runtime`), shared
 * chunks (React itself, Sucrase and vega-embed load as separate chunks), the hashed
 * `a2ui-lite.css`, and `manifest.json` with the import map. All entries come from one esbuild
 * build with code splitting, so the app, the `a2ui` module and the runtime share one React.
 */

import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(packageDir, 'dist', 'v1');
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

process.env.NODE_ENV = 'production';

/** Import map name -> esbuild entry name and source. Shims re-export CommonJS React as ESM. */
const REACT_SHIMS = {
  react: 'react',
  'react/jsx-runtime': 'react-jsx-runtime',
  'react-dom': 'react-dom',
  'react-dom/client': 'react-dom-client',
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function shimSource(moduleName) {
  const names = Object.keys(require(moduleName)).filter(
    name => IDENTIFIER.test(name) && name !== 'default',
  );
  return [
    `import m from ${JSON.stringify(moduleName)};`,
    ...names.map(name => `export const ${name} = m.${name};`),
    'export default m;',
  ].join('\n');
}

const shimPlugin = {
  name: 'react-esm-shims',
  setup(pluginBuild) {
    pluginBuild.onResolve({filter: /^shim:/}, args => ({
      path: args.path.slice('shim:'.length),
      namespace: 'react-shim',
    }));
    pluginBuild.onLoad({filter: /.*/, namespace: 'react-shim'}, args => ({
      contents: shimSource(args.path),
      resolveDir: packageDir,
      loader: 'js',
    }));
  },
};

const entryPoints = {
  ...Object.fromEntries(
    Object.entries(REACT_SHIMS).map(([moduleName, entryName]) => [entryName, `shim:${moduleName}`]),
  ),
  a2ui: join(packageDir, 'src', 'runtime', 'a2ui_module.ts'),
  'a2ui-runtime': join(packageDir, 'src', 'runtime', 'main.tsx'),
};

const IMPORT_MAP_NAMES = {
  ...Object.fromEntries(Object.entries(REACT_SHIMS).map(([name, entry]) => [entry, name])),
  a2ui: 'a2ui',
  'a2ui-runtime': 'a2ui-runtime',
};

const licenseHeader = readFileSync(fileURLToPath(import.meta.url), 'utf8').match(
  /^\/\*[\s\S]*?\*\//,
)[0];

rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});

const result = await build({
  entryPoints,
  absWorkingDir: packageDir,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  outdir: outDir,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  define: {'process.env.NODE_ENV': '"production"'},
  banner: {js: licenseHeader},
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [shimPlugin],
});

/** Output file (relative to outDir) of each entry, keyed by import map name. */
const imports = {};
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  if (!output.entryPoint || !file.endsWith('.js')) {
    continue;
  }
  const entryName = basename(file).replace(/-[A-Z0-9]+\.js$/, '');
  const importName = IMPORT_MAP_NAMES[entryName];
  if (importName) {
    imports[importName] = `./${relative(outDir, resolve(packageDir, file))}`;
  }
}

/** Static imports of an output, transitively: what the first render needs. */
function staticClosure(start) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    for (const dependency of result.metafile.outputs[file]?.imports ?? []) {
      if (dependency.kind === 'import-statement') {
        visit(dependency.path);
      }
    }
  };
  for (const file of start) {
    visit(file);
  }
  return [...seen];
}

const firstRender = ['react', 'react/jsx-runtime', 'react-dom/client', 'a2ui', 'a2ui-runtime'].map(
  name => join(outDir, imports[name]),
);
const preload = staticClosure(firstRender.map(file => relative(packageDir, file))).map(
  file => `./${relative(outDir, join(packageDir, file))}`,
);
const chunks = Object.entries(result.metafile.outputs)
  .filter(([file, output]) => file.endsWith('.js') && !output.entryPoint)
  .map(([file]) => `./${relative(outDir, resolve(packageDir, file))}`)
  .sort();

const css = readFileSync(join(packageDir, 'src', 'runtime', 'a2ui-lite.css'));
const cssHash = createHash('sha256').update(css).digest('hex').slice(0, 8).toUpperCase();
const stylesheet = `a2ui-lite-${cssHash}.css`;
writeFileSync(join(outDir, stylesheet), css);

const manifest = {
  version: packageJson.version,
  protocolVersion: '1',
  importMap: {imports},
  entry: 'a2ui-runtime',
  stylesheet: `./${stylesheet}`,
  preload,
  chunks,
};
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const total = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
console.log(
  `Built runtime ${packageJson.version} into ${relative(packageDir, outDir)}: ` +
    `${Object.keys(result.metafile.outputs).length} files, ${(total / 1024).toFixed(0)} KB.`,
);
