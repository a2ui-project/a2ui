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

import {isValidUax31Identifier} from '../../internal/web-core.js';

/**
 * Words that match the Express `IDENTIFIER` pattern but are lexed as other tokens:
 * the `BOOLEAN` literals, `null`, and the skipped-argument sentinel `_`.
 */
const RESERVED_WORDS = new Set(['true', 'false', 'null', '_']);

const XID_CONTINUE_CHAR = /^\p{XID_Continue}$/u;

/**
 * Returns whether a string can be written as a bare Express identifier, following the
 * `IDENTIFIER` lexer rule in `Express.g4`.
 *
 * @param str The candidate identifier.
 * @returns True if the string lexes as an identifier.
 */
export function isExpressIdentifier(str: string): boolean {
  return isValidUax31Identifier(str) && !RESERVED_WORDS.has(str);
}

/**
 * Derives a valid Express variable name from an arbitrary component ID.
 *
 * Replaces every code point outside `XID_Continue` with `_`, then prefixes `_`
 * until the result is a valid non-reserved Express identifier.
 *
 * @param componentId The component ID to derive a variable name from.
 * @returns A valid Express variable name.
 */
export function deriveVariableName(componentId: string): string {
  let base = Array.from(componentId, ch => (XID_CONTINUE_CHAR.test(ch) ? ch : '_')).join('');
  while (!isExpressIdentifier(base)) {
    base = `_${base}`;
  }
  return base;
}

/**
 * Maps each component ID in a block to the variable name it is written under.
 *
 * An ID that is a valid Express identifier is its own variable name. Any other ID,
 * such as a pre-v1.0 `content-grid` or a reserved word like `true`, gets a derived
 * name (`content_grid`, `_true`) that no other ID or variable of the block uses,
 * and the component is written with an `id="..."` argument so that it compiles back
 * to its ID.
 *
 * @param componentIds The component IDs in the block, in component order.
 * @returns Map from component ID to assigned variable name.
 */
export function assignVariableNames(componentIds: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const cid of componentIds) {
    if (isExpressIdentifier(cid)) {
      names.set(cid, cid);
      taken.add(cid);
    }
  }
  for (const cid of componentIds) {
    if (names.has(cid)) {
      continue;
    }
    const base = deriveVariableName(cid);
    let name = base;
    let suffix = 2;
    while (taken.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    names.set(cid, name);
    taken.add(name);
  }
  return names;
}
