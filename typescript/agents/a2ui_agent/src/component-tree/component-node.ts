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
 * A component written as a nested object, in the shape of the wire component.
 *
 * Any property may hold another node, directly, in an array, or inside a plain object
 * such as `{path, componentId}`. `flattenComponentTree` replaces each nested node with
 * its ID. Every object with a string `component` property counts as a node.
 */
export interface ComponentNode {
  component: string;
  /** Leave it out to have an ID allocated. */
  id?: string;
  [property: string]: unknown;
}

/** A component in a slot: a nested node, or the ID of a component already on the surface. */
export type ComponentChild = ComponentNode | string;

/** A component of the flat list `flattenComponentTree` returns. */
export type FlatComponent = ComponentNode & {id: string};

/** Whether `value` is a component node rather than a literal value. */
export function isComponentNode(value: unknown): value is ComponentNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)['component'] === 'string'
  );
}
