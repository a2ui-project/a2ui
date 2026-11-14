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

import {Ajv2020, type ErrorObject} from 'ajv/dist/2020.js';
import addFormatsModule, {type FormatsPlugin} from 'ajv-formats';
import type {
  A2uiIssue,
  CompileOptions,
  CompiledValidator,
  JsonSchema,
  JsonSchemaValidator,
} from '@a2ui/web_core/schema-engine';

// ajv-formats is CJS; under nodenext the default import is the module namespace.
const addFormats = ((addFormatsModule as unknown as {default?: FormatsPlugin}).default ??
  addFormatsModule) as unknown as FormatsPlugin;

function toPath(instancePath: string, error: ErrorObject): (string | number)[] {
  const path: (string | number)[] = instancePath
    .split('/')
    .slice(1)
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map(s => (/^(0|[1-9]\d*)$/.test(s) ? Number(s) : s));
  // Ajv reports these at the parent object; point at the offending property instead.
  const prop =
    error.keyword === 'required'
      ? error.params?.missingProperty
      : error.keyword === 'additionalProperties'
        ? error.params?.additionalProperty
        : error.keyword === 'unevaluatedProperties'
          ? error.params?.unevaluatedProperty
          : undefined;
  if (typeof prop === 'string') {
    path.push(prop);
  }
  return path;
}

/**
 * The base a root schema without an `$id` is compiled under, so relative def keys
 * (`common_types.json`, `catalog.json`) resolve to sibling URIs, and a def's own
 * relative refs find the defs registered next to it.
 */
const SYNTHETIC_BASE = 'https://a2ui.invalid/schema.json';

/** `schema` with an `$id`: its own, or {@link SYNTHETIC_BASE}. */
function withBaseId(schema: JsonSchema): JsonSchema {
  return typeof schema === 'object' && typeof schema.$id !== 'string'
    ? {...schema, $id: SYNTHETIC_BASE}
    : schema;
}

/**
 * Resolves a relative def key against the root schema's `$id`, so a def without its own
 * `$id` is found by the `$ref` (`catalog.json`) that points at it.
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

/** Creates an Ajv instance with the referenced schemas registered relative to `base`. */
function createAjv(
  formats: boolean,
  defs: Record<string, JsonSchema> | undefined,
  base: JsonSchema,
): Ajv2020 {
  // Without `formats`, `format` is an annotation, as JSON Schema 2020-12's
  // default vocabulary has it: Ajv records it but does not check it.
  const ajv = new Ajv2020({strict: false, allErrors: true, validateFormats: formats});
  if (formats) addFormats(ajv);
  const added = new Set<string>();
  for (const [key, def] of Object.entries(defs ?? {})) {
    if (added.has(key)) continue;
    added.add(key);
    const resolved = resolveKey(key, base);
    // Refs inside a def resolve against its own `$id`; align it with the registered key
    // so relative refs (e.g. `common_types.json#/...`) land on registered URIs.
    const toAdd = typeof def === 'object' && resolved !== key ? {...def, $id: resolved} : def;
    ajv.addSchema(toAdd as object | boolean, resolved);
  }
  return ajv;
}

/**
 * Creates a {@link JsonSchemaValidator} backed by Ajv (draft 2020-12).
 *
 * By default `format` is an annotation and is not asserted, as in JSON Schema
 * 2020-12's default vocabulary and the Python SDK, so a `uri` property
 * accepts a relative URL. Pass `{formats: true}` to assert formats with
 * `ajv-formats`.
 *
 * Roots without an `$id` that are compiled with the same `defs` object share
 * one Ajv instance, so the referenced schemas are added and compiled once
 * (a catalog compiles each of its entries against the same documents). Each
 * such root gets its own synthetic `$id` beside {@link SYNTHETIC_BASE}, so two
 * roots never collide. A `defs` object is treated as unchanging once
 * compiled with. A root with its own `$id` gets an instance of its own.
 */
export function createAjvValidator(opts: {formats?: boolean} = {}): JsonSchemaValidator {
  const formats = opts.formats === true;
  const shared = new WeakMap<object, Ajv2020>();
  let roots = 0;
  return {
    compile<T = unknown>(input: JsonSchema, compileOpts?: CompileOptions): CompiledValidator<T> {
      const defs = compileOpts?.defs;
      let ajv: Ajv2020;
      let schema: JsonSchema;
      if (defs && typeof input === 'object' && typeof input.$id !== 'string') {
        schema = {...input, $id: new URL(`schema-${++roots}.json`, SYNTHETIC_BASE).href};
        let cached = shared.get(defs);
        if (!cached) {
          cached = createAjv(formats, defs, {$id: SYNTHETIC_BASE});
          shared.set(defs, cached);
        }
        ajv = cached;
      } else {
        schema = withBaseId(input);
        ajv = createAjv(formats, defs, schema);
      }
      const validate = ajv.compile(schema);
      return (value: unknown) => {
        if (validate(value)) return {success: true, data: value as T};
        const issues: A2uiIssue[] = (validate.errors ?? []).map(e => ({
          path: toPath(e.instancePath, e),
          message: e.message ?? 'Invalid value',
          keyword: e.keyword,
          params: e.params as Record<string, unknown>,
        }));
        return {success: false, issues};
      };
    },
  };
}
