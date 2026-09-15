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
 * Types for `jmespath`, the reference JMESPath implementation.
 *
 * The package ships no types, and `@types/jmespath` is missing entries A2UI
 * needs, so the surface used here is declared directly.
 *
 * This is the reference implementation. It accepts the original grammar and
 * nothing else, which is why A2UI evaluates with it: the evaluator and the
 * portability guarantee are the same thing.
 */
declare module 'jmespath' {
  /** A node of the parsed expression. */
  export interface JmespathNode {
    readonly type?: string;
    readonly name?: string;
    readonly value?: unknown;
    readonly children?: readonly JmespathNode[];
  }

  /**
   * Parses an expression and returns its syntax tree.
   *
   * @throws If the expression is not valid JMESPath. Function names are not
   *     resolved here, so an unknown function parses cleanly and only fails
   *     when evaluated.
   */
  export function compile(expression: string): JmespathNode;

  /** Evaluates an expression against a document. */
  export function search(document: unknown, expression: string): unknown;
}
