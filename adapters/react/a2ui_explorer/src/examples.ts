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

import {type A2uiMessage} from '@a2ui/web_core/v0_9';

// Dynamically import all examples from the specification folder
const exampleModules = import.meta.glob(
  '../../../../specification/v0_9/catalogs/basic/examples/*.json',
  {eager: true},
);

export interface ExampleFile {
  key: string;
  data: any;
  catalog: string;
}

export function processExampleModules(modules: Record<string, unknown>): ExampleFile[] {
  return Object.entries(modules)
    .map(([path, data]) => {
      const match = path.match(
        /catalogs\/(?<catalogFolderName>[^/]+)\/examples\/(?<filename>[^/]+)$/,
      );
      // The glob pattern ensures this match will succeed, so non-null assertions are safe here.
      if (!match?.groups) {
        throw new Error(`Failed to parse path: ${path}`);
      }
      const {catalogFolderName, filename} = match.groups as {
        catalogFolderName: string;
        filename: string;
      };

      const key = `${catalogFolderName}_${filename.replace('.json', '')}`;
      const catalog = catalogFolderName.charAt(0).toUpperCase() + catalogFolderName.slice(1);

      return {
        key,
        data: (data as {default: unknown}).default ?? data,
        catalog,
      };
    })
    .sort((a, b) => {
      // Sort by catalog first, then by key (which includes the numeric prefix)
      if (a.catalog !== b.catalog) {
        return a.catalog.localeCompare(b.catalog);
      }
      return a.key.localeCompare(b.key);
    });
}

export const exampleFiles: ExampleFile[] = processExampleModules(exampleModules);

export const getMessages = (ex: {messages: A2uiMessage[]} | A2uiMessage[] | undefined) =>
  Array.isArray(ex) ? ex : ex?.messages;
