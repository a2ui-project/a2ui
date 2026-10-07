import {AgentToRendererMessage} from '../../../../src/internal/web-core.js';
/**
 * @license
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

import {describe, it, expect} from 'vitest';
import {DirectJsonPromptGenerator} from '../../../../src/inference-formats/direct-json/prompt-generator.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';

const basicCatalogV10 = await loadBasicCatalog('v1.0');

describe('DirectJsonPromptGenerator', () => {
  const catalog = basicCatalogV10;
  const examples = {
    [catalog.id]: [
      {version: '1.0', createSurface: {surfaceId: 'example'}},
    ] as unknown as AgentToRendererMessage[],
  };
  const generator = new DirectJsonPromptGenerator([catalog], examples);

  it('generates base rules', () => {
    const baseRules = generator.generateBaseRules();
    expect(baseRules).toContain('The generated response MUST follow these rules:');
    expect(baseRules).toContain('Top-Down Component Ordering');
  });

  it('generates catalog instructions with schema block', () => {
    const instructions = generator.generateCatalogInstructions();
    expect(instructions).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(instructions).toContain('---END A2UI JSON SCHEMA---');
    expect(instructions).toContain(`### Messages (${catalog.protocolVersion}):`);
    expect(instructions).toContain(`### Catalog ${catalog.id}:`);
    // Ensure the schema json is present inside the block
    expect(instructions).toContain('"components":{');
  });

  it('describes each protocol version once, however many catalogs use it', () => {
    const twoCatalogs = new DirectJsonPromptGenerator([catalog, catalog]);
    const instructions = twoCatalogs.generateCatalogInstructions();
    expect(instructions.split('### Messages (').length).toBe(2);
  });

  it('describes only the allowed envelopes', () => {
    const limited = new DirectJsonPromptGenerator([catalog], undefined, ['createSurface']);
    const instructions = limited.generateCatalogInstructions();
    expect(instructions).toContain('"createSurface"');
    expect(instructions).not.toContain('"deleteSurface"');
  });

  it('keeps generator markers out of the message schemas', () => {
    expect(generator.generateCatalogInstructions()).not.toContain('REF:');
  });

  it('generates formatted examples', () => {
    const exampleStr = generator.generateExamples();
    expect(exampleStr).toContain('<a2ui-json>');
    expect(exampleStr).toContain('"createSurface": {');
    expect(exampleStr).toContain('</a2ui-json>');
  });

  it('generates the snippet with rules, schemas and examples', () => {
    const prompt = generator.generate();
    expect(prompt).toContain('The generated response MUST follow these rules:');
    expect(prompt).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(prompt).toContain('<a2ui-json>');
    expect(prompt).toContain('"createSurface": {');
  });

  it('inserts a preformatted string example verbatim', () => {
    const text = '---BEGIN confirmation---\n[{"version": "v1.0"}]\n---END confirmation---';
    const stringGenerator = new DirectJsonPromptGenerator([catalog], {[catalog.id]: text});
    expect(stringGenerator.generateExamples()).toBe(text);
  });
});
