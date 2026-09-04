/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Core rendering and state management logic for A2UI v0.9.
 *
 * This module exports the fundamental building blocks for building web-based A2UI renderers,
 * including the data model, component model, and expression parsing logic.
 */

export * from './catalog/function_invoker.js';
export * from './catalog/types.js';
export * from './catalog/a2ui-controller.js';
export * from './catalog/a2ui-lit-element.js';
export * from './catalog/render-a2ui-node.js';
export * from './common/events.js';
export * from './processing/message-processor.js';
export * from './rendering/component-context.js';
export * from './rendering/data-context.js';
export * from './rendering/generic-binder.js';
// MutableComponentNode is deliberately not re-exported.
export {
  isComponentNode,
  PLACEHOLDER_TYPE,
  type ComponentNode,
  type NodeProps,
  type NodeState,
} from './nodes/component-node.js';
export * from './nodes/node-resolver.js';
export * from './nodes/ref-fields.js';
export * from './nodes/resolved-binding.js';
export * from './schema/index.js';
export * from './state/component-model.js';
export * from './state/data-model.js';
export * from './state/surface-components-model.js';
export * from './state/surface-group-model.js';
export * from './state/surface-model.js';
export * from './errors.js';
export * from './basic_catalog/expressions/expression_parser.js';
export * from './basic_catalog/functions/basic_functions.js';
export * from './basic_catalog/functions/basic_functions_api.js';
export * from './basic_catalog/components/basic_components.js';
export {Context} from './basic_catalog/context/context.js';
export type {
  MarkdownRenderer,
  MarkdownRendererOptions,
  MarkdownRendererTagClassMap,
} from './basic_catalog/context/markdown.js';
export {markdown} from './basic_catalog/directives/directives.js';

export {
  type Signal,
  effect,
  signal,
  computed,
  getValue,
  peekValue,
  batchWrite,
  isSignal,
  setValue,
  setSignalImplementation,
  _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION,
  type SignalImplementations,
} from './reactivity/signals.js';

import A2uiMessageSchemaRaw from './schemas/server_to_client.json' with {type: 'json'};

export const Schemas = {
  A2uiMessageSchemaRaw,
};
