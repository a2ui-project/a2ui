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

import {basicCatalog as basicCatalogV09} from '@a2ui/lit/v0_9';
import {basicCatalog as basicCatalogV10} from '@a2ui/lit/v1_0';
import {
  ExampleData,
  ExampleModule,
  ExplorerMessage,
  EXAMPLES_V09,
  EXAMPLES_V10,
} from './generated/examples-list';

export type {ExplorerMessage};

/** Supported specification versions in the Lit Explorer. */
export type SpecVersion = '0.9' | '1.0';

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
  messages: ExplorerMessage[];
  /** The specification version of the example ('0.9' | '1.0'). */
  version: SpecVersion;
}

/**
 * Loads and returns the list of available demo items for the requested protocol version.
 *
 * @param version Target specification version ('0.9' | '1.0'). Defaults to '0.9'.
 * @returns An array of DemoItem objects.
 */
export function getDemoItems(version: SpecVersion = '0.9'): DemoItem[] {
  const items: DemoItem[] = [];
  const modules = version === '1.0' ? EXAMPLES_V10 : EXAMPLES_V09;
  const sortedEntries = getSortedExampleEntries(modules);

  for (const [filename, data] of sortedEntries) {
    try {
      const jsonData = structuredClone(data.default);
      const [rawMessages, description] = extractMessagesAndDescription(jsonData, filename);
      const messages = version === '1.0' ? normalizeV10Messages(rawMessages) : rawMessages;
      const surfaceId = ensureCreateSurfaceMessage(filename, messages, version);

      items.push({
        id: surfaceId,
        title: filenameToTitle(filename),
        filename,
        description,
        messages,
        version,
      });
    } catch (err) {
      console.error(`Error loading ${filename}:`, err);
    }
  }

  if (items.length === 0) {
    console.warn('No demo items were found.');
  }

  return items;
}

function normalizeId(id: unknown): unknown {
  return typeof id === 'string' ? id.replace(/-/g, '_') : id;
}

function normalizeV10Component(comp: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {...comp, id: normalizeId(comp.id)};
  if (typeof next.child === 'string') {
    next.child = normalizeId(next.child);
  }
  if (Array.isArray(next.children)) {
    next.children = next.children.map(normalizeId);
  }
  return next;
}

function normalizeV10Messages(messages: ExplorerMessage[]): ExplorerMessage[] {
  return messages.map(msg => {
    if (msg && typeof msg === 'object') {
      if (
        'updateComponents' in msg &&
        msg.updateComponents &&
        Array.isArray(msg.updateComponents.components)
      ) {
        return {
          ...msg,
          updateComponents: {
            ...msg.updateComponents,
            components: msg.updateComponents.components.map(c =>
              normalizeV10Component(c as Record<string, unknown>),
            ),
          },
        } as ExplorerMessage;
      }
      if (
        'createSurface' in msg &&
        msg.createSurface &&
        Array.isArray((msg.createSurface as any).components)
      ) {
        return {
          ...msg,
          createSurface: {
            ...msg.createSurface,
            components: (msg.createSurface as any).components.map((c: any) =>
              normalizeV10Component(c as Record<string, unknown>),
            ),
          },
        } as ExplorerMessage;
      }
    }
    return msg;
  });
}

/**
 * Ensures that the messages array contains a createSurface message.
 *
 * If it doesn't, synthesizes one using the filename, and **prepends it to the
 * messages array.**
 *
 * @param filename The name of the file, used as fallback surfaceId.
 * @param messages The array of A2UI messages.
 * @param version The specification version ('0.9' | '1.0').
 * @returns The surfaceId for the createSurface message of this set of messages.
 */
function ensureCreateSurfaceMessage(
  filename: string,
  messages: ExplorerMessage[],
  version: SpecVersion,
): string {
  let surfaceId = filename.replace('.json', '');
  const createMsg = messages.find(
    (message): message is Extract<ExplorerMessage, {createSurface: unknown}> =>
      'createSurface' in message,
  );

  if (createMsg) {
    surfaceId = createMsg.createSurface.surfaceId;
  } else if (version === '1.0') {
    messages.unshift({
      version: 'v1.0',
      createSurface: {
        surfaceId,
        catalogId: basicCatalogV10.id,
      },
    });
  } else {
    messages.unshift({
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: basicCatalogV09.id,
      },
    });
  }

  return surfaceId;
}

function getSortedExampleEntries(
  modules: Record<string, ExampleModule>,
): [string, ExampleModule][] {
  return Object.entries(modules).sort((a, b) => a[0].localeCompare(b[0]));
}

function extractMessagesAndDescription(
  jsonData: ExampleData | ExplorerMessage[],
  filename: string,
): [ExplorerMessage[], string] {
  let messages: ExplorerMessage[] = [];
  let description = `Source: ${filename}`;

  if (Array.isArray(jsonData)) {
    messages = jsonData;
  } else {
    messages = jsonData.messages || [];
    description = jsonData.description || description;
  }

  if (messages.length === 0) {
    console.warn(`No A2UI messages found in ${filename}`, jsonData);
  }

  return [messages, description];
}

function filenameToTitle(filename: string): string {
  return filename
    .replace('.json', '')
    .replace(/^[0-9]+_/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}
