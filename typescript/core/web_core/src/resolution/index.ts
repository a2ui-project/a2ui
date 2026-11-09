/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Headless resolution abstractions, context management, property binders, and view node graph.
 *
 * Provides reactive node resolution, component and data context hierarchies,
 * schema behavior analysis, child reference extraction, dynamic binding wrappers,
 * and markdown rendering type definitions.
 */

export {ComponentContext} from './component-context.js';
export {
  getKnownSchemaKeys,
  validateFunctionArgs,
  isSingleAtKey,
  unescapeObjectKey,
  validateReservedDirectives,
  resolveContextIndex,
  MAX_DYNAMIC_VALUE_DEPTH,
  DataContext,
} from './data-context.js';
export {
  scrapeSchemaBehavior,
  getSafeChildList,
  type BehaviorNode,
  type ResolvedChildRef,
  type ResolveA2uiProp,
  type GenerateSetters,
  type ResolveA2uiProps,
  MAX_DYNAMIC_CHILD_LIST_SIZE,
  GenericBinder,
} from './generic-binder.js';
export {
  /** The component type name used for pending and cyclic placeholder nodes. */
  PLACEHOLDER_TYPE,
  /** Narrows an unknown value to a ComponentNode. */
  isComponentNode,
  /** Resolved component instance in the rendered node tree. */
  type ComponentNode,
  /** Bound action closure produced by the node resolver and binder. */
  type NodeAction,
  /** Resolved component node properties, keyed by property name. */
  type NodeProps,
  /** Resolution state of a component node in the rendered tree. */
  type NodeState,
} from './component-node.js';
export {NodeResolver} from './node-resolver.js';
export {extractRefFields, type RefKind, type RefFields} from './ref-fields.js';
export {isWritable, sameBinding, ResolvedBinding, WritableBinding} from './resolved-binding.js';
export type {
  /** Asynchronous markdown rendering function. */
  MarkdownRenderer,
  /** Configuration options for markdown rendering and styling. */
  MarkdownRendererOptions,
  /** Mapping of HTML tag names to class lists applied during markdown rendering. */
  MarkdownRendererTagClassMap,
} from '../common/markdown.js';
