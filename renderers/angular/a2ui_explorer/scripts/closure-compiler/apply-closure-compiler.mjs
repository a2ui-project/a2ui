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
const distDir = path.resolve(__dirname, '../../dist/browser');

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

  // Fix Lit reactive-element free variable `litPropertyMetadata` for Closure Compiler.
  // Using bracket notation `globalThis['litPropertyMetadata']` prevents Closure Compiler in ADVANCED
  // mode from renaming or tree-shaking the global WeakMap instance used by Lit property metadata,
  // and lazy initialization ensures `.get(t)` never throws if statement order is reordered.
  if (c.includes('litPropertyMetadata')) {
    c = c.replace(
      /[a-zA-Z0-9_$]+\.litPropertyMetadata\s*\?\?=\s*new\s+WeakMap/g,
      "globalThis['litPropertyMetadata'] = globalThis['litPropertyMetadata'] || new WeakMap",
    );
    c = c.replace(
      /(?<!\.)\blitPropertyMetadata\.get\(/g,
      "(globalThis['litPropertyMetadata'] = globalThis['litPropertyMetadata'] || new WeakMap()).get(",
    );
    c = c.replace(
      /(?<!\['|\w)\b(?:[a-zA-Z0-9_$]+\.)?litPropertyMetadata\b(?!'\])/g,
      "globalThis['litPropertyMetadata']",
    );
    changed = true;
  }

  // Fix TS 5 auto-accessor WeakMap storage bug where WeakMap storage `e` is assigned after `class` declaration
  // but accessed by `super()` in constructor. Replacing `[var].get(this)` / `[var].set(this)` / `[var].has(this)`
  // or TS private field helpers `helper(this, varName, "f")` with `(varName = varName || new WeakMap())`
  // ensures storage is initialized on demand.
  let nextWeakMap = c.replace(
    /(?<!\.)\b(?!(?:this|super)\b)([a-zA-Z0-9_$]+)\.(get|set|has)\(this\b/g,
    '($1 = $1 || new WeakMap()).$2(this',
  );
  nextWeakMap = nextWeakMap.replace(
    /\b([a-zA-Z0-9_$]+)\(this,\s*([a-zA-Z0-9_$]+),\s*"f"\)/g,
    '$1(this, ($2 = $2 || new WeakMap()), "f")',
  );
  nextWeakMap = nextWeakMap.replace(
    /\b([a-zA-Z0-9_$]+)\(this,\s*([a-zA-Z0-9_$]+),\s*([^,]+),\s*"f"\)/g,
    '$1(this, ($2 = $2 || new WeakMap()), $3, "f")',
  );
  if (nextWeakMap !== c) {
    c = nextWeakMap;
    changed = true;
  }

  // Fix TS 5 auto-accessor private field brand check throwing during super() constructor execution.
  // When super() runs, Lit accesses auto-accessors before private field WeakMap initializers run.
  // Replacing private field brand check exceptions with `return void 0` allows super() constructor execution to finish cleanly.
  if (c.includes('Cannot read private member')) {
    c = c.replace(
      /throw\s+new\s+TypeError\((['"])Cannot read private member from an object whose class did not declare it\1\)/g,
      'return void 0',
    );
    changed = true;
  }
  if (c.includes('Cannot write private member')) {
    c = c.replace(
      /throw\s+new\s+TypeError\((['"])Cannot write private member to an object whose class did not declare it\1\)/g,
      'return void 0',
    );
    changed = true;
  }

  // Quote TC39 2023 decorator context object keys so Closure Compiler ADVANCED mode does not rename them
  c = c.replace(/\{(\s*)kind:\s*("(?:accessor|field|method|getter|setter)")/g, '{$1"kind":$2');
  c = c.replace(/,\s*name:\s*/g, ',"name":');
  c = c.replace(/,\s*static:\s*/g, ',"static":');
  c = c.replace(/,\s*private:\s*/g, ',"private":');
  c = c.replace(/,\s*access:\s*\{/g, ',"access":{');
  c = c.replace(/,\s*metadata:\s*/g, ',"metadata":');

  // Ensure TS decorator helper initializes fallback getters/setters forwarding to context.access
  c = c.replace(
    /kind\s*===\s*"accessor"\s*\?\s*\{\s*get:\s*descriptor\.get\s*,\s*set:\s*descriptor\.set\s*\}/g,
    'kind === "accessor" ? { get: descriptor.get || (descriptor.get = function() { return context2.access.get(this); }), set: descriptor.set || (descriptor.set = function(v) { context2.access.set(this, v); }) }',
  );
  c = c.replace(
    /b\s*=\s*b\s*\|\|\s*\(\s*a\s*\?\s*Object\.getOwnPropertyDescriptor\(\s*a\s*,\s*d\.name\s*\)\s*:\s*\{\}\s*\)/g,
    'b = b || (a && Object.getOwnPropertyDescriptor(a, d.name)) || {}',
  );
  c = c.replace(
    /h\s*===\s*"accessor"\s*\?\s*\{\s*get:\s*b\.get\s*,\s*set:\s*b\.set\s*\}/g,
    'h === "accessor" ? { get: b.get || (b.get = function() { return (p?.access || p?.a)?.get?.(this); }), set: b.set || (b.set = function(v) { (p?.access || p?.a)?.set?.(this, v); }) }',
  );

  // Fix TS auto-accessor WeakMap getters and setters so setters set values even before initializers run
  c = c.replace(
    /\(typeof\s+([a-zA-Z0-9_$]+)==="function"\?0:\1\.has\(this\)\)\?\1\.get\(this\):void 0/g,
    '$1.get(this)',
  );
  c = c.replace(
    /\(typeof\s+([a-zA-Z0-9_$]+)==="function"\?0:\1\.has\(this\)\)&&\1\.set\(this,\s*([a-zA-Z0-9_$]+)\)/g,
    '$1.set(this, $2)',
  );

  // Ensure TS decorator helper XE checks t !== void 0 before calling g(t.get)
  c = c.replace(
    /if\(t!==void 0\)\{if\(t===null\|\|typeof t!=="object"\)throw new TypeError\("Object expected"\);if\(l=g\(t\.get\)\)/g,
    'if(t!==void 0&&t!==null){if(typeof t!=="object")throw new TypeError("Object expected");if(l=g(t.get))',
  );

  // Safe fallback for Lit directive constructor resultType check in Closure Compiler minified bundle
  if (c.includes('this.constructor.resultType')) {
    c = c.replace(
      /this\.constructor\.resultType\s*===\s*void 0/g,
      '(this.constructor.resultType || 1) === void 0',
    );
    changed = true;
  }

  // Safe fallback for Lit DEV_MODE enabledWarnings check in Closure Compiler minified bundle
  if (c.includes('this.constructor.enabledWarnings')) {
    c = c.replace(
      /this\.constructor\.enabledWarnings\.includes/g,
      '(this.constructor.enabledWarnings||[]).includes',
    );
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

const cwd = process.cwd();
const options = {
  js: files.map(f => path.relative(cwd, f)),
  compilation_level: 'ADVANCED',
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT_NEXT',
  charset: 'UTF-8',
  js_output_file: path.relative(cwd, tmpPath),
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
  options.externs = activeExterns.map(p => path.relative(cwd, p));
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

      // Post-process compiled bundle to patch TS/Closure decorator helper for auto-accessors
      let compiled = fs.readFileSync(mainFile, 'utf8');
      compiled = compiled.replace(
        /b\s*=\s*b\s*\|\|\s*\(\s*a\s*\?\s*Object\.getOwnPropertyDescriptor\(\s*a\s*,\s*d\.name\s*\)\s*:\s*\{\}\s*\)/g,
        'b = b || (a && Object.getOwnPropertyDescriptor(a, d.name)) || {}',
      );
      compiled = compiled.replace(
        /h\s*===\s*"accessor"\s*\?\s*\{\s*get:\s*b\.get\s*,\s*set:\s*b\.set\s*\}/g,
        'h === "accessor" ? { get: b.get || (b.get = function() { return (p?.access || p?.a)?.get?.(this); }), set: b.set || (b.set = function(v) { (p?.access || p?.a)?.set?.(this, v); }) }',
      );
      compiled = compiled.replace(
        /\(typeof\s+([a-zA-Z0-9_$]+)==="function"\?0:\1\.has\(this\)\)\?\1\.get\(this\):void 0/g,
        '$1.get(this)',
      );
      compiled = compiled.replace(
        /\(typeof\s+([a-zA-Z0-9_$]+)==="function"\?0:\1\.has\(this\)\)&&\1\.set\(this,\s*([a-zA-Z0-9_$]+)\)/g,
        '$1.set(this, $2)',
      );
      compiled = compiled.replace(
        /throw\s+new\s+TypeError\((['"])Cannot read private member from an object whose class did not declare it\1\)/g,
        'return void 0',
      );
      compiled = compiled.replace(
        /throw\s+new\s+TypeError\((['"])Cannot write private member to an object whose class did not declare it\1\)/g,
        'return void 0',
      );
      fs.writeFileSync(mainFile, compiled, 'utf8');

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
