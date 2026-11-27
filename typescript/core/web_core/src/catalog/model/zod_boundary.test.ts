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

import assert from 'node:assert';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {describe, it} from 'node:test';

const ZOD_IMPORT_RE =
  /^\s*import\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"](?:zod|zod-to-json-schema)['"]/gm;

function collectTsFiles(dir: string, skipTests: boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectTsFiles(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      if (skipTests && (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts'))) {
        continue;
      }
      results.push(full);
    }
  }
  return results;
}

function assertNoZodImports(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const matches = content.match(ZOD_IMPORT_RE);
  assert.strictEqual(
    matches,
    null,
    `Expected zero zod/zod-to-json-schema imports in ${filePath}, found: ${matches?.join(', ')}`,
  );
}

describe('Zod architectural dependency boundary', () => {
  const webCoreRoot = process.cwd();
  const repoRoot = resolve(webCoreRoot, '../../..');

  it('keeps src/catalog/model/* 100% free of zod and zod-to-json-schema imports', () => {
    const modelFiles = collectTsFiles(join(webCoreRoot, 'src/catalog/model'), true);
    assert.ok(modelFiles.length >= 7, 'expected canonical model modules');
    for (const file of modelFiles) {
      assertNoZodImports(file);
    }
  });

  it('keeps decoupled core processing, validation, and resolution modules free of zod imports', () => {
    const decoupledFiles = [
      'src/catalog/legacy_schema_adapter.ts',
      'src/catalog/pick_component_api_fields.ts',
      'src/processing/wire-validators.ts',
      'src/processing/format-zod-issue.ts',
      'src/processing/message-error-mapper.ts',
      'src/processing/message-processor.ts',
      'src/processing/adapters/base.ts',
      'src/processing/adapters/v0_9.ts',
      'src/processing/adapters/v1_0.ts',
      'src/validation/payload-validator.ts',
      'src/resolution/node-resolver.ts',
      'src/resolution/generic-binder.ts',
      'src/resolution/data-context.ts',
    ];
    for (const rel of decoupledFiles) {
      assertNoZodImports(join(webCoreRoot, rel));
    }
  });

  it('keeps @a2ui/agent/src/** 100% free of zod and zod-to-json-schema imports', () => {
    const agentSrcDir = join(repoRoot, 'typescript/agents/a2ui_agent/src');
    const agentFiles = collectTsFiles(agentSrcDir, true);
    assert.ok(agentFiles.length > 20, 'expected @a2ui/agent source files');
    for (const file of agentFiles) {
      assertNoZodImports(file);
    }
  });
});
