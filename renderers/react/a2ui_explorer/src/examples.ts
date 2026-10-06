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

import {EXAMPLES, EXAMPLES_V10, type ExampleModule} from './generated/examples-list';

/**
 * Represents a demo item loaded from an example JSON file.
 * Contains metadata and the array of messages to be processed.
 */
export interface DemoItem {
  /** Unique identifier for the demo item (usually the surfaceId). */
  id: string;
  /** Human-readable title derived from the filename. */
  title: string;
  /** The original filename of the example. */
  filename: string;
  /** Description of the example, or a fallback source string. */
  description: string;
  /** The list of A2UI messages to be processed for this demo. */
  messages: Record<string, unknown>[];
}

/**
 * Process a modules registry map and returns the list of all available demo items.
 *
 * @internal @visibleForTesting
 */
export function processExampleModules(modules: Record<string, ExampleModule>): DemoItem[] {
  const items: DemoItem[] = [];

  const sortedEntries = Object.entries(modules).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [filename, data] of sortedEntries) {
    try {
      const jsonData = data.default;

      const [messages, description] = extractMessagesAndDescription(jsonData, filename);

      const id = filename.replace('.json', '');

      items.push({
        id,
        title: filenameToTitle(filename),
        filename,
        description,
        messages,
      });
    } catch (err) {
      console.error(`Error loading ${filename}:`, err);
    }
  }

  return items;
}

/**
 * Extracts the array of A2UI messages and the description from the loaded JSON data.
 */
function extractMessagesAndDescription(
  jsonData: ExampleModule['default'],
  filename: string,
): [Record<string, unknown>[], string] {
  let messages: Record<string, unknown>[] = [];
  let description = `Source: ${filename}`;

  if (Array.isArray(jsonData)) {
    messages = jsonData as Record<string, unknown>[];
  } else if (jsonData && typeof jsonData === 'object') {
    const dataObj = jsonData as Record<string, unknown>;
    if (Array.isArray(dataObj.messages)) {
      messages = dataObj.messages as Record<string, unknown>[];
    }
    if (typeof dataObj.description === 'string') {
      description = dataObj.description;
    }
  }

  if (messages.length === 0) {
    console.warn(`No A2UI messages found in ${filename}`, jsonData);
  }

  return [messages, description];
}

/**
 * Converts a filename to a human-readable title.
 */
function filenameToTitle(filename: string): string {
  return filename
    .replace('.json', '')
    .replace(/^[0-9]+_/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Loads and returns the list of all available demo items for the given protocol version.
 */
export function getDemoItems(version: 'v0.9' | 'v1.0' = 'v0.9'): DemoItem[] {
  return processExampleModules(version === 'v1.0' ? EXAMPLES_V10 : EXAMPLES);
}
