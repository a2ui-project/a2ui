/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getPackageGraph} from './lib/workspace.mjs';

// This script prepares a package for publishing.
// Arguments:
//   --source <path>: Path to the source package.json (defaults to ./package.json)
//   --dist <path>: Path to the output directory (defaults to ./dist)
//   --skip-path-adjustment: Skip rewriting paths to remove './dist/' prefixes

const args = process.argv.slice(2);
let sourcePkgPath = './package.json';
let distDir = './dist';
let skipPathAdjustment = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source') sourcePkgPath = args[++i];
  else if (args[i] === '--dist') distDir = args[++i];
  else if (args[i] === '--skip-path-adjustment') skipPathAdjustment = true;
}

const packageDir = process.cwd();
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const resolvedSourcePkg = resolve(packageDir, sourcePkgPath);
const resolvedDistDir = resolve(packageDir, distDir);
const rootDir = resolve(scriptDir, '../../');

if (!existsSync(resolvedDistDir)) {
  mkdirSync(resolvedDistDir, {recursive: true});
}

const graph = getPackageGraph();
const pkg = JSON.parse(readFileSync(resolvedSourcePkg, 'utf8'));

// 2. Update internal @a2ui dependencies
const updateInternalDeps = deps => {
  if (!deps) return;
  for (const name in deps) {
    const version = deps[name];
    if (version.startsWith('file:') && graph[name]) {
      deps[name] = '^' + graph[name].version;
    }
  }
};

updateInternalDeps(pkg.dependencies);
updateInternalDeps(pkg.peerDependencies);

// 3. Adjust paths
if (!skipPathAdjustment) {
  function adjustPath(p) {
    if (typeof p === 'string' && p.startsWith('./dist/')) {
      return './' + p.substring(7); // Remove ./dist/
    }
    return p;
  }

  pkg.main = adjustPath(pkg.main);
  pkg.module = adjustPath(pkg.module);
  pkg.types = adjustPath(pkg.types);

  if (pkg.exports) {
    for (const key in pkg.exports) {
      const exp = pkg.exports[key];
      if (typeof exp === 'string') {
        pkg.exports[key] = adjustPath(exp);
      } else {
        if (exp.types) exp.types = adjustPath(exp.types);
        if (exp.default) exp.default = adjustPath(exp.default);
        if (exp.import) {
          if (typeof exp.import === 'string') exp.import = adjustPath(exp.import);
          else {
            if (exp.import.types) exp.import.types = adjustPath(exp.import.types);
            if (exp.import.default) exp.import.default = adjustPath(exp.import.default);
          }
        }
        if (exp.require) {
          if (typeof exp.require === 'string') exp.require = adjustPath(exp.require);
          else {
            if (exp.require.types) exp.require.types = adjustPath(exp.require.types);
            if (exp.require.default) exp.require.default = adjustPath(exp.require.default);
          }
        }
      }
    }
  }
}

// 4. Clean up internal fields
delete pkg.scripts;
delete pkg.wireit;
delete pkg.files;
delete pkg.prepublishOnly;
delete pkg.devDependencies;

writeFileSync(join(resolvedDistDir, 'package.json'), JSON.stringify(pkg, null, 2));

// 5. Copy README and LICENSE
if (existsSync(join(packageDir, 'README.md'))) {
  copyFileSync(join(packageDir, 'README.md'), join(resolvedDistDir, 'README.md'));
}
const rootLicense = join(rootDir, 'LICENSE');
if (existsSync(rootLicense)) {
  copyFileSync(rootLicense, join(resolvedDistDir, 'LICENSE'));
}

console.log(`[prepare-publish] Prepared ${pkg.name} for publishing in ${distDir}/.`);
