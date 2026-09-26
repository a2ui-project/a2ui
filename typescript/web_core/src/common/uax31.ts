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

import {A2uiCatalogError} from '../errors.js';

/**
 * Identifiers permitted by the v1.0 specification, per UAX #31.
 *
 * The pattern matches `specification/v1_0/json/common_types.json`, which uses
 * `XID_Start` and `XID_Continue` rather than the unprefixed `ID_Start` and
 * `ID_Continue`. The two differ on a handful of code points that are not
 * closed under NFKC, so the distinction is observable; `XID` is normative.
 *
 * Python reaches the same set through `str.isidentifier()`, whose definition is
 * `XID_Start` plus `_` for the first code point and `XID_Continue` thereafter.
 * Note that neither side rejects language keywords: `class` is a valid A2UI
 * identifier in both SDKs.
 */
const UAX31_IDENTIFIER = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u;

/**
 * Checks whether a name is a valid A2UI identifier.
 *
 * A single leading `@` is permitted and ignored, accommodating the reserved
 * system-function prefix such as `@index`. Only one is allowed, so `@@index` is
 * rejected, as is a bare `@`.
 *
 * Mirrors `is_valid_uax31_identifier` in
 * `python/a2ui_core/src/a2ui/core/catalog/catalog.py`.
 *
 * @param name Identifier to test.
 * @returns Whether `name` satisfies UAX #31 after stripping one optional
 *   leading `@`.
 */
export function isValidUax31Identifier(name: string): boolean {
  if (!name) return false;
  const testName = name.startsWith('@') ? name.slice(1) : name;
  return UAX31_IDENTIFIER.test(testName);
}

/**
 * Asserts that an identifier satisfies UAX #31.
 *
 * Throws an {@link A2uiCatalogError} when the identifier is invalid.
 *
 * @param name Identifier to check.
 * @param context Description of what the identifier names, used in the error message.
 * @throws {A2uiCatalogError} If `name` is not a valid UAX #31 identifier.
 */
export function assertUax31Identifier(name: string, context: string): void {
  if (!isValidUax31Identifier(name)) {
    throw new A2uiCatalogError(`Invalid UAX #31 ${context}`);
  }
}
