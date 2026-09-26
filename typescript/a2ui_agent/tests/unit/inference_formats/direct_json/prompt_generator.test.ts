import {AgentToRendererMessage} from '../../../../src/internal/web_core.js';
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
import {DirectJsonPromptGenerator} from '../../../../src/inference_formats/direct_json/prompt_generator.js';
import {basicCatalog} from '../../../../src/types.js';

describe('DirectJsonPromptGenerator', () => {
  const catalog = basicCatalog();
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
    const instructions = generator.generateCatalogInstructions(true);
    expect(instructions).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(instructions).toContain('---END A2UI JSON SCHEMA---');
    expect(instructions).toContain('### Server To Client Schema:');
    expect(instructions).toContain('### Common Types Schema:');
    expect(instructions).toContain('### Catalog Schema:');
    // Ensure the schema json is present inside the block
    expect(instructions).toContain('"components":{');
  });

  it('generates empty catalog instructions if includeSchema is false', () => {
    const instructions = generator.generateCatalogInstructions(false);
    expect(instructions).toBe('');
  });

  it('generates formatted examples', () => {
    const exampleStr = generator.generateExamples();
    expect(exampleStr).toContain('<a2ui-json>');
    expect(exampleStr).toContain('"createSurface": {');
    expect(exampleStr).toContain('</a2ui-json>');
  });

  it('generates complete prompt with specific options', () => {
    const prompt = generator.generate({
      roleDescription: 'You are a UI agent.',
      workflowDescription: 'Do UI stuff.',
      uiDescription: 'A specific UI context.',
      includeSchema: true,
      includeExamples: true,
    });
    expect(prompt).toContain('You are a UI agent.');
    expect(prompt).toContain('Do UI stuff.');
    expect(prompt).toContain('A specific UI context.');
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
