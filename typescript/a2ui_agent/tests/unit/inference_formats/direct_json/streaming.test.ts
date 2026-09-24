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

import {describe, test, expect} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {DirectJsonStreamProcessorImpl} from '../../../../src/inference_formats/direct_json/streaming.js';
import {SchemaCatalog} from '../../../../src/types.js';
import {Catalog, ComponentApi} from '../../../../src/internal/web_core.js';
import {z} from 'zod';

interface TestCase {
  name: string;
  catalog: any;
  steps: {
    input: string;
    expect?: any;
    expectError?: any;
  }[];
}

const casesPath = path.resolve(
  __dirname,
  '../../../../tests/streaming_cases/v1_0_direct_json.yaml',
);
const casesContent = fs.readFileSync(casesPath, 'utf8');
const docs = yaml.loadAll(casesContent) as TestCase[][];
const cases = docs.flat();

describe('Direct JSON Streaming Healer v1.0', () => {
  for (const tc of cases) {
    test(tc.name, () => {
      // Mock catalog based on the YAML
      const catalogSchema = tc.catalog.catalogSchema || {};
      const componentsMap = new Map<string, ComponentApi>();
      if (catalogSchema.components) {
        for (const [name, def] of Object.entries(catalogSchema.components)) {
          componentsMap.set(name, {
            name,
            schema: def,
          } as ComponentApi);
        }
      }

      if (!componentsMap.has('Row')) {
        componentsMap.set('Row', {name: 'Row', schema: {}} as ComponentApi);
      }

      const catalog: SchemaCatalog = new Catalog(
        'https://test.com/catalog.json',
        Array.from(componentsMap.values()),
        [],
        undefined,
        undefined,
        'v1.0',
      );

      // Set up cuttable keys
      const progressiveKeys = ['text', 'literalString'];

      const processor = new DirectJsonStreamProcessorImpl(catalog, {progressiveKeys});

      // Inject refMap because the mock catalog uses JSON schemas instead of Zod schemas
      const refMap: any = {};
      if (catalogSchema.components) {
        for (const [name, def] of Object.entries(catalogSchema.components) as any) {
          const singleRefs = new Set<string>();
          const listRefs = new Set<string>();
          if (def.properties) {
            for (const [propName, propDef] of Object.entries(def.properties) as any) {
              if (propDef.title === 'ComponentId' || propDef.title === 'ChildComponentId') {
                singleRefs.add(propName);
              } else if (propDef.type === 'array' && propDef.items?.title === 'ComponentId') {
                listRefs.add(propName);
              } else if (propName === 'children') {
                listRefs.add(propName);
              } else if (propName === 'child') {
                singleRefs.add(propName);
              }
            }
          }
          refMap[name] = {singleRefs, listRefs};
        }
      }
      (processor as any).refMap = refMap;

      for (const step of tc.steps) {
        if (step.expectError) {
          let expectedCategory = step.expectError;
          if (typeof step.expectError === 'object' && step.expectError.category) {
            expectedCategory = step.expectError.category;
          }
          if (expectedCategory === 'RecursionError') {
            expect(() => processor.processChunk(step.input)).toThrowError(/Circular/);
          } else if (expectedCategory === 'IntegrityError') {
            expect(() => processor.processChunk(step.input)).toThrowError(/Integrity/);
          } else {
            expect(() => processor.processChunk(step.input)).toThrowError();
          }
        } else if (step.expect) {
          const parts = processor.processChunk(step.input);
          const adaptedParts = parts.map(p => {
            if (p.type === 'a2ui' && Array.isArray(p.a2ui)) {
              for (const m of p.a2ui) {
                if (m.version) delete (m as any).version;
              }
            }
            if (p.type === 'text') {
              return {text: p.text};
            }
            return {a2ui: p.a2ui};
          });
          expect(adaptedParts).toEqual(step.expect);
        } else {
          processor.processChunk(step.input);
        }
      }
    });
  }
});

