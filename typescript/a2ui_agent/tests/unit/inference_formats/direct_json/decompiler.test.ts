import {AgentToRendererMessage} from '../../../../src/internal/web_core.js';
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

import {describe, it, expect} from 'vitest';
import {DirectJsonDecompiler} from '../../../../src/inference_formats/direct_json/decompiler.js';
import {RawResponsePart} from '../../../../src/parser/response_part.js';

describe('DirectJsonDecompiler', () => {
  const decompiler = new DirectJsonDecompiler();

  it('decompiles payload to formatted JSON', () => {
    const payload = [{version: '1.0', createSurface: {surfaceId: '1'}}];
    const result = decompiler.decompile(payload as unknown as AgentToRendererMessage[]);
    expect(result).toBe(
      '[\n  {\n    "version": "1.0",\n    "createSurface": {\n      "surfaceId": "1"\n    }\n  }\n]',
    );
  });

  it('wraps blocks with A2UI tags', () => {
    const blocks: RawResponsePart[] = [
      {type: 'text', text: 'Here is your UI:', isFinal: true},
      {type: 'a2ui', a2uiRaw: '[\n  {"test": 1}\n]', isFinal: true},
      {type: 'text', text: 'Hope that helps!', isFinal: true},
    ];
    const result = decompiler.wrap(blocks);
    const expected =
      'Here is your UI:\n<a2ui-json>\n[\n  {"test": 1}\n]\n</a2ui-json>\nHope that helps!';
    expect(result).toBe(expected);
  });
});
