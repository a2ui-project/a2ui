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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Catalog} from './types.js';
import {extractCatalogMetadata} from './json_schema_loader.js';

describe('Catalog.fromJson & json_schema_loader', () => {
  const basicCatalogPath = resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const basicCatalogJson = JSON.parse(readFileSync(basicCatalogPath, 'utf-8'));

  it('extracts metadata and detects v0.9.1 version from URI', () => {
    const meta = extractCatalogMetadata(basicCatalogJson);
    assert.strictEqual(
      meta.catalogId,
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    );
    assert.strictEqual(meta.specVersion, 'v0.9');
  });

  it('throws error when protocol version cannot be determined and no default is allowed', () => {
    const invalidJson = {
      catalogId: 'https://example.com/custom_catalog.json',
      components: {},
    };
    assert.throws(
      () => extractCatalogMetadata(invalidJson),
      /A2UI protocol version must be explicitly specified/,
    );
  });

  it('respects explicit specVersion option override', () => {
    const invalidJson = {
      catalogId: 'https://example.com/custom_catalog.json',
      components: {},
    };
    const meta = extractCatalogMetadata(invalidJson, {specVersion: 'v0.9.1'});
    assert.strictEqual(meta.specVersion, 'v0.9.1');
  });

  it('loads basic catalog successfully into Catalog<ComponentApi>', () => {
    const catalog = Catalog.fromJson(basicCatalogJson, {specVersion: 'v0.9.1'});

    assert.strictEqual(
      catalog.id,
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    );
    assert.ok(catalog.components.size > 0);

    // Text component
    const textComp = catalog.components.get('Text');
    assert.ok(textComp);
    assert.strictEqual(textComp.name, 'Text');
    assert.ok(textComp.schema instanceof z.ZodObject);

    // Verify envelope fields ('component', 'id') are omitted
    const textShape = (textComp.schema as z.ZodObject<any>).shape;
    assert.strictEqual(textShape.id, undefined);
    assert.strictEqual(textShape.component, undefined);

    // Verify text property exists and validates strings & data bindings
    assert.ok(textShape.text);
    const validText = textComp.schema.safeParse({text: 'Hello World'});
    assert.strictEqual(validText.success, true);

    const validBinding = textComp.schema.safeParse({
      text: {path: '/user/name'},
    });
    assert.strictEqual(validBinding.success, true);

    // Row component with ChildList
    const rowComp = catalog.components.get('Row');
    assert.ok(rowComp);
    const rowShape = (rowComp.schema as z.ZodObject<any>).shape;
    assert.ok(rowShape.children);

    const validRowChildren = rowComp.schema.safeParse({
      children: ['comp1', 'comp2'],
    });
    assert.strictEqual(validRowChildren.success, true);

    // Button component with Action
    const btnComp = catalog.components.get('Button');
    assert.ok(btnComp);
    const btnShape = (btnComp.schema as z.ZodObject<any>).shape;
    assert.ok(btnShape.action);

    const validAction = btnComp.schema.safeParse({
      child: 'txt1',
      action: {event: {name: 'click_me'}},
    });
    assert.strictEqual(validAction.success, true);
  });

  it('parses functions from catalog into FunctionApi map', () => {
    const catalog = Catalog.fromJson(basicCatalogJson, {specVersion: 'v0.9.1'});
    assert.ok(catalog.functions.size > 0);

    const reqFn = catalog.functions.get('required');
    assert.ok(reqFn);
    assert.strictEqual(reqFn.name, 'required');
    assert.strictEqual(reqFn.returnType, 'boolean');
  });
});
