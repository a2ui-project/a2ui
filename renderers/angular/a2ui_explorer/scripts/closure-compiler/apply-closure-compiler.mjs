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

/**
 * apply-closure-compiler.mjs
 *
 * Pre-processes modern Angular CLI (Ivy + esbuild) build output and compiles the
 * production bundle using the Google Closure Compiler in ADVANCED mode.
 *
 * Why this script is required instead of standard google-closure-compiler-cli:
 * Since native Closure Compiler support was removed in Angular v13+, feeding standard
 * Angular CLI bundles directly into Closure Compiler's ADVANCED mode breaks the runtime.
 * This script performs essential preprocessing regular expressions on Ivy instructions,
 * metadata, and static properties before compilation, and merges dynamic chunk outputs.
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist/a2ui_explorer/browser');

console.log('Starting Google Closure Compiler pipeline for Angular production bundle...');

if (!fs.existsSync(distDir)) {
  console.error(`Error: Bundle directory not found at ${distDir}`);
  process.exit(1);
}

const {compiler: Compiler} = require('google-closure-compiler');
const files = fs
  .readdirSync(distDir)
  .filter(f => f.endsWith('.js') && !f.endsWith('.tmp'))
  .map(f => path.join(distDir, f));

if (files.length === 0) {
  console.error('Error: No JavaScript bundle chunks found in ' + distDir);
  process.exit(1);
}

console.log(`Preprocessing ${files.length} bundle chunks for ADVANCED mode compatibility...`);

for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;

  // 1. Strip /* @__PURE__ */ annotations before Ivy instruction calls (\u0275 or ɵ).
  // Why: In ADVANCED mode, Closure Compiler sees /* @__PURE__ */ on static property assignments
  // (e.g. MyComp.ɵcmp = /* @__PURE__ */ ɵɵdefineComponent(...)) and assumes they have no
  // side effects, aggressively pruning or reordering them and breaking component registration.
  if (c.includes('@__PURE__')) {
    c = c.replace(/\/\*\s*@__PURE__\s*\*\/\s*(?=\\u0275|ɵ)/g, '');
    changed = true;
  }

  // 2. Inject explicit `var ngDevMode = false;`.
  // Why: Ensures Closure Compiler can effectively tree-shake and dead-code eliminate Angular's
  // development-mode debugging branches and utilities.
  if (!c.includes('var ngDevMode = false')) {
    c = 'var ngDevMode = false;\n' + c;
    changed = true;
  }

  // 3. Inject /** @nocollapse */ onto static Ivy fields (static ɵcmp, ɵfac, __NG_ELEMENT_ID__, etc.).
  // Why: Closure Compiler normally "collapses" static properties, flattening Class.prop into global
  // variables (Class$prop) to compress names. If it collapses Ivy definitions off class constructors,
  // Angular's runtime dependency injection and component resolvers cannot inspect class definitions.
  let next = c.replace(
    /static\s+(?:\\u0275|ɵ|__NG_)([a-zA-Z0-9_$]+)/g,
    m => '/** @nocollapse */ ' + m,
  );
  if (next !== c) {
    c = next;
    changed = true;
  }

  // 4. Pin class metadata and Ivy properties before setClassMetadata runs.
  // Why: Closure Compiler will dead-code-eliminate or rename internal Ivy properties if it doesn't see
  // explicit external references to them. This injects a dummy window reference to mark Ivy properties
  // as externally reachable symbols so Closure preserves their names and structures.
  next = c.replace(
    /&&\s*setClassMetadata\(([a-zA-Z0-9_$]+),/g,
    (m, cls) =>
      `&& (window['__k']=[${cls}.\\u0275cmp,${cls}.\\u0275fac,${cls}.\\u0275dir,${cls}.\\u0275pipe,${cls}.\\u0275mod,${cls}.\\u0275inj,${cls}.\\u0275prov,${cls}.__NG_ELEMENT_ID__,${cls}.__NG_ENV_ID__]) && setClassMetadata(${cls},`,
  );
  if (next !== c) {
    c = next;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(f, c, 'utf8');
  }
}

// Locate main chunk file to serve as the target output bundle.
const mainFile =
  files.find(f => path.basename(f).startsWith('main')) || path.join(distDir, 'main.js');
const tmpPath = mainFile + '.tmp';

console.log(
  `Compiling ${files.length} chunk files into ${path.basename(mainFile)} with Google Closure Compiler (ADVANCED mode)...`,
);

const options = {
  js: files,
  compilation_level: 'ADVANCED',
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT_NEXT',
  charset: 'UTF-8',
  js_output_file: tmpPath,
  warning_level: 'QUIET',
};

const activeExterns = [
  path.resolve(__dirname, 'externs/globals.externs.js'),
  path.resolve(__dirname, 'externs/a2ui_web_core_v0_9.externs.js'),
  path.resolve(__dirname, 'externs/angular_framework.externs.js'),
  path.resolve(__dirname, 'externs/a2ui_explorer.externs.js'),
];

for (const p of activeExterns) {
  if (!fs.existsSync(p)) {
    throw new Error('Required externs file not found: ' + p);
  }
}

if (activeExterns.length > 0) {
  options.externs = activeExterns;
}

await new Promise((resolve, reject) => {
  const compilerInstance = new Compiler(options);
  compilerInstance.run((exitCode, stdout, stderr) => {
    if (exitCode !== 0) {
      console.error('Closure Compiler compilation error:', stderr || stdout);
      reject(new Error('Closure Compiler compilation failed'));
    } else {
      // Replace main file with the compiled bundle
      fs.renameSync(tmpPath, mainFile);

      // Stub out non-main chunk files with dummy comments so browser loading of leftover chunk tags succeeds
      for (const file of files) {
        if (file !== mainFile) {
          fs.writeFileSync(file, '/* compiled into main */\n', 'utf8');
        }
      }
      resolve();
    }
  });
});

console.log('Google Closure Compiler compilation complete.');
