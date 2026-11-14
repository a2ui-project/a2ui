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
  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    path.push(error.params.missingProperty);
  }
  return path;
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

/**
 * Creates a {@link JsonSchemaValidator} backed by Ajv (draft 2020-12).
 * `ajv-formats` is enabled unless `opts.formats` is `false`.
 */
export function createAjvValidator(opts: {formats?: boolean} = {}): JsonSchemaValidator {
  return {
    compile<T = unknown>(schema: JsonSchema, compileOpts?: CompileOptions): CompiledValidator<T> {
      const ajv = new Ajv2020({strict: false, allErrors: true});
      if (opts.formats !== false) addFormats(ajv);
      const added = new Set<string>();
      for (const [key, def] of Object.entries(compileOpts?.defs ?? {})) {
        if (added.has(key)) continue;
        added.add(key);
        const resolved = resolveKey(key, schema);
        // Refs inside a def resolve against its own `$id`; align it with the registered key
        // so relative refs (e.g. `common_types.json#/...`) land on registered URIs.
        const toAdd = typeof def === 'object' && resolved !== key ? {...def, $id: resolved} : def;
        ajv.addSchema(toAdd as object | boolean, resolved);
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
