/*
 * Copyright 2025 Google LLC
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
 * @fileoverview Core rendering and state management logic for A2UI.
 *
 * This module explicitly exports the fundamental building blocks for building A2UI renderers,
 * including the data model, component model, expression parsing logic, and reactivity signals.
 *
 * @module @a2ui/web_core
 */

export {type FunctionInvoker} from './catalog/function_invoker.js';

export {
  type A2uiReturnType,
  type InferA2uiReturnType,
  type FunctionApi,
  type FunctionImplementation,
  createFunctionImplementation,
  type ComponentApi,
  type InferredComponentApiSchemaType,
  type CatalogInterface,
  Catalog,
} from './catalog/types.js';

export {
  EventEmitter,
  type Subscription,
  type EventListener,
  type EventSource,
} from './common/events.js';

import * as EventsCompat from './events-compat.js';
/**
 * @deprecated Legacy Events namespace export. Use named exports from '@a2ui/web_core' instead, or import legacy events from '@a2ui/web_core/v0_8'.
 */
export {EventsCompat as Events};

export {
  type MarkdownRendererTagClassMap,
  type MarkdownRendererOptions,
  type MarkdownRenderer,
} from './common/markdown.js';

export {MessageProcessor} from './processing/message-processor.js';

export {ComponentContext} from './rendering/component-context.js';

export {DataContext} from './rendering/data-context.js';

export {
  GenericBinder,
  type BehaviorNode,
  type ResolveA2uiProp,
  type GenerateSetters,
  type ResolveA2uiProps,
  scrapeSchemaBehavior,
} from './rendering/generic-binder.js';

export {
  // Common types & schemas
  DataBindingSchema,
  type DataBindingType,
  type DataBinding,
  FunctionCallSchema,
  type FunctionCallType,
  type FunctionCall,
  DynamicBooleanSchema,
  type DynamicBoolean,
  DynamicStringSchema,
  type DynamicString,
  DynamicNumberSchema,
  type DynamicNumber,
  DynamicStringListSchema,
  type DynamicStringList,
  DynamicValueSchema,
  type DynamicValue,
  ComponentIdSchema,
  type ComponentId,
  ChildListSchema,
  type ChildList,
  ActionSchema,
  type Action,
  CheckRuleSchema,
  type CheckRule,
  CheckableSchema,
  type Checkable,
  AccessibilityAttributesSchema,
  type AccessibilityAttributes,
  AnyComponentSchema,
  type AnyComponent,
  CommonSchemas,
  // Server to client schemas & types
  CreateSurfaceMessageSchema,
  type CreateSurfaceMessage,
  UpdateComponentsMessageSchema,
  type UpdateComponentsMessage,
  UpdateDataModelMessageSchema,
  type UpdateDataModelMessage,
  DeleteSurfaceMessageSchema,
  type DeleteSurfaceMessage,
  A2uiMessageSchema,
  type A2uiMessage,
  A2uiMessageListSchema,
  type A2uiMessageList,
  A2uiMessageListWrapperSchema,
  type A2uiMessageListWrapper,
  // Client capabilities
  type JsonSchema,
  type FunctionDefinition,
  type InlineCatalog,
  type A2uiVersionCapabilities,
  type A2uiClientCapabilities,
  // Client to server
  A2uiClientActionSchema,
  A2uiValidationErrorSchema,
  A2uiGenericErrorSchema,
  A2uiClientErrorSchema,
  A2uiClientMessageSchema,
  A2uiClientDataModelSchema,
  type A2uiClientAction,
  type A2uiClientError,
  type A2uiClientMessage,
  type A2uiClientDataModel,
  A2uiClientMessageListSchema,
  type A2uiClientMessageList,
  A2uiClientMessageListWrapperSchema,
  type A2uiClientMessageListWrapper,
} from './schema/index.js';

export {ComponentModel} from './state/component-model.js';

export {DataModel, type DataSubscription} from './state/data-model.js';

export {SurfaceComponentsModel} from './state/surface-components-model.js';

export {SurfaceGroupModel} from './state/surface-group-model.js';

export {SurfaceModel, type ActionListener} from './state/surface-model.js';

export {
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
} from './errors.js';

export {
  ExpressionParser,
  BASIC_FUNCTIONS,
  BASIC_COMPONENTS,
  OpenUrlApi,
  injectBasicCatalogStyles,
  computeColorVariant,
  type ColorVariantLightDarkOptions,
  type ColorVariantHoverOptions,
} from './basic_catalog/index.js';

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
import A2UIClientEventMessage from './v0_8/schemas/server_to_client_with_standard_catalog.json' with {type: 'json'};

export const Schemas = {
  A2uiMessageSchemaRaw,
  /**
   * @deprecated Legacy v0.8 schema export. For v0.8 compatibility, import from '@a2ui/web_core/v0_8'.
   */
  A2UIClientEventMessage,
};
