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

import {describe, it, expect} from 'vitest';
import {PromptGenerator} from '../../../src/prompt/generator.js';
import {SchemaCatalog} from '../../../src/types.js';

class TestPromptGenerator extends PromptGenerator {
  generateBaseRules(): string {
    return 'BASE_RULES';
  }

  protected renderCatalogInstructions(catalog: SchemaCatalog, includeSchema: boolean): string {
    return `CATALOG_INSTRUCTIONS:${catalog.id}:includeSchema=${includeSchema}`;
  }

  protected renderExamples(catalog: SchemaCatalog, validate: boolean): string {
    if (catalog.id === 'empty') return ''; // Test filtering
    return `EXAMPLES:${catalog.id}:validate=${validate}`;
  }
}

describe('PromptGenerator', () => {
  const cat1 = {id: 'cat1'} as SchemaCatalog;
  const cat2 = {id: 'cat2'} as SchemaCatalog;
  const catEmpty = {id: 'empty'} as SchemaCatalog;

  it('generate() composes sections correctly with defaults', () => {
    const generator = new TestPromptGenerator([cat1]);
    const prompt = generator.generate();

    expect(prompt).toContain('BASE_RULES');
    expect(prompt).toContain('CATALOG_INSTRUCTIONS:cat1:includeSchema=true');
    expect(prompt).not.toContain('EXAMPLES');
  });

  it('generate() includes descriptions if provided', () => {
    const generator = new TestPromptGenerator([cat1]);
    const prompt = generator.generate({
      roleDescription: 'ROLE',
      workflowDescription: 'WORKFLOW',
      uiDescription: 'UI',
    });

    expect(prompt).toContain('ROLE');
    expect(prompt).toContain('WORKFLOW');
    expect(prompt).toContain('UI');
    expect(prompt).toContain('BASE_RULES');
  });

  it('generate() includes examples when includeExamples is true', () => {
    const generator = new TestPromptGenerator([cat1]);
    const prompt = generator.generate({
      includeExamples: true,
      validateExamples: true,
    });

    expect(prompt).toContain('EXAMPLES:cat1:validate=true');
  });

  it('generateCatalogInstructions processes all bound catalogs by default', () => {
    const generator = new TestPromptGenerator([cat1, cat2]);
    const instructions = generator.generateCatalogInstructions();

    expect(instructions).toContain('cat1');
    expect(instructions).toContain('cat2');
    expect(instructions).toContain('includeSchema=true');
  });

  it('generateCatalogInstructions processes a single catalog if provided', () => {
    const generator = new TestPromptGenerator([cat1, cat2]);
    const instructions = generator.generateCatalogInstructions(false, cat1);

    expect(instructions).toContain('cat1');
    expect(instructions).not.toContain('cat2');
    expect(instructions).toContain('includeSchema=false');
  });

  it('generateExamples processes all bound catalogs and filters empty', () => {
    const generator = new TestPromptGenerator([cat1, catEmpty, cat2]);
    const examples = generator.generateExamples();

    expect(examples).toContain('EXAMPLES:cat1');
    expect(examples).toContain('EXAMPLES:cat2');
    expect(examples).not.toContain('empty');
  });
});