describe('Direct JSON Streaming protocol version and placeholder', () => {
  test('synthesised partial messages carry protocolVersion from catalog instead of hardcoded v1.0', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [{name: 'Row', schema: {}} as ComponentApi, {name: 'Text', schema: {}} as ComponentApi],
      [],
      undefined,
      undefined,
      'v0.9',
    );

    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      Row: {singleRefs: new Set(), listRefs: new Set(['children'])},
      Text: {singleRefs: new Set(), listRefs: new Set()},
    };

    // Test synthesized updateComponents partial message
    const compChunk =
      '<a2ui-json>[{"createSurface": {"surfaceId": "s1"}}, {"updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Text"}]}}]</a2ui-json>';
    const compParts = processor.processChunk(compChunk);
    const compA2uiParts = compParts.filter(p => p.type === 'a2ui');
    const updateComponentsPart = compA2uiParts
      .flatMap(p => (Array.isArray(p.a2ui) ? p.a2ui : []))
      .find(m => typeof m === 'object' && m !== null && 'updateComponents' in m);
    expect(updateComponentsPart).toBeDefined();
    expect((updateComponentsPart as Record<string, unknown>).version).toBe('v0.9');

    // Test synthesized updateDataModel delta partial message
    const dmChunk = '<a2ui-json>[{"updateDataModel": {"surfaceId": "s1", "value": {"counter": 42';
    const dmParts = processor.processChunk(dmChunk);
    const dmMsg = dmParts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => (Array.isArray(p.a2ui) ? p.a2ui : []))
      .find(m => typeof m === 'object' && m !== null && 'updateDataModel' in m);
    expect(dmMsg).toBeDefined();
    expect((dmMsg as Record<string, unknown>).version).toBe('v0.9');
  });

  test('placeholder component uses empty array for children instead of explicitList', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [{name: 'Row', schema: {}} as ComponentApi, {name: 'Card', schema: {}} as ComponentApi],
      [],
      undefined,
      undefined,
      'v1.0',
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    expect((processor as unknown as {placeholderComponent: unknown}).placeholderComponent).toEqual({
      component: 'Row',
      children: [],
    });

    (processor as unknown as {refMap: unknown}).refMap = {
      Card: {singleRefs: new Set(['child']), listRefs: new Set()},
      Row: {singleRefs: new Set(), listRefs: new Set()},
    };

    const chunk =
      '<a2ui-json>[{"createSurface": {"surfaceId": "s1", "root": "c1"}}, {"updateComponents": {"surfaceId": "s1", "components": [{"id": "c1", "component": "Card", "child": "pending_child"}]}}]</a2ui-json>';
    const parts = processor.processChunk(chunk);
    const a2uiParts = parts.filter(p => p.type === 'a2ui');
    const updateComponentsPart = a2uiParts
      .flatMap(p => (Array.isArray(p.a2ui) ? p.a2ui : []))
      .find(m => typeof m === 'object' && m !== null && 'updateComponents' in m) as {
      updateComponents: {components: Array<{component?: string; children?: unknown}>};
    };
    expect(updateComponentsPart).toBeDefined();
    const placeholderComp = updateComponentsPart.updateComponents.components.find(
      c => c.component === 'Row',
    );
    expect(placeholderComp).toBeDefined();
    expect(placeholderComp?.children).toEqual([]);
    expect(placeholderComp?.children).not.toHaveProperty('explicitList');
  });
});

