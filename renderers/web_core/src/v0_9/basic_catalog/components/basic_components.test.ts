/*
 * Copyright 2026 Google LLC
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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {ImageApi} from './basic_components.js';

describe('Basic Components Schema', () => {
  describe('ImageApi', () => {
    it('should parse valid image with description', () => {
      const validImage = {
        url: 'https://example.com/image.png',
        description: 'An example image',
      };
      const parsed = ImageApi.schema.parse(validImage);
      assert.strictEqual(parsed.url, 'https://example.com/image.png');
      assert.strictEqual(parsed.description, 'An example image');
    });

    it('should parse valid image without description', () => {
      const validImage = {
        url: 'https://example.com/image.png',
      };
      const parsed = ImageApi.schema.parse(validImage);
      assert.strictEqual(parsed.url, 'https://example.com/image.png');
      assert.strictEqual(parsed.description, undefined);
    });

    it('should throw on invalid image', () => {
      const invalidImage = {
        url: 123, // Invalid type
      };
      assert.throws(() => ImageApi.schema.parse(invalidImage));
    });
  });
});
