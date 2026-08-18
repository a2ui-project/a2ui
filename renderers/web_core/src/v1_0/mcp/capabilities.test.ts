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
import {buildMcpUiClientCapabilities, supportsNativeA2ui} from './capabilities.js';
import {A2UI_MIME_TYPE, MCP_APPS_MIME_TYPE, MCP_UI_EXTENSION_KEY} from './constants.js';

describe('MCP Capabilities', () => {
  describe('buildMcpUiClientCapabilities', () => {
    it('defaults to advertising both HTML app and native A2UI', () => {
      const caps = buildMcpUiClientCapabilities();
      const mimeTypes = caps.extensions[MCP_UI_EXTENSION_KEY].mimeTypes;
      assert.strictEqual(mimeTypes.length, 2);
      assert.ok(mimeTypes.includes(MCP_APPS_MIME_TYPE));
      assert.ok(mimeTypes.includes(A2UI_MIME_TYPE));
    });

    it('allows opting out of HTML app fallback', () => {
      const caps = buildMcpUiClientCapabilities({enableHtmlApp: false, enableNativeA2ui: true});
      const mimeTypes = caps.extensions[MCP_UI_EXTENSION_KEY].mimeTypes;
      assert.deepStrictEqual(mimeTypes, [A2UI_MIME_TYPE]);
    });

    it('allows opting out of native A2UI', () => {
      const caps = buildMcpUiClientCapabilities({enableHtmlApp: true, enableNativeA2ui: false});
      const mimeTypes = caps.extensions[MCP_UI_EXTENSION_KEY].mimeTypes;
      assert.deepStrictEqual(mimeTypes, [MCP_APPS_MIME_TYPE]);
    });
  });

  describe('supportsNativeA2ui', () => {
    it('returns true when application/a2ui+json is declared in mimeTypes', () => {
      const caps = {
        extensions: {
          [MCP_UI_EXTENSION_KEY]: {
            mimeTypes: [MCP_APPS_MIME_TYPE, A2UI_MIME_TYPE],
          },
        },
      };
      assert.strictEqual(supportsNativeA2ui(caps), true);
    });

    it('returns true when nested under capabilities key', () => {
      const payload = {
        capabilities: {
          extensions: {
            [MCP_UI_EXTENSION_KEY]: {
              mimeTypes: [A2UI_MIME_TYPE],
            },
          },
        },
      };
      assert.strictEqual(supportsNativeA2ui(payload), true);
    });

    it('returns false when only HTML app is declared', () => {
      const caps = {
        extensions: {
          [MCP_UI_EXTENSION_KEY]: {
            mimeTypes: [MCP_APPS_MIME_TYPE],
          },
        },
      };
      assert.strictEqual(supportsNativeA2ui(caps), false);
    });

    it('returns false for null or missing extensions', () => {
      assert.strictEqual(supportsNativeA2ui(null), false);
      assert.strictEqual(supportsNativeA2ui({}), false);
      assert.strictEqual(supportsNativeA2ui({extensions: {}}), false);
    });
  });
});
