/*
 * Copyright 2026 Google LLC
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

import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  BOUNDARY_ALLOWLIST as ANGULAR_ALLOWLIST,
  BOUNDARY_RESTRICTED as ANGULAR_RESTRICTED,
} from '../typescript/renderers/angular/eslint.boundary.mjs';
import {
  BOUNDARY_ALLOWLIST as REACT_ALLOWLIST,
  BOUNDARY_RESTRICTED as REACT_RESTRICTED,
} from '../typescript/renderers/react/eslint.boundary.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = [
  {
    name: '@a2ui/react',
    dir: resolve(REPO_ROOT, 'typescript/renderers/react'),
    allowlist: REACT_ALLOWLIST,
    restricted: REACT_RESTRICTED,
    baseline: 4,
  },
  {
    name: '@a2ui/angular',
    dir: resolve(REPO_ROOT, 'typescript/renderers/angular'),
    allowlist: ANGULAR_ALLOWLIST,
    restricted: ANGULAR_RESTRICTED,
    baseline: 4,
  },
];

function importsRestrictedSymbol(source, restricted) {
  const escapedFrom = restricted.from
    .map(mod => mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const importRegex = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]+)\\}\\s+from\\s+['"](?:${escapedFrom})['"]`,
    'g',
  );
  for (const match of source.matchAll(importRegex)) {
    const specifiers = match[1]
      .split(',')
      .map(s =>
        s
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean);
    if (specifiers.some(spec => restricted.names.includes(spec))) {
      return true;
    }
  }
  return false;
}

describe('adapter boundary allowlist ratchet', () => {
  for (const pkg of PACKAGES) {
    describe(pkg.name, () => {
      it(`allowlist size does not exceed baseline (${pkg.baseline})`, () => {
        assert.ok(
          pkg.allowlist.length <= pkg.baseline,
          `${pkg.name} BOUNDARY_ALLOWLIST grew to ${pkg.allowlist.length} (baseline: ${pkg.baseline})`,
        );
      });

      it('contains no duplicate entries', () => {
        const unique = new Set(pkg.allowlist);
        assert.equal(
          unique.size,
          pkg.allowlist.length,
          `${pkg.name} has duplicate allowlist entries`,
        );
      });

      for (const relPath of pkg.allowlist) {
        it(`${relPath} exists and still imports a restricted symbol`, () => {
          const fullPath = resolve(pkg.dir, relPath);
          assert.ok(
            existsSync(fullPath),
            `${pkg.name} allowlisted file does not exist: ${relPath} (remove it from BOUNDARY_ALLOWLIST)`,
          );
          const content = readFileSync(fullPath, 'utf8');
          assert.ok(
            importsRestrictedSymbol(content, pkg.restricted),
            `${pkg.name} allowlisted file ${relPath} no longer imports any of [${pkg.restricted.names.join(', ')}]; remove it from BOUNDARY_ALLOWLIST`,
          );
        });
      }
    });
  }
});
