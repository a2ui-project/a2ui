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
import {A2UI_MIME_TYPE} from './constants.js';
import {extractA2uiFromResource, extractA2uiFromToolResult} from './payload-extractor.js';

describe('MCP Payload Extractor', () => {
  describe('extractA2uiFromToolResult', () => {
    it('extracts single A2UI message from EmbeddedResource', () => {
      const toolResult = {
        content: [
          {type: 'text', text: 'Some text fallback'},
          {
            type: 'resource',
            resource: {
              uri: 'a2ui://tool-result',
              mimeType: A2UI_MIME_TYPE,
              text: JSON.stringify({
                version: 'v1.0',
                createSurface: {surfaceId: 'surface-1'},
              }),
            },
          },
        ],
      };

      const extracted = extractA2uiFromToolResult(toolResult);
      assert.ok(extracted);
      assert.strictEqual(extracted.length, 1);
      assert.deepStrictEqual(extracted[0], {
        version: 'v1.0',
        createSurface: {surfaceId: 'surface-1'},
      });
    });

    it('extracts array of A2UI messages from EmbeddedResource', () => {
      const toolResult = {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'a2ui://tool-result',
              mimeType: A2UI_MIME_TYPE,
              text: JSON.stringify([
                {version: 'v1.0', createSurface: {surfaceId: 'surface-1'}},
                {version: 'v1.0', updateDataModel: {surfaceId: 'surface-1', value: {count: 10}}},
              ]),
            },
          },
        ],
      };

      const extracted = extractA2uiFromToolResult(toolResult);
      assert.ok(extracted);
      assert.strictEqual(extracted.length, 2);
    });

    it('returns null when no A2UI resource is present', () => {
      const toolResult = {
        content: [{type: 'text', text: 'No UI here'}],
      };
      assert.strictEqual(extractA2uiFromToolResult(toolResult), null);
      assert.strictEqual(extractA2uiFromToolResult(null), null);
    });

    it('returns null when JSON is malformed', () => {
      const toolResult = {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'a2ui://bad',
              mimeType: A2UI_MIME_TYPE,
              text: '{malformed_json',
            },
          },
        ],
      };
      assert.strictEqual(extractA2uiFromToolResult(toolResult), null);
    });
  });

  describe('extractA2uiFromResource', () => {
    it('extracts A2UI messages from ResourceContents array', () => {
      const contents = [
        {
          uri: 'a2ui://my-resource',
          mimeType: A2UI_MIME_TYPE,
          text: JSON.stringify({
            version: 'v1.0',
            createSurface: {surfaceId: 'res-surface'},
          }),
        },
      ];

      const extracted = extractA2uiFromResource(contents);
      assert.ok(extracted);
      assert.strictEqual(extracted.length, 1);
      assert.deepStrictEqual(extracted[0], {
        version: 'v1.0',
        createSurface: {surfaceId: 'res-surface'},
      });
    });

    it('returns null for empty or invalid resource contents', () => {
      assert.strictEqual(extractA2uiFromResource(null), null);
      assert.strictEqual(extractA2uiFromResource([]), null);
      assert.strictEqual(
        extractA2uiFromResource([
          {
            uri: 'file://other',
            mimeType: 'text/plain',
            text: 'plain text',
          },
        ]),
        null,
      );
    });
  });
});
