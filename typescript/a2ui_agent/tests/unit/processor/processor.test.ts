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

import {describe, test, expect} from 'vitest';
import {A2uiRequestProcessor} from '../../../src/processor/processor.js';
import {loadBasicCatalog} from '../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../helpers/conformance-catalogs.js';
import {A2uiIntegrityError, A2uiValidationError} from '../../../src/errors.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');

describe('A2uiRequestProcessor', () => {
  test('throws on invalid payload (validation error)', () => {
    const catalog = basicCatalogV10;
    const processor = new A2uiRequestProcessor([catalog]);

    const v1Payload = `
<a2ui-json>
[
  {
    "version": "v1.0",
    "createSurface": {
      "surfaceId": "test_surface_id",
      "catalogId": "${catalog.id}",
      "components": [
        {
          "id": "comp_1",
          "component": "Text",
          "unknownPropertyThatShouldFail": "hello"
        }
      ]
    }
  }
]
</a2ui-json>`;

    expect(() => processor.parseResponse(v1Payload)).toThrow(A2uiValidationError);
  });

  test('accrues state across parseResponse calls and throws on duplicate surface creation', () => {
    const catalog = basicCatalogV10;
    const processor = new A2uiRequestProcessor([catalog]);

    const payload = `
<a2ui-json>
[
  {
    "version": "v1.0",
    "createSurface": {
      "surfaceId": "test_surface_id",
      "catalogId": "${catalog.id}",
      "components": [
        {
          "id": "comp_1",
          "component": "Text",
          "text": "hello"
        }
      ]
    }
  }
]
</a2ui-json>`;

    // First parse succeeds, creating the surface in the processor's internal MessageProcessor state.
    expect(() => processor.parseResponse(payload)).not.toThrow();

    // Second parse throws because the surface 'test_surface_id' already exists in the same processor.
    // This pins down the latent behavior that parseResponse is stateful across calls.
    expect(() => processor.parseResponse(payload)).toThrow(A2uiIntegrityError);
  });

  test('promptSnippet includes the configured examples', () => {
    const catalog = basicCatalogV10;
    const processor = new A2uiRequestProcessor([catalog], {
      [catalog.id]: '---BEGIN greeting---\nexample text\n---END greeting---',
    });

    expect(processor.promptSnippet).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(processor.promptSnippet).toContain(
      '---BEGIN greeting---\nexample text\n---END greeting---',
    );
  });

  describe('v1.0 catalog compliance', () => {
    /** Wraps one root component in a v1.0 createSurface response on the basic catalog. */
    function responseWithRoot(root: Record<string, unknown>): string {
      const message = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's',
          catalogId: basicCatalogV10.id,
          components: [{id: 'root', ...root}],
        },
      };
      return `<a2ui-json>${JSON.stringify([message])}</a2ui-json>`;
    }

    /** Asserts that `fn` throws an `A2uiValidationError` whose message matches `pattern`. */
    function expectValidationError(fn: () => unknown, pattern: RegExp): void {
      let error: unknown;
      try {
        fn();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(A2uiValidationError);
      expect((error as Error).message).toMatch(pattern);
    }

    test('rejects a call to a function no catalog declares', () => {
      const processor = new A2uiRequestProcessor([basicCatalogV10]);
      const response = responseWithRoot({
        component: 'Text',
        text: {'@call': 'noSuchFn', args: {}},
      });

      expectValidationError(
        () => processor.parseResponse(response),
        /Unrecognized function 'noSuchFn'/,
      );
    });

    test('rejects a call to an undefined @ system function', () => {
      const processor = new A2uiRequestProcessor([basicCatalogV10]);
      const response = responseWithRoot({
        component: 'Text',
        text: {'@call': '@foo', args: {}},
      });

      expectValidationError(
        () => processor.parseResponse(response),
        /Unrecognized function '@foo'/,
      );
    });

    test('rejects a component type no catalog declares', () => {
      const processor = new A2uiRequestProcessor([basicCatalogV10]);
      const response = responseWithRoot({component: 'NoSuchWidget'});

      expectValidationError(
        () => processor.parseResponse(response),
        /Unknown component type 'NoSuchWidget'/,
      );
    });

    test('accepts a valid call to a function of another active catalog', () => {
      const custom = loadConformanceCatalog('custom_catalog_v1_0.json');
      const processor = new A2uiRequestProcessor([basicCatalogV10, custom]);
      const response = responseWithRoot({
        component: 'Text',
        text: {'@call': 'percent', catalogId: custom.id, args: {value: 0.5}},
      });

      expect(() => processor.parseResponse(response)).not.toThrow();
    });

    test('checks a call to another active catalog against that catalog', () => {
      const custom = loadConformanceCatalog('custom_catalog_v1_0.json');
      const processor = new A2uiRequestProcessor([basicCatalogV10, custom]);
      const response = responseWithRoot({
        component: 'Text',
        text: {'@call': 'percent', catalogId: custom.id, args: {value: 'half'}},
      });

      expectValidationError(
        () => processor.parseResponse(response),
        /Validation failed for function 'percent'/,
      );
    });

    test('still accepts a response that updates only part of a surface', () => {
      const processor = new A2uiRequestProcessor([basicCatalogV10]);
      const response = responseWithRoot({component: 'Column', children: ['later']});

      expect(() => processor.parseResponse(response)).not.toThrow();
    });
  });
});
