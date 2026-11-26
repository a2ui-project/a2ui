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

/**
 * The component envelope of a macro invocation.
 *
 * An invocation can carry the envelope fields every v1.0 component has: `@catalogId`,
 * `@accessibility`, `@metadata` and `@checks`. They are not arguments of the macro.
 * `@catalogId` selects the macro's catalog; the others are merged onto the root of the
 * lowered tree. For payloads written before the `@` prefix, the bare names are read too,
 * unless the macro declares a parameter of that name, which then is an ordinary argument.
 */

import {
  AT_ENVELOPE_MIXIN_KEYS,
  ENVELOPE_MIXIN_NAMES,
  envelopeReadKey,
} from '../inference-formats/express/schema-helper.js';

type JsonObject = Record<string, unknown>;

/** The arguments of an invocation: its properties other than `component`, `id` and the envelope. */
export function invocationArguments(
  invocation: JsonObject,
  declared: ReadonlySet<string>,
): JsonObject {
  const nested = invocation['parameters'];
  if (!declared.has('parameters') && isJsonObject(nested)) {
    // The arguments are nested under `parameters`; a declared envelope name beside them
    // is an argument too.
    const args = {...nested};
    for (const name of ENVELOPE_MIXIN_NAMES) {
      if (declared.has(name) && invocation[name] != null && !(name in args)) {
        args[name] = invocation[name];
      }
    }
    return args;
  }
  const args: JsonObject = {};
  for (const [key, value] of Object.entries(invocation)) {
    const excluded =
      key === 'component' ||
      key === 'id' ||
      (key === 'parameters' && !declared.has(key)) ||
      isEnvelopeKey(key, declared);
    if (!excluded) {
      args[key] = value;
    }
  }
  return args;
}

/**
 * Merges the invocation's envelope fields onto the root of its lowered components:
 * `@accessibility` and `@metadata` (with its `extensions`) are merged with the root's own,
 * and `@checks` are appended to the root's checks.
 *
 * @param lowered The lowered components; the root is the one with the invocation's ID, or
 *     the last one. It is changed in place.
 */
export function mergeEnvelopeFields(
  invocation: JsonObject,
  declared: ReadonlySet<string>,
  lowered: JsonObject[],
  instanceId: string | undefined,
): void {
  const root = lowered.findLast(component => component['id'] === instanceId) ?? lowered.at(-1);
  if (root === undefined) {
    return;
  }
  const read = (name: string): unknown => {
    const key = envelopeReadKey(invocation, name, true, declared);
    return key === undefined ? undefined : structuredClone(invocation[key]);
  };

  const accessibility = read('accessibility');
  if (accessibility != null) {
    const own = root['@accessibility'];
    root['@accessibility'] =
      isJsonObject(own) && isJsonObject(accessibility) ? {...own, ...accessibility} : accessibility;
  }

  const checks = read('checks');
  if (checks != null) {
    const own = root['@checks'];
    root['@checks'] = Array.isArray(own) && Array.isArray(checks) ? [...own, ...checks] : checks;
  }

  const metadata = read('metadata');
  if (metadata != null) {
    const own = root['@metadata'];
    if (isJsonObject(own) && isJsonObject(metadata)) {
      const merged = {...own, ...metadata};
      if (isJsonObject(own['extensions']) && isJsonObject(metadata['extensions'])) {
        merged['extensions'] = {...own['extensions'], ...metadata['extensions']};
      }
      root['@metadata'] = merged;
    } else {
      root['@metadata'] = metadata;
    }
  }
}

function isEnvelopeKey(key: string, declared: ReadonlySet<string>): boolean {
  if (AT_ENVELOPE_MIXIN_KEYS.has(key)) {
    return true;
  }
  return (ENVELOPE_MIXIN_NAMES as readonly string[]).includes(key) && !declared.has(key);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
