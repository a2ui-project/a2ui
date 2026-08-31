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

import {A2UI_MIME_TYPE} from './constants.js';
import {McpCallToolResult, McpResourceContents} from './types.js';

/**
 * Normalizes parsed JSON into an array of A2UI messages.
 *
 * @param parsed The parsed JSON value (either a single object or an array).
 * @returns An array of A2UI messages or null if invalid.
 */
function normalizeToMessageArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed];
  }
  return null;
}

/**
 * Safely parses a JSON string.
 *
 * @param text The JSON string to parse.
 * @returns The parsed object or null if parsing fails.
 */
function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extracts and parses A2UI messages from an MCP CallToolResult.
 *
 * @param result The result object returned from client.callTool().
 * @returns An array of A2UI message objects, or null if no A2UI resource was present.
 */
export function extractA2uiFromToolResult(
  result: McpCallToolResult | null | undefined,
): unknown[] | null {
  if (!result || !Array.isArray(result.content)) {
    return null;
  }

  for (const item of result.content) {
    // 1. Embedded resource format: { type: 'resource', resource: { mimeType: 'application/a2ui+json', text: '...' } }
    if (item.type === 'resource' && item.resource) {
      const res = item.resource;
      if (res.mimeType === A2UI_MIME_TYPE && typeof res.text === 'string') {
        const parsed = safeJsonParse(res.text);
        const normalized = normalizeToMessageArray(parsed);
        if (normalized) {
          return normalized;
        }
      }
    }

    // 2. Direct resource item format: { mimeType: 'application/a2ui+json', text: '...' }
    if (item.mimeType === A2UI_MIME_TYPE && typeof item.text === 'string') {
      const parsed = safeJsonParse(item.text);
      const normalized = normalizeToMessageArray(parsed);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

/**
 * Extracts and parses A2UI messages from an array of MCP ResourceContents.
 *
 * @param contents The resource contents array returned from client.readResource().
 * @returns An array of A2UI message objects, or null if no valid A2UI content was found.
 */
export function extractA2uiFromResource(
  contents: McpResourceContents[] | null | undefined,
): unknown[] | null {
  if (!Array.isArray(contents)) {
    return null;
  }

  for (const item of contents) {
    if (
      (item.mimeType === A2UI_MIME_TYPE || (item.uri && item.uri.startsWith('a2ui://'))) &&
      typeof item.text === 'string'
    ) {
      const parsed = safeJsonParse(item.text);
      const normalized = normalizeToMessageArray(parsed);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}
