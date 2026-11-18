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

import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** The monorepo's `node_modules`, which fixture projects link to resolve packages. */
const NODE_MODULES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../node_modules',
);

/** A catalog module defining one `Greeting` component. */
export const GREETING_CATALOG_MODULE = `
import {Catalog} from '@a2ui/web_core';
import {z} from 'zod';

export const greetingCatalog = new Catalog(
  'https://example.com/catalogs/greeting.json',
  '1.0',
  [{name: 'Greeting', schema: z.object({text: z.string().describe('The greeting to show.')})}],
);
`;

/**
 * A stand-in for the `@a2ui/embed/mcp` runtime. It records what the app passes to `startEmbedApp`
 * on the root element, and its `</script>` string checks that the inline script is escaped.
 */
export const FIXTURE_RUNTIME_MODULE = `
export function startEmbedApp({catalogs, root}) {
  root.dataset.catalogs = catalogs.map(catalog => catalog.id).join(' ');
  root.dataset.marker = '</script><!-- end -->';
  root.dataset.started = 'true';
}
`;

/** A throwaway project directory whose packages resolve from the monorepo. */
export interface FixtureProject {
  dir: string;
  /** The absolute path of the stand-in runtime, to pass to `buildApp` as `runtimeModule`. */
  runtime: string;
  /** Writes `files` (relative path to content) into the project. */
  write(files: Record<string, string>): Promise<void>;
  remove(): Promise<void>;
}

/** Creates a project in a temporary directory with the stand-in runtime. */
export async function createFixtureProject(): Promise<FixtureProject> {
  const dir = await mkdtemp(join(tmpdir(), 'a2ui-embed-build-'));
  await symlink(NODE_MODULES, join(dir, 'node_modules'), 'dir');
  const project: FixtureProject = {
    dir,
    runtime: join(dir, 'runtime.mjs'),
    async write(files) {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), {recursive: true});
        await writeFile(join(dir, path), content);
      }
    },
    remove: () => rm(dir, {recursive: true, force: true}),
  };
  await project.write({'runtime.mjs': FIXTURE_RUNTIME_MODULE});
  return project;
}
