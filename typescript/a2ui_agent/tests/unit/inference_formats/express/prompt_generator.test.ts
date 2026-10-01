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
import {AgentToRendererMessage} from '../../../../src/internal/web_core.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {
  catalogFromTestDocument,
  loadConformanceCatalog,
  readConformanceCatalog,
} from '../../../helpers/conformance-catalogs.js';
import {A2uiCatalogError} from '../../../../src/errors.js';
import {ExpressPromptGenerator} from '../../../../src/inference_formats/express/prompt_generator.js';

const basicCatalogV10 = await loadBasicCatalog('v1.0');
const basicCatalogV09 = await loadBasicCatalog('v0.9');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ExpressPromptGenerator', () => {
  describe('1. Golden files byte-for-byte check', () => {
    it('generateBaseRules() matches express_base_rules.txt except for its catalog-specific names', () => {
      // The golden still names basic-catalog components, which the conformance pruning case
      // forbids (see KNOWN_GAPS.md). Everything except these substitutions must match it.
      const goldenPath = path.resolve(
        __dirname,
        '../../../../../../conformance/test_data/skills/express_base_rules.txt',
      );
      const substitutions: [string, string][] = [
        ['date-time inputs (e.g. in DateTimeInput)', 'date-time properties'],
        ['itemTemplate = Image($url)', 'itemTemplate = ComponentA($url)'],
        [
          "Parameters named 'action' (or annotated in component signatures)",
          'Action parameters (or parameters annotated in component signatures)',
        ],
        ['root = Card(...)', 'root = ComponentA(...)'],
      ];
      let expected = fs.readFileSync(goldenPath, 'utf8');
      for (const [from, to] of substitutions) {
        expect(expected, `golden should contain '${from}'`).toContain(from);
        expected = expected.replace(from, to);
      }

      const generator = new ExpressPromptGenerator([basicCatalogV10]);
      const actual = generator.generateBaseRules();

      expect(actual).toBe(expected);
      expect(actual).not.toContain('Card(');
      expect(actual).not.toContain('DateTimeInput');
    });

    it('generateCatalogInstructions() for the v1.0 basic catalog matches express_catalog_instructions.txt BYTE FOR BYTE', () => {
      const goldenPath = path.resolve(
        __dirname,
        '../../../../../../conformance/test_data/skills/express_catalog_instructions.txt',
      );
      const expected = fs.readFileSync(goldenPath, 'utf8');

      const cat = basicCatalogV10;
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(cat);

      expect(actual).toBe(expected);
    });
  });

  describe('2. Oracle parity for catalog instructions', () => {
    // The oracle outputs for the v0.9 basic catalog, simplified, forms, and custom catalogs
    // were verified against origin/main's Python oracle.
    it('generates expected instructions for simplified catalog v1.0', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(cat);

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
      const cat = loadConformanceCatalog('forms_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(cat);

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
      const cat = loadConformanceCatalog('custom_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(cat);

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
      const cat = basicCatalogV09;
      const generator = new ExpressPromptGenerator([cat]);
      const actual = generator.generateCatalogInstructions(cat);

      expect(actual).toContain('• AudioPlayer(url, description?, weight? (static))');
      expect(actual).toContain(
        '• Button(child (component ID), variant? (static), action (static), weight? (static), checks? (static))',
      );
      expect(actual).toContain(
        '• TextField(label, value?, variant? (static), validationRegexp? (static), weight? (static), checks? (static))',
      );
    });
  });

  describe('3. Substring expectations from conformance prompt_generator.yaml', () => {
    it('test_express_snippet_names_every_function_of_the_catalog', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('formatString');
      expect(snippet).toContain('openUrl');
    });

    it('test_express_snippet_omits_a_pruned_component', () => {
      // Create a simplified catalog schema pruned to Text
      const schema = readConformanceCatalog('simplified_catalog_v1_0.json');
      const prunedSchema = {
        ...schema,
        components: {
          Text: schema.components.Text,
        },
      };
      const cat = catalogFromTestDocument(prunedSchema);
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('Text(');
      expect(snippet).not.toContain('Button(');
      expect(snippet).not.toContain('Card(');
      expect(snippet).not.toContain('Column(');
    });

    it('test_express_snippet_omits_a_pruned_function', () => {
      // Create a simplified catalog schema pruned to formatString function
      const schema = readConformanceCatalog('simplified_catalog_v1_0.json');
      const prunedSchema = {
        ...schema,
        functions: {
          formatString: schema.functions.formatString,
        },
      };
      const cat = catalogFromTestDocument(prunedSchema);
      const generator = new ExpressPromptGenerator([cat]);
      const instructions = generator.generateCatalogInstructions();

      expect(instructions).toContain('formatString');
      expect(instructions).not.toContain('openUrl');
    });

    it('test_express_snippet_names_both_catalogs_and_their_ids', () => {
      const cat1 = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const cat2 = loadConformanceCatalog('custom_catalog_v1_0.json');
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
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
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
      const snippet = generator.generate();

      expect(snippet).toContain('surface("s1")');
      expect(snippet).toContain('root = Text("Hello")');
    });

    it('test_express_snippet_without_examples_carries_no_example', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('Text(');
      expect(snippet).not.toContain('surface("s1")');
      expect(snippet).not.toContain('root = Text("Hello")');
    });

    it('test_express_snippet_names_its_sentinel_tag', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('<a2ui>');
      expect(snippet).toContain('</a2ui>');
      expect(snippet).not.toContain('<a2ui-json>');
    });

    it('test_express_snippet_describes_positional_signatures', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('Text(');
      expect(snippet).toContain('Button(');
      expect(snippet).toContain('Card(');
      expect(snippet).toContain('Column(');
    });

    it('test_express_snippet_describes_only_the_allowed_envelopes', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat], undefined, [
        'createSurface',
        'updateComponents',
      ]);
      const snippet = generator.generate();

      expect(snippet).toContain('surface(');
      expect(snippet).not.toContain('deleteSurface(');
    });

    it('test_express_snippet_describes_every_envelope_without_an_allowlist', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const snippet = generator.generate();

      expect(snippet).toContain('surface(');
      expect(snippet).toContain('deleteSurface(');
      expect(snippet).toContain('$/');
    });

    it('test_express_snippet_is_deterministic', () => {
      const cat1 = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const cat2 = loadConformanceCatalog('custom_catalog_v1_0.json');
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

      const snippet1 = gen1.generate();
      const snippet2 = gen2.generate();

      expect(snippet1).toBe(snippet2);
      expect(snippet1).toContain('Text(');
      expect(snippet1).toContain('Chart(');
    });

    it('test_express_no_active_catalogs_is_an_error', () => {
      expect(() => new ExpressPromptGenerator([])).toThrow(A2uiCatalogError);
    });

    it('B5: translates fenced json blocks containing updateComponents', () => {
      const cat = loadConformanceCatalog('simplified_catalog_v1_0.json');
      const generator = new ExpressPromptGenerator([cat]);
      const rawMarkdown =
        'Here is an example:\n' +
        '```json\n' +
        '[\n' +
        '  {\n' +
        '    "version": "v0.9",\n' +
        '    "updateComponents": {\n' +
        '      "surfaceId": "s1",\n' +
        '      "components": [\n' +
        '        {\n' +
        '          "id": "root",\n' +
        '          "component": "Text",\n' +
        '          "text": "Hello"\n' +
        '        }\n' +
        '      ]\n' +
        '    }\n' +
        '  }\n' +
        ']\n' +
        '```\n' +
        'Done.';

      const transformed = generator.transformExamples(rawMarkdown, cat);
      expect(transformed).not.toContain('```json');
      expect(transformed).toContain('<a2ui>');
      expect(transformed).toContain('surface("s1")');
      expect(transformed).toContain('root = Text("Hello")');
      expect(transformed).toContain('</a2ui>');
    });

    it('translates fenced v0.9 examples in catalog instructions', () => {
      const doc = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '../../../../../../specification/v0_9/catalogs/basic/catalog.json'),
          'utf8',
        ),
      );
      doc.instructions =
        'Example:\n```json\n' +
        JSON.stringify([
          {version: 'v0.9', createSurface: {surfaceId: 's1', catalogId: basicCatalogV09.id}},
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'root', component: 'Text', text: 'Hello'}],
            },
          },
        ]) +
        '\n```';
      const cat = catalogFromTestDocument(doc);

      const instructions = new ExpressPromptGenerator([cat]).generateCatalogInstructions(cat);
      expect(instructions).not.toContain('```json');
      expect(instructions).toContain('root = Text("Hello")');
    });
  });

  it('prompt lists both catalogs', () => {
    const c1 = basicCatalogV10;
    const c2 = basicCatalogV09;
    const generator = new ExpressPromptGenerator([c1, c2]);
    const instructions = generator.generateCatalogInstructions();
    expect(instructions).toContain(`# Catalog: ${c1.id}`);
    expect(instructions).toContain(`# Catalog: ${c2.id}`);
  });
});
