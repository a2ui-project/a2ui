/*
 * Copyright 2026 Google LLC
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
 * Words that match the Express `IDENTIFIER` pattern but are lexed as other tokens:
 * the `BOOLEAN` literals, `null`, and the skipped-argument sentinel `_`.
 */
const RESERVED_WORDS = new Set(['true', 'false', 'null', '_']);

/**
 * Returns whether a string can be written as a bare Express identifier, following the
 * `IDENTIFIER` lexer rule in `Express.g4`.
 *
 * @param str The candidate identifier.
 * @returns True if the string lexes as an identifier.
 */
export function isExpressIdentifier(str: string): boolean {
  return !RESERVED_WORDS.has(str) && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str);
}
