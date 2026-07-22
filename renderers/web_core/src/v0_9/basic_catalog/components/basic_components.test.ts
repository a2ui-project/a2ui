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
import {ImageApi, SelectApi, SwitchApi, DialogApi, ToastApi} from './basic_components.js';

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

  describe('SelectApi', () => {
    it('should parse valid Select schema', () => {
      const validSelect = {
        label: 'Choose option',
        options: [
          {label: 'Opt 1', value: 'v1'},
          {label: 'Opt 2', value: 'v2'},
        ],
        value: 'v1',
      };
      const parsed = SelectApi.schema.parse(validSelect);
      assert.strictEqual(parsed.label, 'Choose option');
      assert.strictEqual(parsed.options.length, 2);
    });
  });

  describe('SwitchApi', () => {
    it('should parse valid Switch schema', () => {
      const validSwitch = {
        label: 'Enable notifications',
        value: true,
      };
      const parsed = SwitchApi.schema.parse(validSwitch);
      assert.strictEqual(parsed.label, 'Enable notifications');
      assert.strictEqual(parsed.value, true);
    });
  });

  describe('DialogApi', () => {
    it('should parse valid Dialog schema', () => {
      const validDialog = {
        title: 'Confirm Action',
        child: 'content-comp-1',
        open: true,
      };
      const parsed = DialogApi.schema.parse(validDialog);
      assert.strictEqual(parsed.title, 'Confirm Action');
      assert.strictEqual(parsed.child, 'content-comp-1');
      assert.strictEqual(parsed.open, true);
    });
  });

  describe('ToastApi', () => {
    it('should parse valid Toast schema', () => {
      const validToast = {
        message: 'Settings saved',
        variant: 'success',
        durationMs: 5000,
      };
      const parsed = ToastApi.schema.parse(validToast);
      assert.strictEqual(parsed.message, 'Settings saved');
      assert.strictEqual(parsed.variant, 'success');
      assert.strictEqual(parsed.durationMs, 5000);
    });
  });
});

