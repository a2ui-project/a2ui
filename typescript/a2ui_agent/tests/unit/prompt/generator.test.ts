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
import {A2uiCatalogError} from '../../../src/errors.js';
import {PromptGenerator} from '../../../src/prompt/generator.js';
import {SchemaCatalog} from '../../../src/types.js';

class TestPromptGenerator extends PromptGenerator {
  generateBaseRules(): string {
    return 'BASE_RULES';
  }

  protected renderCatalogInstructions(catalog: SchemaCatalog): string {
    return `CATALOG_INSTRUCTIONS:${catalog.id}`;
  }

  protected renderExamples(catalog: SchemaCatalog): string {
    if (catalog.id === 'empty') return ''; // Test filtering
    return `EXAMPLES:${catalog.id}`;
  }
}

describe('PromptGenerator', () => {
  const cat1 = {id: 'cat1'} as SchemaCatalog;
  const cat2 = {id: 'cat2'} as SchemaCatalog;
  const catEmpty = {id: 'empty'} as SchemaCatalog;

  it('generate() joins base rules, catalog instructions and examples in order', () => {
    const generator = new TestPromptGenerator([cat1]);
    expect(generator.generate()).toBe('BASE_RULES\n\nCATALOG_INSTRUCTIONS:cat1\n\nEXAMPLES:cat1');
  });

  it('generate() leaves out sections that render nothing', () => {
    const generator = new TestPromptGenerator([catEmpty]);
    expect(generator.generate()).toBe('BASE_RULES\n\nCATALOG_INSTRUCTIONS:empty');
  });

  it('refuses an empty catalog list', () => {
    expect(() => new TestPromptGenerator([])).toThrow(A2uiCatalogError);
  });

  it('generateCatalogInstructions processes all active catalogs by default', () => {
    const generator = new TestPromptGenerator([cat1, cat2]);
    const instructions = generator.generateCatalogInstructions();

    expect(instructions).toContain('cat1');
    expect(instructions).toContain('cat2');
  });

  it('generateCatalogInstructions processes a single catalog if provided', () => {
    const generator = new TestPromptGenerator([cat1, cat2]);
    const instructions = generator.generateCatalogInstructions(cat1);

    expect(instructions).toContain('cat1');
    expect(instructions).not.toContain('cat2');
  });

  it('generateExamples processes all active catalogs and filters empty', () => {
    const generator = new TestPromptGenerator([cat1, catEmpty, cat2]);
    const examples = generator.generateExamples();

    expect(examples).toContain('EXAMPLES:cat1');
    expect(examples).toContain('EXAMPLES:cat2');
    expect(examples).not.toContain('empty');
  });
});
