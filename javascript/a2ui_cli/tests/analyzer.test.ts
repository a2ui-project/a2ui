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
import * as path from 'node:path';
import {Catalog} from '@a2ui/web_core/v0_9';
import {CatalogAnalyzer} from '../src/analyzer/catalog-analyzer.js';

describe('CatalogAnalyzer in @a2ui/cli', () => {
  const basicCatalogPath = path.resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const basicCatalogJson = JSON.parse(fs.readFileSync(basicCatalogPath, 'utf-8'));

  it('analyzes catalog components, slots, and properties', () => {
    const catalog = Catalog.fromSchema(basicCatalogJson);
    const analysed = CatalogAnalyzer.analyze(catalog);

    assert.strictEqual(
      analysed.catalogId,
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    );
    assert.strictEqual(analysed.specVersion, 'v0.9.1');
    assert.ok(analysed.components.size > 0);

    // Verify Text component
    const textComp = analysed.components.get('Text');
    assert.ok(textComp);
    assert.strictEqual(textComp.name, 'Text');
    assert.ok(textComp.properties.has('text'));
    const textProp = textComp.properties.get('text')!;
    assert.strictEqual(textProp.type.kind, 'dynamic');

    // Verify Row component has ChildList slot
    const rowComp = analysed.components.get('Row');
    assert.ok(rowComp);
    assert.ok(rowComp.properties.has('children'));
    const childrenProp = rowComp.properties.get('children')!;
    assert.strictEqual(childrenProp.type.kind, 'component_list');

    // Verify Button component has Action
    const btnComp = analysed.components.get('Button');
    assert.ok(btnComp);
    assert.ok(btnComp.properties.has('action'));
    const actionProp = btnComp.properties.get('action')!;
    assert.strictEqual(actionProp.type.kind, 'action');

    // Verify enums extracted
    assert.ok(analysed.enums.size > 0);
  });
});
