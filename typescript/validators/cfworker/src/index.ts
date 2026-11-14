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

import {Validator} from '@cfworker/json-schema';
import type {
  A2uiIssue,
  CompileOptions,
  CompiledValidator,
  JsonSchema,
  JsonSchemaValidator,
} from '@a2ui/web_core/schema-engine';

function toPath(location: string): (string | number)[] {
  return location
    .replace(/^#\/?/, '')
    .split('/')
    .filter(s => s !== '')
    .map(s => decodeURIComponent(s).replace(/~1/g, '/').replace(/~0/g, '~'))
    .map(s => (/^(0|[1-9]\d*)$/.test(s) ? Number(s) : s));
}

type Json = {[k: string]: unknown};

function pointerTarget(root: Json, ref: string): unknown {
  let cur: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const seg = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof cur !== 'object' || cur === null || !(seg in cur)) return undefined;
    cur = (cur as Json)[seg];
  }
  return cur;
}

/**
 * cfworker only follows local `#/...` refs into `$defs`/`definitions` (and ids). Inline
 * other local pointer refs (e.g. `#/functions/required`) as `allOf` members. A ref that is
 * already being inlined (a cycle) is left untouched.
 */
function inlineLocalPointers(node: unknown, root: Json, stack: string[] = []): unknown {
  if (Array.isArray(node)) return node.map(n => inlineLocalPointers(n, root, stack));
  if (typeof node !== 'object' || node === null) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) out[k] = inlineLocalPointers(v, root, stack);
  const ref = out.$ref;
  if (
    typeof ref === 'string' &&
    ref.startsWith('#/') &&
    !/^#\/(\$defs|definitions)\//.test(ref) &&
    !stack.includes(ref)
  ) {
    const target = pointerTarget(root, ref);
    if (target !== undefined) {
      delete out.$ref;
      const inlined = inlineLocalPointers(target, root, [...stack, ref]);
      out.allOf = [...((out.allOf as unknown[]) ?? []), inlined];
    }
  }
  return out;
}

/**
 * The base a root schema without an `$id` is compiled under, so relative def keys
 * (`common_types.json`, `catalog.json`) resolve to sibling URIs, as with the Ajv adapter.
 */
const SYNTHETIC_BASE = 'https://a2ui.invalid/schema.json';

/** `schema` with an `$id`: its own, or {@link SYNTHETIC_BASE}. */
function withBaseId(schema: JsonSchema): JsonSchema {
  return typeof schema === 'object' && typeof schema.$id !== 'string'
    ? {...schema, $id: SYNTHETIC_BASE}
    : schema;
}

/**
 * cfworker resolves lookup keys against a fixed base URL, so a relative key such as
 * `common_types.json` would not match a `$ref` resolved against the root schema's `$id`.
 * Resolve relative keys against the root `$id` when there is one.
 */
function resolveKey(key: string, root: JsonSchema): string {
  const base = typeof root === 'object' ? root.$id : undefined;
  if (typeof base !== 'string') return key;
  try {
    return new URL(key, base).href;
  } catch {
    return key;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Recovers Ajv-style keyword parameters (`missingProperty`, `type`,
 * `allowedValue`, `allowedValues`, `additionalProperty`, `unevaluatedProperty`)
 * from cfworker's error text, so web_core words issues the same for both
 * engines. Relies on @cfworker/json-schema 4.1.x message text.
 */
function paramsFor(keyword: string, error: string): Record<string, unknown> | undefined {
  let m: RegExpExecArray | null;
  switch (keyword) {
    case 'required':
      m = /required property "(.*)"\.?$/.exec(error);
      return m ? {missingProperty: m[1]} : undefined;
    case 'type':
      m = /Expected (.*)\.$/.exec(error);
      if (!m) return undefined;
      return {type: m[1].split(', ').map(t => t.replace(/^"|"$/g, ''))};
    case 'const': {
      m = /^Instance does not match (.*)\.$/.exec(error);
      const value = m ? parseJson(m[1]) : undefined;
      return value === undefined ? undefined : {allowedValue: value};
    }
    case 'enum': {
      m = /^Instance does not match any of (.*)\.$/.exec(error);
      const values = m ? parseJson(m[1]) : undefined;
      return Array.isArray(values) ? {allowedValues: values} : undefined;
    }
    case 'additionalProperties':
      m = /^Property "(.*)" does not match additional properties schema\.$/.exec(error);
      return m ? {additionalProperty: m[1]} : undefined;
    case 'unevaluatedProperties':
      m = /^Property "(.*)" does not match unevaluated properties schema\.$/.exec(error);
      return m ? {unevaluatedProperty: m[1]} : undefined;
    default:
      return undefined;
  }
}

/** Creates a {@link JsonSchemaValidator} backed by `@cfworker/json-schema` (draft 2020-12). */
export function createCfWorkerValidator(): JsonSchemaValidator {
  return {
    compile<T = unknown>(input: JsonSchema, opts?: CompileOptions): CompiledValidator<T> {
      // cfworker caches each ref's absolute URI on the schema objects it is given, so it
      // gets a copy: the caller's schema, reused under another base, would resolve wrongly.
      const schema = structuredClone(withBaseId(input));
      const validator = new Validator(schema as object, '2020-12', false);
      const added = new Set<string>();
      for (const [key, def] of Object.entries(opts?.defs ?? {})) {
        if (added.has(key)) continue;
        added.add(key);
        if (typeof def !== 'object') continue; // boolean defs cannot be referenced by cfworker
        const resolved = resolveKey(key, schema);
        const copy = inlineLocalPointers({...def, $id: resolved}, def) as object;
        validator.addSchema(copy, resolved);
      }
      return (value: unknown) => {
        const result = validator.validate(value);
        if (result.valid) return {success: true, data: value as T};
        const issues: A2uiIssue[] = result.errors.map(e => {
          const path = toPath(e.instanceLocation);
          const issue: A2uiIssue = {path, message: e.error, keyword: e.keyword};
          const params = paramsFor(e.keyword, e.error);
          if (params) {
            issue.params = params;
            // cfworker reports these at the parent object; point at the property.
            const prop =
              params.missingProperty ?? params.additionalProperty ?? params.unevaluatedProperty;
            if (typeof prop === 'string') path.push(prop);
          }
          return issue;
        });
        return {success: false, issues};
      };
    },
  };
}
