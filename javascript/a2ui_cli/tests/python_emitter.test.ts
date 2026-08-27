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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {Catalog} from '@a2ui/web_core/v0_9';
import {CatalogAnalyzer} from '../src/analyzer/catalog-analyzer.js';
import {PythonEmitter} from '../src/emitters/python/python-emitter.js';

describe('PythonEmitter in @a2ui/cli', () => {
  const basicCatalogPath = path.resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const basicCatalogJson = JSON.parse(fs.readFileSync(basicCatalogPath, 'utf-8'));

  it('emits python builder files with dataclass components and to_dict', () => {
    const catalog = Catalog.fromJson(basicCatalogJson, {specVersion: 'v0.9.1'});
    const analysed = CatalogAnalyzer.analyze(catalog);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-cli-test-'));
    try {
      const emitter = new PythonEmitter(analysed);
      const written = emitter.emit(tmpDir);

      assert.strictEqual(written.length, 5);

      const compContent = fs.readFileSync(path.join(tmpDir, 'components.py'), 'utf-8');
      assert.ok(compContent.includes('class Button(ComponentBuilderNode):'));
      assert.ok(compContent.includes('class Text(ComponentBuilderNode):'));
      assert.ok(compContent.includes('class Row(ComponentBuilderNode):'));
      assert.ok(compContent.includes('def to_dict(self) -> dict[str, Any]:'));

      const typesContent = fs.readFileSync(path.join(tmpDir, 'types.py'), 'utf-8');
      assert.ok(typesContent.includes('Literal['));

      const initContent = fs.readFileSync(path.join(tmpDir, '__init__.py'), 'utf-8');
      assert.ok(initContent.includes('from .components import *'));
      assert.ok(initContent.includes('from .types import *'));
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });
});
