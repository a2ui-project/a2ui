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

// The Travel A2UI agent guides, from one source.
//
// `agent-guide.md` marks the parts that belong to one guide with
// `<!-- only:both -->`, `<!-- only:web -->` or `<!-- only:mobile -->` (several
// may share a block, space separated), closed by `<!-- /only -->`. Each guide
// keeps the blocks that name it: `both` (the default: web and mobile), `web`
// or `mobile`.
//
// `{{NAME}}` placeholders are filled from `site.ts`, so the URLs an agent is
// handed match where the site is deployed.

import source from './agent-guide.md?raw';
import {absolute, CLONE, DEPLOY, LABS_REPO, REPO, SAMPLE_DIR, STEP_BY_STEP_PATH} from './site';

export type App = 'both' | 'web' | 'mobile';

const BLOCK = /<!-- only:([a-z ]+) -->\n([\s\S]*?)<!-- \/only -->\n?/g;

const VALUES: Record<string, string> = {
  LABS_REPO,
  CLONE,
  SAMPLE_DIR,
  REPO,
  DEPLOY,
  STEP_BY_STEP: absolute(STEP_BY_STEP_PATH),
  RENDERERS: absolute('ecosystem/renderers/'),
  DOCS: absolute('/'),
};

export function guide(app: App): string {
  const text = source
    .replace(BLOCK, (_match, apps: string, body: string) =>
      apps.split(' ').includes(app) ? body : '',
    )
    .replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) => {
      if (!(name in VALUES)) throw new Error(`Unknown placeholder ${match} in agent-guide.md`);
      return VALUES[name];
    })
    .replace(/\n{3,}/g, '\n\n');
  return text;
}

/** Serves a guide as raw Markdown. */
export const markdownResponse = (app: App) =>
  new Response(guide(app), {headers: {'content-type': 'text/markdown; charset=utf-8'}});
