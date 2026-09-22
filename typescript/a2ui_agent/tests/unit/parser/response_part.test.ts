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

import {describe, it, expect} from 'vitest';
import {ResponsePart, RawResponsePart} from '../../../src/parser/response_part.js';
import {AgentToRendererMessage} from '../../../src/internal/web_core.js';

describe('ResponsePart', () => {
  it('narrows correctly to TextPart', () => {
    const part: ResponsePart = {
      type: 'text',
      text: 'Hello world',
    };

    if (part.type === 'text') {
      expect(part.text).toBe('Hello world');
    } else {
      expect.fail('Expected type to be narrowed to text');
    }
  });

  it('narrows correctly to A2uiPart', () => {
    const message = {
      version: 'v1.0',
      createSurface: {surfaceId: 'test'},
    } as unknown as AgentToRendererMessage;

    const part: ResponsePart = {
      type: 'a2ui',
      a2ui: [message],
    };

    if (part.type === 'a2ui') {
      expect((part.a2ui[0] as {createSurface?: {surfaceId: string}}).createSurface?.surfaceId).toBe(
        'test',
      );
    } else {
      expect.fail('Expected type to be narrowed to a2ui');
    }
  });

  it('narrows correctly on RawResponsePart with intersection type', () => {
    const rawText: RawResponsePart = {
      type: 'text',
      text: 'Hello',
      isFinal: true,
    };

    const rawA2ui: RawResponsePart = {
      type: 'a2ui',
      a2uiRaw: '{}',
      isFinal: false,
    };

    if (rawText.type === 'text') {
      expect(rawText.text).toBe('Hello');
      expect(rawText.isFinal).toBe(true);
    } else {
      expect.fail('Failed to narrow rawText');
    }

    if (rawA2ui.type === 'a2ui') {
      expect(rawA2ui.a2uiRaw).toBe('{}');
      expect(rawA2ui.isFinal).toBe(false);
    } else {
      expect.fail('Failed to narrow rawA2ui');
    }
  });
});
