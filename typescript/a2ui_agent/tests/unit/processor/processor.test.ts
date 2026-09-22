/**
 * @license
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
import {basicCatalog} from '../../../src/types.js';
import {A2uiValidationError, A2uiStateError} from '../../../src/errors.js';

describe('A2uiRequestProcessor', () => {
  test('throws on invalid payload (validation error)', () => {
    const catalog = basicCatalog();
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
    const catalog = basicCatalog();
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
    expect(() => processor.parseResponse(payload)).toThrow(A2uiStateError);
  });
});
