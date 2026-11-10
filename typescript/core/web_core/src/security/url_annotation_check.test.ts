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
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it, mock} from 'node:test';

import {Catalog} from '../index.js';
import {findUrlAnnotationProblems, looksLikeUrlProperty} from './url_annotation_check.js';

const DYNAMIC_STRING = {$ref: 'common_types.json#/$defs/DynamicString'};
const V09_BASIC_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const V10_BASIC_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

function catalog(components: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {catalogId: 'urn:test', components, ...extra};
}

describe('looksLikeUrlProperty', () => {
  it('matches URL-like names', () => {
    for (const name of ['url', 'uri', 'href', 'src', 'imageUrl', 'avatarURL', 'resourceUri']) {
      assert.ok(looksLikeUrlProperty(name), name);
    }
    assert.ok(looksLikeUrlProperty('image_url'));
  });

  it('does not match other names', () => {
    for (const name of ['urlLabel', 'title', 'source', 'curl', 'hrefs', 'Url', 'uriScheme']) {
      assert.ok(!looksLikeUrlProperty(name), name);
    }
  });
});

describe('findUrlAnnotationProblems', () => {
  it('reports an unmarked URL property', () => {
    assert.deepStrictEqual(
      findUrlAnnotationProblems(
        catalog({ProductCard: {properties: {title: DYNAMIC_STRING, imageUrl: DYNAMIC_STRING}}}),
      ),
      ['ProductCard.imageUrl: no x-a2ui-url-context'],
    );
  });

  it('accepts every known mark, including none', () => {
    for (const mark of ['media', 'navigation', 'iframe', 'none']) {
      assert.deepStrictEqual(
        findUrlAnnotationProblems(
          catalog({
            Card: {properties: {imageUrl: {...DYNAMIC_STRING, 'x-a2ui-url-context': mark}}},
          }),
        ),
        [],
      );
    }
  });

  it('reports an unknown mark on any property', () => {
    assert.deepStrictEqual(
      findUrlAnnotationProblems(
        catalog({
          Card: {
            properties: {
              imageUrl: {type: 'string', 'x-a2ui-url-context': 'image'},
              title: {type: 'string', 'x-a2ui-url-context': true},
            },
          },
        }),
      ),
      [
        'Card.imageUrl: unknown x-a2ui-url-context value "image"',
        'Card.title: unknown x-a2ui-url-context value true',
      ],
    );
  });

  it('skips properties that cannot hold a string', () => {
    assert.deepStrictEqual(
      findUrlAnnotationProblems(
        catalog({
          Card: {
            properties: {
              imageUrl: {type: 'object', properties: {}},
              src: {type: ['array', 'null']},
              href: {type: ['string', 'null']},
            },
          },
        }),
      ),
      ['Card.href: no x-a2ui-url-context'],
    );
  });

  it('walks nested objects, arrays, combinators, and local refs', () => {
    assert.deepStrictEqual(
      findUrlAnnotationProblems(
        catalog(
          {
            Gallery: {
              allOf: [
                {$ref: '#/$defs/Common'},
                {
                  properties: {
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          thumbnailUrl: DYNAMIC_STRING,
                          link: {oneOf: [{type: 'object', properties: {href: DYNAMIC_STRING}}]},
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
          {$defs: {Common: {properties: {src: DYNAMIC_STRING}}}},
        ),
      ),
      [
        'Gallery.src: no x-a2ui-url-context',
        'Gallery.items[].thumbnailUrl: no x-a2ui-url-context',
        'Gallery.items[].link.href: no x-a2ui-url-context',
      ],
    );
  });

  it('follows a recursive ref once', () => {
    assert.deepStrictEqual(
      findUrlAnnotationProblems(
        catalog(
          {Tree: {$ref: '#/$defs/Node'}},
          {
            $defs: {
              Node: {
                properties: {
                  iconUrl: DYNAMIC_STRING,
                  children: {type: 'array', items: {$ref: '#/$defs/Node'}},
                },
              },
            },
          },
        ),
      ),
      ['Tree.iconUrl: no x-a2ui-url-context'],
    );
  });

  it('lets the built-in list cover the basic catalogs only', () => {
    const components = {
      Image: {properties: {url: DYNAMIC_STRING}},
      Video: {properties: {url: DYNAMIC_STRING, posterUrl: DYNAMIC_STRING}},
    };
    assert.deepStrictEqual(findUrlAnnotationProblems(catalog(components), V10_BASIC_ID), []);
    assert.deepStrictEqual(findUrlAnnotationProblems({catalogId: V09_BASIC_ID, components}), []);
    assert.deepStrictEqual(findUrlAnnotationProblems(catalog(components)), [
      'Image.url: no x-a2ui-url-context',
      'Video.url: no x-a2ui-url-context',
      'Video.posterUrl: no x-a2ui-url-context',
    ]);
  });

  it('ignores functions', () => {
    assert.deepStrictEqual(
      findUrlAnnotationProblems(
        catalog({}, {functions: {openUrl: {properties: {args: {properties: {url: {}}}}}}}),
      ),
      [],
    );
  });

  it('finds nothing in the published basic catalogs', () => {
    for (const path of [
      '../../../catalogs/basic/v1/catalog.json',
      '../../../specification/v0_9/catalogs/basic/catalog.json',
    ]) {
      const document = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
      assert.deepStrictEqual(findUrlAnnotationProblems(document), [], path);
    }
  });
});

describe('Catalog.fromJson URL annotation warning', () => {
  it('warns once per catalog ID and names each unmarked property', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const document = {
        catalogId: 'urn:test:url-warning',
        protocolVersion: '1.0',
        components: {
          Card: {
            type: 'object',
            properties: {
              component: {const: 'Card'},
              imageUrl: {type: 'string'},
              linkUrl: {type: 'string', 'x-a2ui-url-context': 'navigation'},
            },
          },
        },
      };
      Catalog.fromJson(document);
      Catalog.fromJson(document);
      assert.strictEqual(warn.mock.callCount(), 1);
      const message = String(warn.mock.calls[0].arguments[0]);
      assert.match(message, /urn:test:url-warning/);
      assert.match(message, /Card\.imageUrl: no x-a2ui-url-context/);
      assert.doesNotMatch(message, /linkUrl/);
    } finally {
      warn.mock.restore();
    }
  });

  it('does not warn for a fully marked catalog', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      Catalog.fromJson({
        catalogId: 'urn:test:url-marked',
        protocolVersion: '1.0',
        components: {
          Card: {
            type: 'object',
            properties: {
              component: {const: 'Card'},
              imageUrl: {type: 'string', 'x-a2ui-url-context': 'media'},
              labelUrl: {type: 'string', 'x-a2ui-url-context': 'none'},
            },
          },
        },
      });
      assert.strictEqual(warn.mock.callCount(), 0);
    } finally {
      warn.mock.restore();
    }
  });
});
