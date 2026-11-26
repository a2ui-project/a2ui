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

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {CatalogSchemaFileSchema, CONTRACT_VERSION} from '../contract/index.js';
import {APP_SIZE_WARNING_BYTES, buildApp} from './build.js';
import {findExternalReferences} from './html.js';
import {
  createFixtureProject,
  GREETING_CATALOG_MODULE,
  type FixtureProject,
} from './testing/fixture_project.js';

const GREETING_ID = 'https://example.com/catalogs/greeting.json';

describe('buildApp', () => {
  let project: FixtureProject;

  beforeEach(async () => {
    project = await createFixtureProject();
    await project.write({'src/catalog.ts': GREETING_CATALOG_MODULE});
  });

  afterEach(() => project.remove());

  const build = (config?: string) =>
    buildApp({cwd: project.dir, config, runtimeModule: project.runtime});

  it('loads a TypeScript config that uses defineConfig and basicCatalog', async () => {
    await project.write({
      'a2ui-embed.config.ts': `
import {basicCatalog, defineConfig} from '@a2ui/embed/build';
import {greetingCatalog} from './src/catalog.ts';

const title: string = 'Greeter';
export default defineConfig({catalogs: [basicCatalog, greetingCatalog], output: 'dist/app.html', title});
`,
    });

    const result = await build();

    assert.equal(result.htmlPath, join(project.dir, 'dist/app.html'));
    assert.equal(result.catalogSchemaPath, join(project.dir, 'dist/app.catalog.json'));
    const schemaFile = CatalogSchemaFileSchema.parse(
      JSON.parse(await readFile(result.catalogSchemaPath, 'utf8')),
    );
    assert.deepEqual(Object.keys(schemaFile.catalogs), [
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      GREETING_ID,
    ]);
    const html = await readFile(result.htmlPath, 'utf8');
    assert.match(html, /<title>Greeter<\/title>/);
    assert.equal(result.htmlBytes, Buffer.byteLength(html));
    assert.deepEqual(result.warnings, []);
  });

  it('loads a JavaScript config from --config', async () => {
    await project.write({
      'configs/embed.mjs': `
import {greetingCatalog} from '../src/catalog.ts';
export default {catalogs: [greetingCatalog], output: '../out/greeter.html'};
`,
    });

    const result = await build('configs/embed.mjs');

    assert.equal(result.htmlPath, join(project.dir, 'out/greeter.html'));
    assert.match(await readFile(result.htmlPath, 'utf8'), /<title>A2UI app<\/title>/);
  });

  it('writes the catalog schema file from the catalog validation schemas', async () => {
    await project.write({
      'src/guided_catalog.ts': `
import {Catalog} from '@a2ui/web_core';
import {z} from 'zod';

export const guidedCatalog = new Catalog(
  '${GREETING_ID}',
  '1.0',
  [{name: 'Greeting', schema: z.object({text: z.string().describe('The greeting to show.')})}],
  [],
  {instructions: 'Greet the user concisely.'},
);
`,
      'a2ui-embed.config.mjs': `
import {guidedCatalog} from './src/guided_catalog.ts';
export default {catalogs: [guidedCatalog], output: 'app.html'};
`,
    });

    const result = await build();

    const schemaFile = JSON.parse(await readFile(result.catalogSchemaPath, 'utf8'));
    assert.equal(schemaFile.contractVersion, CONTRACT_VERSION);
    const schema = schemaFile.catalogs[GREETING_ID];
    assert.equal(schema.catalogId, GREETING_ID);
    assert.equal(schema.protocolVersion, '1.0');
    assert.equal(schema.instructions, 'Greet the user concisely.');
    assert.deepEqual(Object.keys(schema.components), ['Greeting']);
    assert.match(JSON.stringify(schema.components.Greeting), /The greeting to show\./);
  });

  it('writes one HTML file with the bundle inline and no network references', async () => {
    await project.write({
      'styles.css': '.greeting { color: rebeccapurple; }',
      'a2ui-embed.config.mjs': `
import './styles.css';
import {greetingCatalog} from './src/catalog.ts';
export default {catalogs: [greetingCatalog], output: 'app.html'};
`,
    });

    const html = await readFile((await build()).htmlPath, 'utf8');

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<main id="a2ui-root"><\/main>/);
    assert.match(html, /<style>\.greeting\{color:#639\}\s*<\/style>/);
    assert.equal(html.match(/<script\b/g)?.length, 1);
    assert.match(html, /<script type="module">/);
    // The runtime's '</script><!--' string is escaped, so the only closing tag is the real one.
    assert.equal(html.match(/<\/script/gi)?.length, 1);
    assert.doesNotMatch(html, /<!--/);
    assert.deepEqual(findExternalReferences(html), []);
  });

  it('fails when the app imports a module from the network', async () => {
    await project.write({
      'a2ui-embed.config.mjs': `
import {greetingCatalog} from './src/catalog.ts';
globalThis.later = () => import('https://cdn.example.com/chart.js');
export default {catalogs: [greetingCatalog], output: 'app.html'};
`,
    });

    await assert.rejects(build(), /load these resources from the network[^]*cdn\.example\.com/);
  });

  it('warns when the app is larger than the warning size', async () => {
    const padding = 'x'.repeat(APP_SIZE_WARNING_BYTES);
    await project.write({
      'a2ui-embed.config.mjs': `
import {greetingCatalog} from './src/catalog.ts';
globalThis.padding = '${padding}';
export default {catalogs: [greetingCatalog], output: 'app.html'};
`,
    });

    const {warnings} = await build();

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /above 5\.00 MiB/);
  });

  describe('errors', () => {
    const writeConfig = (body: string) =>
      project.write({
        'a2ui-embed.config.mjs': `import {greetingCatalog} from './src/catalog.ts';\n${body}`,
      });

    it('reports a missing config file', async () => {
      await assert.rejects(build(), /No config file found in .*a2ui-embed\.config\.ts/);
    });

    it('reports a config without a default export', async () => {
      await writeConfig('export const config = {};');
      await assert.rejects(build(), /the default export must be the config object/);
    });

    it('reports missing catalogs', async () => {
      await writeConfig("export default {catalogs: [], output: 'app.html'};");
      await assert.rejects(build(), /`catalogs` must list at least one catalog/);
    });

    it('reports a catalog entry that is not a catalog', async () => {
      await writeConfig(
        "export default {catalogs: [greetingCatalog, './catalog.ts'], output: 'app.html'};",
      );
      await assert.rejects(build(), /`catalogs\[1\]` is not a catalog/);
    });

    it('reports duplicate catalog IDs', async () => {
      await writeConfig(
        "export default {catalogs: [greetingCatalog, greetingCatalog], output: 'app.html'};",
      );
      await assert.rejects(build(), /Two catalogs share the ID "https:\/\/example\.com/);
    });

    it('reports an output that is not an HTML file', async () => {
      await writeConfig("export default {catalogs: [greetingCatalog], output: 'app.js'};");
      await assert.rejects(build(), /`output` must be the path of an `\.html` file/);
    });

    it('reports an unknown renderer', async () => {
      await writeConfig(
        "export default {catalogs: [greetingCatalog], renderer: 'react', output: 'app.html'};",
      );
      await assert.rejects(build(), /unknown renderer "react"/);
    });

    it('reports a config importing a module that does not exist', async () => {
      await project.write({
        'a2ui-embed.config.mjs': "import {x} from './missing.ts';\nexport default x;",
      });
      await assert.rejects(build(), /Could not bundle the config file[^]*missing\.ts/);
    });

    it('reports a catalog module that fails to load in Node', async () => {
      await project.write({
        'src/broken.ts': "document.title = 'needs a browser';\nexport const broken = 1;",
        'a2ui-embed.config.mjs': "import {broken} from './src/broken.ts';\nexport default broken;",
      });
      await assert.rejects(build(), /must load in Node[^]*document is not defined/);
    });

    it('reports a config that does not bundle for the browser', async () => {
      await writeConfig(
        "import {cwd} from 'node:process';\nexport default {catalogs: [greetingCatalog], output: cwd() + '/app.html'};",
      );
      await assert.rejects(build(), /must also run in the browser[^]*node:process/);
    });
  });
});
