/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';

/** The packages web_core must not import or depend on. */
const ZOD_PACKAGES = ['zod', 'zod-to-json-schema', 'json-schema-to-zod'];

/** Matches an import, re-export or dynamic import of one of the packages. */
const ZOD_IMPORT = new RegExp(
  String.raw`(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](?:${ZOD_PACKAGES.join('|')})(?:/[^'"]*)?['"]`,
);

/** Every TypeScript file under `dir`, recursively. */
function typeScriptFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(path);
    return /\.(?:ts|mts|cts)$/.test(entry.name) ? [path] : [];
  });
}

// Tests run from the package directory, on the compiled files in `dist`; the
// sources are read from `src`.
const PACKAGE_DIR = process.cwd();

describe('web_core without zod', () => {
  it('imports no zod package in any source or test file', () => {
    const files = typeScriptFiles(join(PACKAGE_DIR, 'src'));
    assert.ok(files.length > 100, `expected the source tree, found ${files.length} files`);
    // This file names the packages in the patterns it checks.
    const offenders = files.filter(
      file => !file.endsWith('no-zod.test.ts') && ZOD_IMPORT.test(readFileSync(file, 'utf-8')),
    );
    assert.deepStrictEqual(offenders, []);
  });

  it('declares no zod package as a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8')) as Record<
      string,
      unknown
    >;
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const deps = Object.keys((pkg[field] as Record<string, string> | undefined) ?? {});
      assert.deepStrictEqual(
        deps.filter(dep => ZOD_PACKAGES.includes(dep)),
        [],
        `${field} lists a zod package`,
      );
    }
  });

  it('recognizes the imports it guards against', () => {
    for (const source of [
      "import {z} from 'zod';",
      "import type {z} from 'zod';",
      "export {z} from 'zod';",
      "import {zodToJsonSchema} from 'zod-to-json-schema';",
      "const m = await import('json-schema-to-zod');",
      "import 'zod/v4';",
    ]) {
      assert.ok(ZOD_IMPORT.test(source), source);
    }
    assert.ok(!ZOD_IMPORT.test("import {fromZod3} from '@a2ui/schema-zod3';"));
  });
});
