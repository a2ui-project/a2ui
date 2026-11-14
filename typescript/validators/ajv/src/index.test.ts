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

import assert from 'node:assert';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {A2uiIssue, JsonSchema} from '@a2ui/web_core/schema-engine';
import {createAjvValidator} from './index.js';

const repo = (f: string) => fileURLToPath(new URL(`../../../../${f}`, import.meta.url));
const spec = (f: string) => repo(`specification/v1_0/${f}`);
const readJson = (f: string) => JSON.parse(readFileSync(spec(f), 'utf8'));

const schema: JsonSchema = readJson('json/agent_to_renderer.json');
const common: JsonSchema = readJson('json/common_types.json');
// Minimal stand-in for the catalog the message schema references as `catalog.json`.
const catalog: JsonSchema = {
  $defs: {
    anyComponent: {
      type: 'object',
      required: ['component'],
      properties: {component: {type: 'string'}},
      additionalProperties: true,
    },
    anyFunction: {type: 'object', required: ['call']},
  },
};
const messages: unknown[] = readFileSync(spec('test/cases/contact_form_example.jsonl'), 'utf8')
  .split('\n')
  .filter(l => l.trim())
  .map(l => JSON.parse(l));

describe('createAjvValidator', () => {
  const compile = () =>
    createAjvValidator().compile(schema, {
      defs: {'common_types.json': common, 'catalog.json': catalog},
    });

  it('accepts valid messages', () => {
    const validate = compile();
    assert.ok(messages.length > 0);
    for (const m of messages) {
      const r = validate(m);
      assert.ok(r.success, JSON.stringify(r).slice(0, 500));
    }
  });

  it('rejects a wrong type with a path', () => {
    const r = compile()({version: 'v1.0', updateComponents: {surfaceId: 1}});
    assert.ok(!r.success);
    assert.ok(
      r.issues.some(
        (i: A2uiIssue) =>
          i.path[0] === 'updateComponents' && i.path[1] === 'surfaceId' && i.keyword,
      ),
      JSON.stringify(r.issues),
    );
  });

  it('reports missing required property in path', () => {
    const r = createAjvValidator().compile({
      type: 'object',
      properties: {a: {type: 'array', items: {type: 'object', required: ['missingName']}}},
    })({a: [{}]});
    assert.ok(!r.success);
    const i = r.issues.find((x: A2uiIssue) => x.keyword === 'required');
    assert.ok(i, JSON.stringify(r.issues));
    assert.deepStrictEqual(i.path, ['a', 0, 'missingName']);
  });

  it('reports an additional or unevaluated property in path', () => {
    const r = createAjvValidator().compile({
      type: 'object',
      properties: {
        a: {type: 'object', additionalProperties: false},
        b: {type: 'object', unevaluatedProperties: false},
      },
    })({a: {extra: 1}, b: {other: 2}});
    assert.ok(!r.success);
    const paths = r.issues.map((x: A2uiIssue) => x.path);
    assert.deepStrictEqual(paths, [
      ['a', 'extra'],
      ['b', 'other'],
    ]);
  });

  describe('real basic catalog', () => {
    const real: JsonSchema = JSON.parse(
      readFileSync(repo('catalogs/basic/v1/catalog.json'), 'utf8'),
    );
    const compileReal = () =>
      createAjvValidator().compile(schema, {
        defs: {'common_types.json': common, 'catalog.json': real},
      });

    it('accepts real messages', () => {
      const validate = compileReal();
      for (const m of messages) {
        const r = validate(m);
        assert.ok(r.success, JSON.stringify(r).slice(0, 500));
      }
    });

    it('rejects an invalid component prop with a field path', () => {
      const bad = structuredClone(messages[1]) as {
        updateComponents: {components: Record<string, unknown>[]};
      };
      const text = bad.updateComponents.components.find(c => c.component === 'Text')!;
      text.text = 42;
      const r = compileReal()(bad);
      assert.ok(!r.success);
      assert.ok(
        r.issues.some(
          (i: A2uiIssue) => i.path[0] === 'updateComponents' && i.path.includes('text'),
        ),
        JSON.stringify(r.issues).slice(0, 800),
      );
    });
  });
});

describe('createAjvValidator with a root schema without $id', () => {
  // A component schema as `fromJsonSchema` gets it: relative refs into the common
  // types, whose own refs (`catalog.json`) must find the def registered beside them.
  const component = () => ({
    type: 'object',
    properties: {label: {$ref: 'common_types.json#/$defs/DynamicString'}},
  });
  const defs = {'common_types.json': common, 'catalog.json': catalog};

  it('resolves relative def keys next to each other', () => {
    const validate = createAjvValidator().compile(component(), {defs});
    assert.ok(validate({label: 'hi'}).success);
    assert.ok(validate({label: {'@path': '/x'}}).success);
    const r = validate({label: {path: '/x'}});
    assert.strictEqual(r.success, false);
  });

  it('compiles the same schema objects with and without an $id', () => {
    const shared = component();
    const without = createAjvValidator().compile(shared, {defs});
    const withId = createAjvValidator().compile(
      {...shared, $id: 'https://example.com/c.json'},
      {defs},
    );
    for (const validate of [without, withId, createAjvValidator().compile(shared, {defs})]) {
      assert.ok(validate({label: {'@path': '/x'}}).success);
      assert.strictEqual(validate({label: 1}).success, false);
    }
    assert.ok(!('$id' in shared), 'the caller schema is not changed');
  });
});
