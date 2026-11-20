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
 * Community samples may alias `@a2ui/*` packages to the monorepo's build
 * output while those packages are not yet published (see
 * https://github.com/a2ui-project/a2ui/issues/1698). `Community Code CI`
 * (`.github/workflows/community_code.yml`) builds a fixed set of monorepo
 * packages before building the samples, so an alias into any other package
 * works on a developer machine that happens to have built it and fails in
 * CI, or, worse, only fails on `main` after an unrelated renderer change
 * (https://github.com/a2ui-project/a2ui/pull/4283).
 *
 * This test fails when a community sample's TypeScript or Vite configuration
 * refers to a monorepo package that the workflow does not build.
 */

import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES_ROOT = join(REPO_ROOT, 'samples', 'community');

/**
 * Monorepo packages that both "Build @a2ui/catalog-mcp and @a2ui/lit from
 * the monorepo workspace" steps in `community_code.yml` build (directly or
 * as a wireit dependency). Extend the workflow steps and this list together.
 */
const BUILT_BY_COMMUNITY_WORKFLOW = [
  'typescript/catalogs/mcp',
  'typescript/core/web_core',
  'typescript/renderers/lit',
];

const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  '.angular',
  '.git',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
]);
const CONFIG_FILE_RE = /^(tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s)$/;

/**
 * A monorepo package directory, `typescript/<group>/<name>`, as it appears
 * inside a path string. The `../` prefix is deliberately not required: the
 * Vite configs keep it in a separate template literal.
 */
const PACKAGE_REF_RE = /typescript\/[^/'"`\s]+\/[^/'"`\s]+/g;

/** Recursively lists config files under `dir`, skipping build output. */
function findConfigFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        found.push(...findConfigFiles(join(dir, entry.name)));
      }
    } else if (CONFIG_FILE_RE.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Removes `//` and `/* *\/` comments while skipping quoted string literals so
 * prose mentions do not count and wildcards (`"@a2ui/angular/*"`) or URLs
 * (`"https://..."`) inside strings are preserved.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') {
          i++;
        }
        i++;
      }
      if (i < text.length) {
        i++;
      }
      out += text.slice(start, i);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i += 2;
      out += ' ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Returns the distinct monorepo package directories referenced by `file`. */
function monorepoPackageRefs(file) {
  const text = stripComments(readFileSync(file, 'utf8'));
  return [...new Set(text.match(PACKAGE_REF_RE) ?? [])];
}

const configFiles = findConfigFiles(SAMPLES_ROOT).sort();
const refsByFile = new Map(
  configFiles.map(file => [relative(REPO_ROOT, file), monorepoPackageRefs(file)]),
);

describe('stripComments', () => {
  it('preserves wildcard paths inside quoted strings', () => {
    const input = [
      '{',
      '  "paths": {',
      '    "@a2ui/angular/*": ["../../../../typescript/renderers/angular/dist/*"]',
      '  },',
      '  "include": ["src/**/*.ts"]',
      '}',
    ].join('\n');
    const stripped = stripComments(input);
    assert.deepEqual(stripped.match(PACKAGE_REF_RE), ['typescript/renderers/angular']);
  });

  it('preserves protocol URLs and trailing aliases on the same line', () => {
    const input =
      "const url = 'https://example.com'; const p = `typescript/renderers/angular/dist`;";
    const stripped = stripComments(input);
    assert.deepEqual(stripped.match(PACKAGE_REF_RE), ['typescript/renderers/angular']);
  });

  it('strips line and block comments while respecting escaped quotes', () => {
    const input = [
      'const note = "escaped \\" // typescript/renderers/lit/dist"; // typescript/renderers/angular/dist',
      '/* multi-line comment',
      '   typescript/renderers/react/dist */',
      'const kept = "typescript/core/web_core/dist";',
    ].join('\n');
    const stripped = stripComments(input);
    assert.deepEqual(stripped.match(PACKAGE_REF_RE), [
      'typescript/renderers/lit',
      'typescript/core/web_core',
    ]);
  });
});

describe('community sample aliases into the monorepo', () => {
  it('finds the sample configs and the known aliases', () => {
    assert.ok(configFiles.length > 0, `no config files under ${SAMPLES_ROOT}`);
    const filesWithRefs = [...refsByFile].filter(([, refs]) => refs.length > 0);
    assert.ok(
      filesWithRefs.some(([file]) => /tsconfig[^/]*\.json$/.test(file)),
      'expected at least one tsconfig to reference a monorepo package',
    );
    assert.ok(
      filesWithRefs.some(([file]) => /vite\.config\./.test(file)),
      'expected at least one vite config to reference a monorepo package',
    );
  });

  for (const [file, refs] of refsByFile) {
    if (refs.length === 0) {
      continue;
    }
    it(`${file} only aliases packages Community Code CI builds`, () => {
      for (const ref of refs) {
        assert.ok(
          BUILT_BY_COMMUNITY_WORKFLOW.includes(ref),
          `${file}: references ${ref}, which community_code.yml does not build;` +
            ' add it to both "Build @a2ui/catalog-mcp and @a2ui/lit from the' +
            ' monorepo workspace" steps and to BUILT_BY_COMMUNITY_WORKFLOW in' +
            ' scripts/community_sample_aliases.test.mjs, or drop the alias',
        );
      }
    });
  }
});
