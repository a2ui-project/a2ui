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

export { type FunctionInvoker } from './catalog/function_invoker.js';
export { createFunctionImplementation, type A2uiReturnType, type InferA2uiReturnType, type FunctionApi, type FunctionImplementation, type ComponentApi, type WebComponentImplementation, type InferredComponentApiSchemaType, type CatalogInterface, Catalog } from './catalog/types.js';
export { A2uiController } from './catalog/a2ui-controller.js';
export { type A2uiChildRef, type ResolvedChildList, A2uiLitElement } from './catalog/a2ui-lit-element.js';
export { renderA2uiNode } from './catalog/render-a2ui-node.js';
export { type Subscription, type EventListener, type EventSource, EventEmitter } from './common/events.js';
export { formatZodIssue, type CapabilitiesOptions, type MessageProcessorOptions, MessageProcessor } from './processing/message-processor.js';
export { ComponentContext } from './rendering/component-context.js';
export { DataContext } from './rendering/data-context.js';
export { scrapeSchemaBehavior, type BehaviorNode, type ResolvedChildRef, type ResolveA2uiProp, type GenerateSetters, type ResolveA2uiProps, GenericBinder } from './rendering/generic-binder.js';
// MutableComponentNode is deliberately not re-exported.
export {
  isComponentNode,
  PLACEHOLDER_TYPE,
  type ComponentNode,
  type NodeProps,
  type NodeState,
} from './nodes/component-node.js';
export { NodeResolver } from './nodes/node-resolver.js';
export { extractRefFields, type RefKind, type RefFields } from './nodes/ref-fields.js';
export { isWritable, sameBinding, ResolvedBinding, WritableBinding } from './nodes/resolved-binding.js';
export { childRefKindOf, componentId, childList, DataBindingSchema, type DataBindingType, FunctionCallSchema, type FunctionCallType, DynamicBooleanSchema, DynamicStringSchema, DynamicNumberSchema, DynamicStringListSchema, DynamicValueSchema, type DataBinding, type FunctionCall, type DynamicString, type DynamicNumber, type DynamicBoolean, type DynamicStringList, type DynamicValue, ComponentIdSchema, type ComponentId, type ChildRefKind, type RefSchemaOptions, ChildListSchema, type ChildList, ActionSchema, type Action, CheckRuleSchema, type CheckRule, CheckableSchema, type Checkable, AccessibilityAttributesSchema, type AccessibilityAttributes, AnyComponentSchema, type AnyComponent, CommonSchemas, CreateSurfaceMessageSchema, UpdateComponentsMessageSchema, UpdateDataModelMessageSchema, DeleteSurfaceMessageSchema, type CreateSurfaceMessage, type UpdateComponentsMessage, type UpdateDataModelMessage, type DeleteSurfaceMessage, A2uiMessageSchema, type A2uiMessage, A2uiMessageListSchema, type A2uiMessageList, A2uiMessageListWrapperSchema, type A2uiMessageListWrapper, type JsonSchema, type FunctionDefinition, type InlineCatalog, type A2uiVersionCapabilities, type A2uiClientCapabilities, A2uiClientActionSchema, A2uiValidationErrorSchema, A2uiGenericErrorSchema, A2uiClientErrorSchema, A2uiClientMessageSchema, A2uiClientDataModelSchema, type A2uiClientAction, type A2uiClientError, type A2uiClientMessage, type A2uiClientDataModel, A2uiClientMessageListSchema, type A2uiClientMessageList, A2uiClientMessageListWrapperSchema, type A2uiClientMessageListWrapper } from './schema/index.js';
export { ComponentModel } from './state/component-model.js';
export { type DataSubscription, DataModel } from './state/data-model.js';
export { SurfaceComponentsModel } from './state/surface-components-model.js';
export { SurfaceGroupModel } from './state/surface-group-model.js';
export { type ActionListener, SurfaceModel } from './state/surface-model.js';
export { A2uiError, A2uiValidationError, A2uiDataError, A2uiExpressionError, A2uiStateError } from './errors.js';
export { ExpressionParser } from './basic_catalog/expressions/expression_parser.js';
export { createFormatNumberImplementation, createFormatCurrencyImplementation, createPluralizeImplementation, createBasicCatalogFunctions, AddImplementation, SubtractImplementation, MultiplyImplementation, DivideImplementation, EqualsImplementation, NotEqualsImplementation, GreaterThanImplementation, LessThanImplementation, AndImplementation, OrImplementation, NotImplementation, ContainsImplementation, StartsWithImplementation, EndsWithImplementation, RequiredImplementation, RegexImplementation, LengthImplementation, NumericImplementation, EmailImplementation, FormatStringImplementation, FormatNumberImplementation, FormatCurrencyImplementation, FormatDateImplementation, PluralizeImplementation, OpenUrlImplementation, BASIC_FUNCTIONS } from './basic_catalog/functions/basic_functions.js';
export { AddApi, SubtractApi, MultiplyApi, DivideApi, EqualsApi, NotEqualsApi, GreaterThanApi, LessThanApi, AndApi, OrApi, NotApi, ContainsApi, StartsWithApi, EndsWithApi, RequiredApi, RegexApi, LengthApi, NumericApi, EmailApi, FormatStringApi, FormatNumberApi, FormatCurrencyApi, FormatDateApi, PluralizeApi, OpenUrlApi, BASIC_FUNCTION_APIS } from './basic_catalog/functions/basic_functions_api.js';
export { TextApi, ImageApi, IconApi, VideoApi, AudioPlayerApi, RowApi, ColumnApi, ListApi, CardApi, TabsApi, ModalApi, DividerApi, ButtonApi, TextFieldApi, CheckBoxApi, ChoicePickerApi, SliderApi, DateTimeInputApi, BASIC_COMPONENTS } from './basic_catalog/components/basic_components.js';
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
