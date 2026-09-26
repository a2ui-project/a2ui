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
import {DirectJsonStreamProcessorImpl} from '../../../../src/inference_formats/direct_json/streaming.js';
import {SchemaCatalog} from '../../../../src/types.js';
import {Catalog, ComponentApi} from '../../../../src/internal/web_core.js';
import {z} from 'zod';

describe('Direct JSON Streaming protocol version and placeholder', () => {
  test('synthesised partial messages carry protocolVersion from catalog instead of hardcoded v1.0', () => {
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      'v0.9',
      [{name: 'Row', schema: {}} as ComponentApi, {name: 'Text', schema: {}} as ComponentApi],
      [],
    );

    // The input omits `version` on purpose: the assertion is that the emitted version comes
    // from the catalog, which it could not prove if the input carried a version to echo.
    // Real envelopes require `version`, so validation is off for this test only.
    const processor = new DirectJsonStreamProcessorImpl(catalog, {disableValidation: true});
    (processor as unknown as {refMap: unknown}).refMap = {
      Row: {singleRefs: new Set(), listRefs: new Set(['children'])},
      Text: {singleRefs: new Set(), listRefs: new Set()},
    };

    // Test synthesized updateComponents partial message
    const compChunk =
      '<a2ui-json>[{"createSurface": {"surfaceId": "s1", "catalogId": "test_catalog"}}, {"updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Text"}]}}]</a2ui-json>';
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
      'v1.0',
      [{name: 'Row', schema: {}} as ComponentApi, {name: 'Card', schema: {}} as ComponentApi],
      [],
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog, {disableValidation: true});
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
      'v0.9',
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
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      AudioPlayer: {singleRefs: new Set(), listRefs: new Set()},
    };

    // First chunk creates surface
    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "test_catalog"}},',
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
      'v0.9',
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
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    (processor as unknown as {refMap: unknown}).refMap = {
      AudioPlayer: {singleRefs: new Set(), listRefs: new Set()},
    };

    // First chunk creates surface
    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "test_catalog"}},',
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
      'v0.9',
      [
        {
          name: 'Card',
          schema: z.object({
            child: z.string().optional(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
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
      'v0.9',
      [
        {
          name: 'Card',
          schema: z.object({
            child: z.string().optional(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
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
      'v0.9',
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

  test('holds back parent with unresolved children when placeholders cannot be used', () => {
    const catalog = new Catalog(
      'test_catalog',
      'v0.9',
      [
        {
          name: 'Text',
          schema: z.object({
            component: z.literal('Text'),
            text: z.string(),
          }),
        } as unknown as ComponentApi,
        {
          name: 'Container',
          schema: z.object({
            component: z.literal('Container'),
            children: z.array(z.string()),
          }),
        } as unknown as ComponentApi,
      ],
      [],
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "test_catalog"}},',
    );

    const step1Parts = processor.processChunk(
      '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "Container", "children": ["c1", "c2"]}',
    );
    const step1Updates = step1Parts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => p.a2ui || [])
      .filter(m => 'updateComponents' in m);
    expect(step1Updates).toHaveLength(0);

    const step2Parts = processor.processChunk(
      ', {"id": "c1", "component": "Text", "text": "Child 1"}]}}',
    );
    const step2Updates = step2Parts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => p.a2ui || [])
      .filter(m => 'updateComponents' in m);
    expect(step2Updates).toHaveLength(0);
  });

  test('holds back partial template child missing path when placeholders cannot be used', () => {
    const catalog = new Catalog(
      'test_catalog',
      'v0.9',
      [
        {
          name: 'Text',
          schema: z.object({
            component: z.literal('Text'),
            text: z.string(),
          }),
        } as unknown as ComponentApi,
        {
          name: 'List',
          schema: z.object({
            component: z.literal('List'),
            children: z.object({
              componentId: z.string(),
              path: z.string(),
            }),
          }),
        } as unknown as ComponentApi,
      ],
      [],
    );
    const processor = new DirectJsonStreamProcessorImpl(catalog);
    processor.processChunk(
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "test_catalog"}},',
    );

    const step1Parts = processor.processChunk(
      '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "List", "children": {"componentId": "c1"',
    );
    const step1Updates = step1Parts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => p.a2ui || [])
      .filter(m => 'updateComponents' in m);
    expect(step1Updates).toHaveLength(0);

    const step2Parts = processor.processChunk(', "path": "/items"');
    const step2Updates = step2Parts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => p.a2ui || [])
      .filter(m => 'updateComponents' in m);
    expect(step2Updates).toHaveLength(0);

    const step3Parts = processor.processChunk(
      '}}, {"id": "c1", "component": "Text", "text": "Child 1"}]}} </a2ui-json>',
    );
    const step3Updates = step3Parts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => p.a2ui || [])
      .filter(m => 'updateComponents' in m);
    expect(step3Updates).toHaveLength(1);
    const firstUpdate = step3Updates[0] as {
      updateComponents: {components: Array<{id: string}>};
    };
    const comps = firstUpdate.updateComponents.components;
    expect(comps.map(c => c.id).sort()).toEqual(['c1', 'root']);
  });

  test('does not classify childLabel as a child reference when component defines formal child refs', () => {
    // Custom component with formal child reference (ChildList) and a property named 'childLabel'
    const catalog: SchemaCatalog = new Catalog(
      'https://test.com/catalog.json',
      'v0.9',
      [
        {
          name: 'ContainerWithLabel',
          schema: z.object({
            children: z
              .array(z.string().describe('REF:#/$defs/ComponentId'))
              .describe('REF:#/$defs/ChildList'),
            childLabel: z.string(),
          }),
        } as unknown as ComponentApi,
        {
          name: 'Text',
          schema: z.object({
            text: z.string(),
          }),
        } as unknown as ComponentApi,
      ],
      [],
    );

    const processor = new DirectJsonStreamProcessorImpl(catalog);
    const refMap = (
      processor as unknown as {
        refMap: Record<string, {singleRefs: Set<string>; listRefs: Set<string>}>;
      }
    ).refMap;

    expect(refMap['ContainerWithLabel']).toBeDefined();
    // Formal list ref 'children' must be present
    expect(refMap['ContainerWithLabel'].listRefs.has('children')).toBe(true);
    // 'childLabel' must NOT be classified as singleRef or listRef
    expect(refMap['ContainerWithLabel'].singleRefs.has('childLabel')).toBe(false);
    expect(refMap['ContainerWithLabel'].listRefs.has('childLabel')).toBe(false);

    // When streamed with childLabel referring to a nonexistent id, ContainerWithLabel should
    // NOT wait for childLabel or generate a placeholder for childLabel
    const chunk =
      '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "test_catalog"}}, {"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "root", "component": "ContainerWithLabel", "children": [], "childLabel": "non_existent_child"}]}}]</a2ui-json>';
    const parts = processor.processChunk(chunk);
    const updates = parts
      .filter(p => p.type === 'a2ui')
      .flatMap(p => p.a2ui || [])
      .filter(m => 'updateComponents' in m) as Array<{
      updateComponents: {components: Array<{id: string; component?: string}>};
    }>;

    expect(updates).toHaveLength(1);
    const yielded = updates[0].updateComponents.components;
    // Only 'root' is yielded; no placeholder for 'non_existent_child' is generated
    expect(yielded.map(c => c.id)).toEqual(['root']);
  });
});
