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

// Every example and the stub notice must validate against the basic catalog, for
// each version and format. The Python sample does the same in
// samples/agent/adk/tests/test_examples_validation.py.

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {
  A2uiGenerator,
  type AgentToRendererMessage,
  CatalogConfig,
  ExpressDecompiler,
  ExpressFormatFactory,
} from '@a2ui/agent';
import {describe, expect, it} from 'vitest';

import {loadBasicCatalogs} from '../src/catalogs.js';
import type {A2uiFormat} from '../src/config.js';
import {loadExamples} from '../src/examples.js';
import {VERSIONS, type VersionProfile} from '../src/versions.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const FORMATS: A2uiFormat[] = ['direct_json', 'express'];
const catalogs = await loadBasicCatalogs();

/** Parses a model response the way the agent does, throwing if it is invalid. */
function validate(profile: VersionProfile, format: A2uiFormat, response: string) {
  const catalog = catalogs.get(profile.version)!;
  const generator = new A2uiGenerator([new CatalogConfig(catalog)]);
  const capabilities = {supportedCatalogIds: [catalog.id]};
  const processor =
    format === 'express'
      ? generator.createProcessor(capabilities, new ExpressFormatFactory({surfaceId: 'default'}))
      : generator.createProcessor(capabilities);
  const parts = processor.parseResponse(response);
  expect(parts.some(part => part.type === 'a2ui')).toBe(true);
}

/** Turns a JSON file of A2UI messages into the response text for a format. */
function asResponse(profile: VersionProfile, format: A2uiFormat, raw: string): string {
  if (format === 'direct_json') {
    return `<a2ui-json>\n${raw}\n</a2ui-json>`;
  }
  const decompiler = new ExpressDecompiler(catalogs.get(profile.version)!, profile.version);
  const messages = JSON.parse(raw) as AgentToRendererMessage[];
  return decompiler.wrapDecompiledBlocks([decompiler.decompile(messages)]);
}

describe.each(VERSIONS)('$version', profile => {
  const exampleNames = fs
    .readdirSync(path.join(packageRoot, 'examples', profile.version))
    .filter(file => file.endsWith('.json'))
    .map(file => path.parse(file).name)
    .sort();

  describe.each(FORMATS)('%s', format => {
    const {exampleBlocks} = loadExamples(
      profile,
      catalogs.get(profile.version)!,
      format,
      packageRoot,
    );

    it.each(exampleNames)('examples/%s.json validates', name => {
      const block = exampleBlocks[name];
      expect(block).toBeDefined();
      validate(
        profile,
        format,
        format === 'direct_json' ? asResponse(profile, format, block) : block,
      );
    });

    it(`stub_notice/${profile.version}.json validates`, () => {
      const raw = fs.readFileSync(
        path.join(packageRoot, 'stub_notice', `${profile.version}.json`),
        'utf-8',
      );
      validate(profile, format, asResponse(profile, format, raw));
    });
  });
});
