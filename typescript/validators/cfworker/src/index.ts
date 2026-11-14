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

/** Creates a {@link JsonSchemaValidator} backed by `@cfworker/json-schema` (draft 2020-12). */
export function createCfWorkerValidator(): JsonSchemaValidator {
  return {
    compile<T = unknown>(schema: JsonSchema, opts?: CompileOptions): CompiledValidator<T> {
      const validator = new Validator(schema as object, '2020-12', false);
      const added = new Set<string>();
      for (const [key, def] of Object.entries(opts?.defs ?? {})) {
        if (added.has(key)) continue;
        added.add(key);
        validator.addSchema(def as object, resolveKey(key, schema));
      }
      return (value: unknown) => {
        const result = validator.validate(value);
        if (result.valid) return {success: true, data: value as T};
        const issues: A2uiIssue[] = result.errors.map(e => {
          const path = toPath(e.instanceLocation);
          const issue: A2uiIssue = {path, message: e.error, keyword: e.keyword};
          if (e.keyword === 'required') {
            // cfworker reports the parent object; the property is only in the message.
            const m = /required property "(.*)"\.?$/.exec(e.error);
            if (m) {
              path.push(m[1]);
              issue.params = {missingProperty: m[1]};
            }
          }
          return issue;
        });
        return {success: false, issues};
      };
    },
  };
}
