/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {A2uiMessage} from '@a2ui/web_core/v0_9';

export const A2UI_MIME_TYPES = ['application/a2ui+json', 'application/json+a2ui'];

// MIME types are case-insensitive and may carry parameters
// (e.g. "application/a2ui+json; charset=utf-8").
function isA2uiMimeType(mimeType: unknown): boolean {
  if (typeof mimeType !== 'string') return false;
  return A2UI_MIME_TYPES.includes(mimeType.split(';')[0].trim().toLowerCase());
}

/**
 * Collects and parses every A2UI embedded resource from a tool result's
 * content blocks. Each resource may hold a single message or an array.
 */
export function extractA2uiMessages(content: unknown): A2uiMessage[] {
  if (!Array.isArray(content)) return [];
  const messages: A2uiMessage[] = [];
  for (const block of content) {
    if (block?.type !== 'resource') continue;
    const resource = block.resource;
    if (!isA2uiMimeType(resource?.mimeType) || typeof resource?.text !== 'string') {
      continue;
    }
    try {
      const parsed = JSON.parse(resource.text);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      // MessageProcessor dispatches with the `in` operator, which throws on
      // null/scalar values — drop them here.
      messages.push(...entries.filter(entry => entry && typeof entry === 'object'));
    } catch (err) {
      console.error('Failed to parse A2UI payload:', err);
    }
  }
  return messages;
}
