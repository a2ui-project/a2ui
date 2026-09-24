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

import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, it, expect} from 'vitest';
import {AgentToRendererMessage, Catalog} from '../../../../src/internal/web_core.js';
import {basicCatalog, SchemaCatalog} from '../../../../src/types.js';
import {registerCatalogDocument} from '../../../../src/utils/catalog_document.js';
import {A2uiCatalogError} from '../../../../src/errors.js';
import {ExpressPromptGenerator} from '../../../../src/inference_formats/express/prompt_generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('ExpressPromptGenerator', () => {
  function loadCatalogFixture(fileName: string): SchemaCatalog {
    const schemaPath = path.join(FIXTURES_DIR, fileName);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const cat = Catalog.fromSchema(schema);
    registerCatalogDocument(cat, schema);
    return cat;
  }

  describe('1. Golden files byte-for-byte check', () => {
    it('generateBaseRules() matches express_base_rules.txt BYTE FOR BYTE', () => {
      const goldenPath = path.resolve(
        __dirname,
        '../../../../../../conformance/test_data/skills/express_base_rules.txt',
      );
      const expected = fs.readFileSync(goldenPath, 'utf8');

      const cat = basicCatalog('v1.0');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateBaseRules();

      expect(actual).toBe(expected);
    });

    it('generateCatalogInstructions(basicCatalog("v1.0")) matches express_catalog_instructions.txt BYTE FOR BYTE', () => {
      const goldenPath = path.resolve(
        __dirname,
        '../../../../../../conformance/test_data/skills/express_catalog_instructions.txt',
      );
      const expected = fs.readFileSync(goldenPath, 'utf8');

      const cat = basicCatalog('v1.0');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(true, cat);

      expect(actual).toBe(expected);
    });
  });

  describe('2. Oracle parity for catalog instructions', () => {
    // The oracle outputs for basicCatalog('v0.9'), simplified, forms, and custom catalogs
    // were verified against origin/main's Python oracle.
    it('generates expected instructions for simplified catalog v1.0', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(true, cat);

      const expected =
        '## Positional Component Signatures\n\n' +
        'Use these exact positional signatures to instantiate components. Do not output property keys:\n' +
        '• Button(child (static), action (static))\n' +
        '  - Description: A control that emits an action when pressed.\n' +
        '• Card(child (static))\n' +
        '  - Description: A container holding a single child.\n' +
        '• Column(children)\n' +
        '  - Description: A layout that stacks its children vertically.\n' +
        '• Text(text, variant? (static))\n' +
        '  - Description: Displays a run of text.\n' +
        "  - variant: Must be one of: 'body', 'caption'\n\n" +
        '## Positional Function Signatures\n\n' +
        'Use these exact positional signatures to instantiate check rules or logic functions:\n' +
        '• formatString(value)\n' +
        '  - Description: Interpolates data model values into a template string.\n' +
        '• openUrl(url)\n' +
        "  - Description: Opens a URL in the renderer's browser or handler.\n" +
        '• required(value)\n' +
        '  - Description: Checks that the value is not null, undefined or empty.';

      expect(actual).toBe(expected);
    });

    it('generates expected instructions for forms catalog v1.0', () => {
      const cat = loadCatalogFixture('forms_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(true, cat);

      const expected =
        '## Positional Component Signatures\n\n' +
        'Use these exact positional signatures to instantiate components. Do not output property keys:\n' +
        '• TextField(label, value?, placeholder?, checks? (static))\n' +
        '  - Description: A single line text input.\n\n' +
        '## Positional Function Signatures\n\n' +
        'Use these exact positional signatures to instantiate check rules or logic functions:\n' +
        '• regex(value, pattern)\n' +
        '  - Description: Checks the value against a regular expression.\n' +
        '• required(value)\n' +
        '  - Description: Checks that the value is not null, undefined or empty.';

      expect(actual).toBe(expected);
    });

    it('generates expected instructions for custom catalog v1.0', () => {
      const cat = loadCatalogFixture('custom_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(true, cat);

      const expected =
        '## Positional Component Signatures\n\n' +
        'Use these exact positional signatures to instantiate components. Do not output property keys:\n' +
        '• Chart(values (static), caption? (static))\n' +
        '  - Description: Plots a series of numbers.\n' +
        '• Gauge(value (static))\n' +
        '  - Description: Shows a single value on a scale.\n\n' +
        '## Positional Function Signatures\n\n' +
        'Use these exact positional signatures to instantiate check rules or logic functions:\n' +
        '• percent(value)\n' +
        '  - Description: Renders a ratio as a percentage string.';

      expect(actual).toBe(expected);
    });

    it('generates expected instructions for basic catalog v0.9', () => {
      const cat = basicCatalog('v0.9');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(true, cat);

      expect(actual).toContain('• AudioPlayer(url, description?)');
      expect(actual).toContain(
        '• Button(child (component ID), variant? (static), action (static), checks? (static))',
      );
      expect(actual).toContain(
        '• TextField(label, value?, variant? (static), validationRegexp? (static), checks? (static))',
      );
    });
  });

  describe('3. Substring expectations from conformance prompt_generator.yaml', () => {
    it('test_express_snippet_names_every_function_of_the_catalog', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('formatString');
      expect(snippet).toContain('openUrl');
    });

    it('test_express_snippet_omits_a_pruned_component', () => {
      // Create a simplified catalog schema pruned to Text
      const schemaPath = path.join(FIXTURES_DIR, 'simplified_catalog_v1_0.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const prunedSchema = {
        ...schema,
        components: {
          Text: schema.components.Text,
        },
      };
      const cat = Catalog.fromSchema(prunedSchema);
      registerCatalogDocument(cat, prunedSchema);
      const generator = new ExpressPromptGenerator([cat]);
      const instructions = generator.generateCatalogInstructions(true);

      expect(instructions).toContain('Text(');
      expect(instructions).not.toContain('Button(');
      expect(instructions).not.toContain('Card(');
      expect(instructions).not.toContain('Column(');
    });

    it('test_express_snippet_omits_a_pruned_function', () => {
      // Create a simplified catalog schema pruned to formatString function
      const schemaPath = path.join(FIXTURES_DIR, 'simplified_catalog_v1_0.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const prunedSchema = {
        ...schema,
        functions: {
          formatString: schema.functions.formatString,
        },
      };
      const cat = Catalog.fromSchema(prunedSchema);
      registerCatalogDocument(cat, prunedSchema);
      const generator = new ExpressPromptGenerator([cat]);
      const instructions = generator.generateCatalogInstructions(true);

      expect(instructions).toContain('formatString');
      expect(instructions).not.toContain('openUrl');
    });

    it('test_express_snippet_names_both_catalogs_and_their_ids', () => {
      const cat1 = loadCatalogFixture('simplified_catalog_v1_0.json');
      const cat2 = loadCatalogFixture('custom_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat1, cat2]);
      const snippet = generator.generate();

      expect(snippet).toContain('conformance/simplified');
      expect(snippet).toContain('conformance/custom');
      expect(snippet).toContain('Text(');
      expect(snippet).toContain('Column(');
      expect(snippet).toContain('Chart(');
      expect(snippet).toContain('Gauge(');
      expect(snippet).toContain('openUrl');
      expect(snippet).toContain('percent');
    });

    it('test_express_snippet_renders_supplied_examples', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const examples: Record<string, AgentToRendererMessage[]> = {
        [cat.id]: [
          {
            version: 'v1.0',
            createSurface: {
              surfaceId: 's1',
              catalogId: 'conformance/simplified',
            },
          },
          {
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [
                {
                  id: 'root',
                  component: 'Text',
                  text: 'Hello',
                },
              ],
            },
          },
        ] as AgentToRendererMessage[],
      };
      const generator = new ExpressPromptGenerator([cat], examples);
      const snippet = generator.generate({includeExamples: true});

      expect(snippet).toContain('surface("s1")');
      expect(snippet).toContain('root = Text("Hello")');
    });

    it('test_express_snippet_without_examples_carries_no_example', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate({includeExamples: false});

      expect(snippet).toContain('Text(');
      expect(snippet).not.toContain('surface("s1")');
      expect(snippet).not.toContain('root = Text("Hello")');
    });

    it('test_express_snippet_names_its_sentinel_tag', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('<a2ui>');
      expect(snippet).toContain('</a2ui>');
      expect(snippet).not.toContain('<a2ui-json>');
    });

    it('test_express_snippet_describes_positional_signatures', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('Text(');
      expect(snippet).toContain('Button(');
      expect(snippet).toContain('Card(');
      expect(snippet).toContain('Column(');
    });

    it('test_express_snippet_describes_only_the_allowed_envelopes', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate({
        allowedMessages: ['createSurface', 'updateComponents'],
      });

      expect(snippet).toContain('surface(');
      expect(snippet).not.toContain('deleteSurface(');
    });

    it('test_express_snippet_describes_every_envelope_without_an_allowlist', () => {
      const cat = loadCatalogFixture('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('surface(');
      expect(snippet).toContain('deleteSurface(');
      expect(snippet).toContain('$/');
    });

    it('test_express_snippet_is_deterministic', () => {
      const cat1 = loadCatalogFixture('simplified_catalog_v1_0.json');
      const cat2 = loadCatalogFixture('custom_catalog_v1_0.json');
      const examples: Record<string, AgentToRendererMessage[]> = {
        [cat1.id]: [
          {
            version: 'v1.0',
            createSurface: {
              surfaceId: 's1',
              catalogId: 'conformance/simplified',
            },
          },
          {
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [
                {
                  id: 'root',
                  component: 'Text',
                  text: 'Hello',
                },
              ],
            },
          },
        ] as AgentToRendererMessage[],
      };
      const gen1 = new ExpressPromptGenerator([cat1, cat2], examples);
      const gen2 = new ExpressPromptGenerator([cat1, cat2], examples);

      const snippet1 = gen1.generate({includeExamples: true});
      const snippet2 = gen2.generate({includeExamples: true});

      expect(snippet1).toBe(snippet2);
      expect(snippet1).toContain('Text(');
      expect(snippet1).toContain('Chart(');
    });

    it('test_express_no_active_catalogs_is_an_error', () => {
      const generator = new ExpressPromptGenerator([]);
      expect(() => generator.generate()).toThrow(A2uiCatalogError);
    });
  });
});
