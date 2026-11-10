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

import {z} from 'zod';

import {basicCatalog as v10BasicCatalog} from '../catalogs/basic/v1/catalog.js';
import {
  Catalog,
  iframeUrl,
  mediaUrl,
  navigationUrl,
  scrapeSchemaBehavior,
  spec,
  URL_CONTEXT_KEYWORD,
  type ComponentApi,
} from '../index.js';
import {basicCatalog as v09BasicCatalog} from '../v0_9/basic_catalog/catalog.js';
import {DynamicStringSchema as V09DynamicStringSchema} from '../v0_9/schema/common-types.js';
import {urlContextOf} from './url_schema.js';

const CATALOG_ID = 'https://example.com/product/catalog.json';

const ProductCardApi = {
  name: 'ProductCard',
  schema: z.object({
    title: V09DynamicStringSchema,
    imageUrl: mediaUrl('Product photo.'),
    productPageUrl: navigationUrl().describe('Opened when the card is tapped.'),
    previewUrl: iframeUrl().optional(),
    gallery: z.array(z.object({imageUrl: mediaUrl()})).optional(),
  }),
} satisfies ComponentApi;

function properties(doc: Record<string, any>, component: string): Record<string, any> {
  return doc['components'][component]['properties'];
}

describe('URL schema helpers', () => {
  it('mark the schema with its URL context through describe and optional', () => {
    assert.strictEqual(urlContextOf(mediaUrl()), 'media');
    assert.strictEqual(urlContextOf(navigationUrl().describe('x')), 'navigation');
    assert.strictEqual(urlContextOf(iframeUrl().optional()), 'iframe');
    assert.strictEqual(urlContextOf(mediaUrl(undefined, V09DynamicStringSchema)), 'media');
  });

  it('keep the DynamicString reference when described with plain prose', () => {
    assert.strictEqual(
      mediaUrl().describe('Product photo.').description,
      'REF:#/$defs/DynamicString|Product photo.',
    );
    assert.strictEqual(
      mediaUrl('Product photo.').description,
      'REF:#/$defs/DynamicString|Product photo.',
    );
  });

  it('keep the DynamicString reference when the description is cleared', () => {
    const schema = mediaUrl('Product photo.').describe(undefined as unknown as string);
    assert.strictEqual(schema.description, 'REF:#/$defs/DynamicString');
    assert.strictEqual(urlContextOf(schema), 'media');
  });

  it('validate exactly as the base schema does', () => {
    const schema = mediaUrl();
    assert.ok(schema.safeParse('https://example.com/a.png').success);
    assert.ok(schema.safeParse({'@path': '/photo'}).success);
    assert.ok(!schema.safeParse(42).success);
  });

  it('leave the shared base schema unmarked', () => {
    mediaUrl(undefined, V09DynamicStringSchema);
    assert.strictEqual(urlContextOf(V09DynamicStringSchema), undefined);
  });

  it('record the URL context in the behavior tree, including nested props', () => {
    const tree = scrapeSchemaBehavior(ProductCardApi.schema);
    assert.ok(tree.type === 'OBJECT');
    assert.deepStrictEqual(tree.shape['imageUrl'], {type: 'DYNAMIC', urlContext: 'media'});
    assert.deepStrictEqual(tree.shape['productPageUrl'], {
      type: 'DYNAMIC',
      urlContext: 'navigation',
    });
    assert.deepStrictEqual(tree.shape['previewUrl'], {type: 'DYNAMIC', urlContext: 'iframe'});
    assert.deepStrictEqual(tree.shape['title'], {type: 'DYNAMIC'});
    const gallery = tree.shape['gallery'];
    assert.ok(gallery.type === 'ARRAY' && gallery.element.type === 'OBJECT');
    assert.deepStrictEqual(gallery.element.shape['imageUrl'], {
      type: 'DYNAMIC',
      urlContext: 'media',
    });
  });
});

describe('x-a2ui-url-context in catalog documents', () => {
  it('is written next to the $ref of a component defined from its Zod schema', () => {
    const doc = new Catalog(CATALOG_ID, '0.9', [ProductCardApi]).toJson();
    const props = properties(doc, 'ProductCard');
    assert.deepStrictEqual(props['imageUrl'], {
      $ref: 'common_types.json#/$defs/DynamicString',
      [URL_CONTEXT_KEYWORD]: 'media',
      description: 'Product photo.',
    });
    assert.strictEqual(props['productPageUrl'][URL_CONTEXT_KEYWORD], 'navigation');
    assert.strictEqual(props['previewUrl'][URL_CONTEXT_KEYWORD], 'iframe');
    assert.strictEqual(props['title'][URL_CONTEXT_KEYWORD], undefined);
    assert.strictEqual(
      props['gallery']['items']['properties']['imageUrl'][URL_CONTEXT_KEYWORD],
      'media',
    );
  });

  it('is written for a component in the specification layout', () => {
    const api = {
      name: 'Banner',
      schema: spec(z.object({src: mediaUrl('Banner image.')}).strict(), {mixins: []}),
    } satisfies ComponentApi;
    const doc = new Catalog(CATALOG_ID, '1.0', [api]).toJson();
    assert.deepStrictEqual(properties(doc, 'Banner')['src'], {
      $ref: 'common_types.json#/$defs/DynamicString',
      [URL_CONTEXT_KEYWORD]: 'media',
      description: 'Banner image.',
    });
  });

  it('is read back by the loader, so JSON-defined catalogs keep their URL props', () => {
    const doc = new Catalog(CATALOG_ID, '0.9', [ProductCardApi]).toJson();
    const loaded = Catalog.fromJson(doc);
    const schema = loaded.components.get('ProductCard')!.schema;
    const tree = scrapeSchemaBehavior(schema);
    assert.ok(tree.type === 'OBJECT');
    assert.strictEqual((tree.shape['imageUrl'] as {urlContext?: string}).urlContext, 'media');
    assert.strictEqual(
      (tree.shape['productPageUrl'] as {urlContext?: string}).urlContext,
      'navigation',
    );
    assert.strictEqual((tree.shape['title'] as {urlContext?: string}).urlContext, undefined);
    const gallery = tree.shape['gallery'];
    assert.ok(gallery.type === 'ARRAY' && gallery.element.type === 'OBJECT');
    assert.strictEqual(
      (gallery.element.shape['imageUrl'] as {urlContext?: string}).urlContext,
      'media',
    );
    assert.deepStrictEqual(loaded.toJson(), doc);
  });

  it('reads `none` as an explicit statement that a property is not a URL', () => {
    const loaded = Catalog.fromJson({
      catalogId: CATALOG_ID,
      protocolVersion: '1.0',
      components: {
        Link: {
          type: 'object',
          properties: {
            component: {const: 'Link'},
            urlLabel: {
              $ref: 'common_types.json#/$defs/DynamicString',
              [URL_CONTEXT_KEYWORD]: 'none',
            },
          },
          required: ['component'],
        },
      },
    });
    const tree = scrapeSchemaBehavior(loaded.components.get('Link')!.schema);
    assert.ok(tree.type === 'OBJECT');
    assert.strictEqual((tree.shape['urlLabel'] as {urlContext?: string}).urlContext, 'none');
  });

  it('is not written into the basic catalog documents', () => {
    for (const catalog of [v09BasicCatalog, v10BasicCatalog]) {
      assert.ok(!JSON.stringify(catalog.toJson()).includes(URL_CONTEXT_KEYWORD), catalog.id);
    }
  });
});