describe('Direct JSON Streaming required fields guard', () => {
  test('withholds partial component when a required property has not arrived', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [
        {
          name: 'AudioPlayer',
          schema: z.object({
            description: z.string().optional(),
            url: z.string(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
      undefined,
      undefined,
      'v0.9',
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      AudioPlayer: {singleRefs: new Set(), listRefs: new Set()},
    };

    // First chunk creates surface
    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1"}},',
    );

    // Second chunk streams AudioPlayer with only optional description, missing required url
    const chunk2 =
      '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "AudioPlayer", "description": "almost ready"';
    const parts = processor.processChunk(chunk2);
    const a2uiParts = parts.filter(p => p.type === 'a2ui');
    const updateParts = a2uiParts
      .flatMap(p => (Array.isArray(p.a2ui) ? p.a2ui : []))
      .filter(m => typeof m === 'object' && m !== null && 'updateComponents' in m);

    // Should NOT have emitted updateComponents yet because required prop "url" is missing
    expect(updateParts).toHaveLength(0);
  });

  test('emits component once all required properties arrive', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [
        {
          name: 'AudioPlayer',
          schema: z.object({
            description: z.string().optional(),
            url: z.string(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
      undefined,
      undefined,
      'v0.9',
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      AudioPlayer: {singleRefs: new Set(), listRefs: new Set()},
    };

    // First chunk creates surface
    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1"}},',
    );

    // Second chunk streams AudioPlayer missing required url
    processor.processChunk(
      '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "AudioPlayer", "description": "almost ready"',
    );

    // Third chunk delivers the required url and closes
    const chunk3 = ', "url": "http://audio.mp3"}]}}]</a2ui-json>';
    const parts = processor.processChunk(chunk3);
    const a2uiParts = parts.filter(p => p.type === 'a2ui');
    const updateParts = a2uiParts
      .flatMap(p => (Array.isArray(p.a2ui) ? p.a2ui : []))
      .filter(m => typeof m === 'object' && m !== null && 'updateComponents' in m) as Array<{
      updateComponents: {components: Array<{id: string; component: string; url?: string}>};
    }>;

    expect(updateParts).toHaveLength(1);
    const emittedComp = updateParts[0].updateComponents.components.find(c => c.id === 'root');
    expect(emittedComp).toBeDefined();
    expect(emittedComp?.component).toBe('AudioPlayer');
    expect(emittedComp?.url).toBe('http://audio.mp3');
  });

  test('direct self-edge raises Self-reference detected', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [
        {
          name: 'Card',
          schema: z.object({
            child: z.string().optional(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
      undefined,
      undefined,
      'v0.9',
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      Card: {singleRefs: new Set(['child']), listRefs: new Set()},
    };

    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"catalogId": "test_catalog", "surfaceId": "s1"}},',
    );

    let caughtError: Error | undefined;
    try {
      processor.processChunk(
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Card", "child": "root"}]}}',
      );
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toContain('Self-reference detected');
    expect(caughtError?.message).toContain("Component 'root' references itself in field 'child'");
  });

  test('two-node cycle raises Circular reference detected without Self-reference', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [
        {
          name: 'Card',
          schema: z.object({
            child: z.string().optional(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
      undefined,
      undefined,
      'v0.9',
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      Card: {singleRefs: new Set(['child']), listRefs: new Set()},
    };

    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"catalogId": "test_catalog", "surfaceId": "s1"}},',
    );

    let caughtError: Error | undefined;
    try {
      processor.processChunk(
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Card", "child": "child"}]}},{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "child", "component": "Card", "child": "root"}]}}',
      );
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toBe('Circular reference detected');
    expect(caughtError?.message).not.toContain('Self-reference detected');
  });

  test('interleaved surfaces update correct surfaceId during streaming', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      [
        {
          name: 'Card',
          schema: z.object({
            child: z.string().optional(),
          }),
        } as unknown as ComponentApi,
        {
          name: 'Text',
          schema: z.object({
            text: z.string().optional(),
          }),
        } as unknown as ComponentApi,
        {
          name: 'Row',
          schema: z.object({
            children: z.array(z.string()).optional(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
      undefined,
      undefined,
      'v0.9',
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      Card: {singleRefs: new Set(['child']), listRefs: new Set()},
      Text: {singleRefs: new Set(), listRefs: new Set()},
      Row: {singleRefs: new Set(), listRefs: new Set(['children'])},
    };

    processor.processChunk('<a2ui-json>[');
    processor.processChunk(
      '{"version": "v0.9", "createSurface": {"surfaceId": "surface1", "catalogId": "test_catalog"}},',
    );
    processor.processChunk(
      '{"version": "v0.9", "createSurface": {"surfaceId": "surface2", "catalogId": "test_catalog"}},',
    );

    const s1Parts = processor.processChunk(
      '{"version": "v0.9", "updateComponents": {"surfaceId": "surface1", "components": [{"id": "root", "component": "Card", "child": "c1"}, ',
    );
    const s1A2ui = s1Parts.filter(p => p.type === 'a2ui').flatMap(p => p.a2ui || []);
    expect(s1A2ui).toHaveLength(1);
    const s1Update = s1A2ui[0] as {updateComponents?: {surfaceId: string}};
    expect(s1Update.updateComponents?.surfaceId).toBe('surface1');

    const s1CompleteParts = processor.processChunk(
      '{"id": "c1", "component": "Text", "text": "hello s1"}]}}, ',
    );
    const s1CompA2ui = s1CompleteParts.filter(p => p.type === 'a2ui').flatMap(p => p.a2ui || []);
    expect(s1CompA2ui).toHaveLength(1);
    const s1CompUpdate = s1CompA2ui[0] as {updateComponents?: {surfaceId: string}};
    expect(s1CompUpdate.updateComponents?.surfaceId).toBe('surface1');

    const s2Parts = processor.processChunk(
      '{"version": "v0.9", "updateComponents": {"surfaceId": "surface2", "components": [{"id": "root", "component": "Card", "child": "c2"}, {"id": "c2", "component": "Text", "text": "hello s2"}]}}',
    );
    const s2A2ui = s2Parts.filter(p => p.type === 'a2ui').flatMap(p => p.a2ui || []);
    expect(s2A2ui).toHaveLength(1);
    const s2Update = s2A2ui[0] as {updateComponents?: {surfaceId: string}};
    expect(s2Update.updateComponents?.surfaceId).toBe('surface2');
  });
});
