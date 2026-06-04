/// <reference types="vite/client" />
/*
 * Copyright 2025 Google LLC
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

import {basicCatalog} from '@a2ui/lit/v0_9';
import {A2uiMessage, CreateSurfaceMessage} from '@a2ui/web_core/v0_9';

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
  messages: A2uiMessage[];
}

/**
 * Loads and returns the list of all available demo items to be displayed in the gallery.
 *
 * @returns An array of DemoItem objects.
 */
export function getDemoItems(): DemoItem[] {
  const items: DemoItem[] = [];

  const sortedEntries = getSortedExampleEntries();

  for (const [path, data] of sortedEntries) {
    try {
      const filename = path.substring(path.lastIndexOf('/') + 1);
      const jsonData = data.default;

      const [messages, description] = extractMessagesAndDescription(jsonData, filename, path);

      const surfaceId = ensureCreateSurfaceMessage(filename, messages);

      items.push({
        id: surfaceId,
        title: filenameToTitle(filename),
        filename: filename,
        description: description,
        messages: messages,
      });
    } catch (err) {
      console.error(`Error loading ${path}:`, err);
    }
  }

  if (items.length === 0) {
    console.warn('No demo items were found.');
  }

  return items;
}

/**
 * Ensures that the messages array contains a createSurface message.
 *
 * If it doesn't, synthesizes one using the filename, and **prepends it to the
 * messages array.**
 *
 * @param filename The name of the file, used as fallback surfaceId.
 * @param messages The array of A2UI messages. **Note: This array may be mutated
 *                 by prepending a createSurface message if none exists.**
 * @returns The surfaceId for the createSurface message of this set of messages.
 */
function ensureCreateSurfaceMessage(filename: string, messages: A2uiMessage[]): string {
  let surfaceId = filename.replace('.json', '');
  const createMsg = messages.find(
    (message): message is CreateSurfaceMessage => 'createSurface' in message,
  );

  if (createMsg) {
    surfaceId = createMsg.createSurface.surfaceId;
  } else {
    messages.unshift({
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: basicCatalog.id,
      },
    });
  }

  return surfaceId;
}

/**
 * Represents the expected structure of the example JSON data.
 * It can be a direct array of messages or an object containing messages and metadata.
 */
interface ExampleData {
  messages?: A2uiMessage[];
  description?: string;
}

/**
 * Represents the module structure returned by Vite when importing a JSON file
 * via import.meta.glob.
 *
 * The `default` property contains the parsed content of the file (in this case,
 * our example data).
 */
interface ExampleModule {
  default: ExampleData | A2uiMessage[];
}

/**
 * Dynamically imports all example JSON files from the specification folder
 * and returns them as an array of entries sorted by their file path.
 *
 * @returns An array of tuples where the first element is the file path and the
 * second is the ExampleModule.
 */
function getSortedExampleEntries(): [string, ExampleModule][] {
  // NOTE: This glob pattern must be a string literal. We cannot use variables or
  // pass it as a parameter because Vite needs to statically analyze it at build
  // time.
  const exampleModules = import.meta.glob<ExampleModule>(
    '../../../../specification/v0_9/catalogs/basic/examples/*.json',
    {eager: true},
  );

  return Object.entries(exampleModules).sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Extracts the array of A2UI messages and the description from the loaded JSON
 * data.
 *
 * Handles both direct arrays of messages and wrapped ExampleData objects.
 * Logs warnings for unexpected formats or empty messages.
 *
 * @param jsonData The raw JSON data loaded from the file.
 * @param filename The name of the file (used for default description).
 * @param path The full path of the file (used for logging).
 * @returns A tuple containing the array of messages and the description string.
 */
function extractMessagesAndDescription(
  jsonData: ExampleData | A2uiMessage[],
  filename: string,
  path: string,
): [A2uiMessage[], string] {
  let messages: A2uiMessage[] = [];
  let description = `Source: ${filename}`;

  if (Array.isArray(jsonData)) {
    messages = jsonData;
  } else {
    messages = jsonData.messages || [];
    description = jsonData.description || description;
  }

  if (messages.length === 0) {
    console.warn(`No A2UI messages found in ${path}`, jsonData);
  }

  return [messages, description];
}

/**
 * Converts a filename (e.g., "basic_components.json") to a human-readable title
 * (e.g., "Basic Components").
 *
 * Replaces underscores with spaces and capitalizes each word.
 *
 * @param filename The filename to convert.
 * @returns The formatted title.
 */
function filenameToTitle(filename: string): string {
  return filename
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace('.json', '');
}
