/**
 * Copyright 2026 kokoro-ele
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

import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {A2uiMessage} from '@a2ui/web_core/v0_9';

export interface ExampleItem {
  id: string;
  title: string;
  description: string;
  messages: A2uiMessage[];
}

const examplesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../specification/v0_9_1/catalogs/basic/examples',
);

export function loadExamples(): ExampleItem[] {
  return readdirSync(examplesDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(file => {
      const raw = JSON.parse(readFileSync(join(examplesDir, file), 'utf8')) as {
        name?: string;
        description?: string;
        messages: A2uiMessage[];
      };
      const id = basename(file, '.json');
      return {
        id,
        title: raw.name ?? id,
        description: raw.description ?? '',
        messages: raw.messages,
      };
    });
}

export function findExample(examples: ExampleItem[], query: string): ExampleItem | undefined {
  const exact = examples.find(e => e.id === query);
  if (exact) return exact;
  return examples.find(
    e => e.id.includes(query) || e.title.toLowerCase().includes(query.toLowerCase()),
  );
}
