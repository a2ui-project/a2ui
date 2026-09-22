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

import {AgentToRendererMessage} from '../../internal/web_core.js';
import {RawResponsePart} from '../../parser/response_part.js';
import {A2UI_OPEN_TAG, A2UI_CLOSE_TAG} from '../../parser/constants.js';

/**
 * Standard Direct JSON format decompiler.
 */
export class DirectJsonDecompiler {
  /**
   * Decompiles structured JSON payloads to pretty-printed JSON.
   */
  decompile(payload: AgentToRendererMessage[]): string {
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Wraps raw response parts, adding format tags around A2UI payload sections.
   */
  wrap(blocks: RawResponsePart[]): string {
    let result = '';
    for (const block of blocks) {
      if (block.type === 'text') {
        result += block.text + '\n';
      } else if (block.type === 'a2ui') {
        result += `${A2UI_OPEN_TAG}\n${block.a2uiRaw}\n${A2UI_CLOSE_TAG}\n`;
      }
    }
    return result.trimEnd();
  }
}
