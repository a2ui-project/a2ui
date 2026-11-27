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

import {describe, expect, it} from 'vitest';

import {ExpressCompiler} from '../../../../src/inference-formats/express/compiler.js';
import {ExpressDecompiler} from '../../../../src/inference-formats/express/decompiler.js';
import {ExpressPromptGenerator} from '../../../../src/inference-formats/express/prompt-generator.js';
import {CatalogSchemaHelper} from '../../../../src/inference-formats/express/schema-helper.js';
import {Catalog} from '../../../../src/internal/web-core.js';

describe('Express inference format with canonical Catalog Document (zero-Zod)', () => {
  const catalogDoc = {
    formatVersion: '1.0',
    catalogId: 'https://example.com/express-doc-catalog/v1',
    protocolVersion: '1.0',
    title: 'Express Doc Catalog',
    types: {
      Tone: {type: 'enum', values: ['neutral', 'positive', 'critical']},
    },
    components: [
      {
        name: 'Layout',
        description: 'Vertical container.',
        parameters: [{name: 'children', type: 'childList', required: true}],
      },
      {
        name: 'Metric',
        description: 'Displays a metric with optional validation checks.',
        checkable: true,
        parameters: [
          {name: 'title', type: 'string', dynamic: true, required: true},
          {name: 'tone', type: 'ref', ref: 'Tone'},
          {name: 'metadata', type: 'string'},
          {name: 'action', type: 'action'},
        ],
      },
    ],
    functions: [
      {
        name: 'isPositive',
        description: 'Checks whether a value is positive.',
        returnType: 'boolean',
        parameters: [{name: 'value', type: 'number', dynamic: true, required: true}],
      },
    ],
  };

  it('reads canonical ComponentDefinition and FunctionDefinition directly in CatalogSchemaHelper', () => {
    const catalog = Catalog.fromDocument(catalogDoc);
    expect(catalog.components.get('Metric')?.schema).toBeUndefined();
    expect(catalog.components.get('Metric')?.definition).toBeDefined();

    const helper = new CatalogSchemaHelper(catalog, '1.0');
    expect(helper.getComponentProperties('Layout')).toEqual(['children']);
    expect(helper.getComponentRequired('Layout')).toEqual(['children']);
    expect(helper.getComponentProperties('Metric')).toEqual([
      'title',
      'tone',
      'metadata',
      'action',
      'checks',
    ]);
    expect(helper.getComponentRequired('Metric')).toEqual(['title']);
    expect(helper.isCheckable('Metric')).toBe(true);
    expect(helper.isCheckable('Layout')).toBe(false);
    expect(helper.getCustomEnvelopeProperties('Metric').has('metadata')).toBe(true);
    expect(helper.getPropertyEnum('Metric', 'tone')).toEqual(['neutral', 'positive', 'critical']);
    expect(helper.getComponentDescription('Metric')).toBe(
      'Displays a metric with optional validation checks.',
    );

    expect(helper.getFunctionProperties('isPositive')).toEqual(['value']);
    expect(helper.getFunctionRequired('isPositive')).toEqual(['value']);
    expect(helper.getFunctionDescription('isPositive')).toBe('Checks whether a value is positive.');
    expect(helper.admitsPath(helper.getPropertySchema('Metric', 'title'))).toBe(true);
    expect(helper.admitsPath(helper.getPropertySchema('Metric', 'metadata'))).toBe(false);
  });

  it('generates Express prompts, compiles DSL to v1.0 JSON envelopes, and decompiles back', () => {
    const catalog = Catalog.fromDocument(catalogDoc);
    const promptGen = new ExpressPromptGenerator([catalog]);
    const prompt = promptGen.generate();
    expect(prompt).toContain('Metric(');
    expect(prompt).toContain('isPositive(');
    expect(prompt).toContain('neutral');

    const compiler = new ExpressCompiler([catalog]);
    const dsl = `
      m1 = Metric($/kpi/title, tone="positive", metadata="src-a", action=Event("inspect"))
      root = Layout([m1])
    `;
    const messages = compiler.compile(dsl, 'surf1');
    const components = messages.flatMap(m => {
      if ('createSurface' in m && Array.isArray(m.createSurface?.components)) {
        return m.createSurface.components as Array<Record<string, unknown>>;
      }
      if ('updateComponents' in m && Array.isArray(m.updateComponents?.components)) {
        return m.updateComponents.components as Array<Record<string, unknown>>;
      }
      return [];
    });
    const metric = components.find(c => c['component'] === 'Metric');
    expect(metric).toBeDefined();
    expect(metric!['title']).toEqual({'@path': '/kpi/title'});
    expect(metric!['tone']).toBe('positive');
    expect(metric!['metadata']).toBe('src-a');
    expect(metric!['action']).toEqual({event: {name: 'inspect'}});

    const decompiler = new ExpressDecompiler([catalog], '1.0');
    const roundTrippedDsl = decompiler.decompile(messages);
    expect(roundTrippedDsl).toContain('Metric');
    expect(roundTrippedDsl).toContain('Layout');
  });
});
