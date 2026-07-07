/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @externs
 * @fileoverview Google Closure Compiler externs for `@a2ui/web_core/v0_9` types and schemas.
 *
 * Note: When Google Closure Compiler runs in ADVANCED optimization mode, declaring a
 * property on any `@externs` prototype preserves that property name globally across all
 * objects in the entire compilation unit. Therefore, each property is only needed once.
 * Some properties (such as `surfaceId` and `path`) belong to multiple schema interfaces
 * across `@a2ui/web_core/v0_9`, but here we only list one definition for each and document
 * their other usage locations in comments.
 */

/**
 * Externs for `CreateSurfaceMessage` interface (`renderers/web_core/src/v0_9/schema/server-to-client.ts`).
 * @record
 * @struct
 */
function CreateSurfaceMessageExterns() {}
/** @type {?} */ CreateSurfaceMessageExterns.prototype.createSurface;
/**
 * Note: Accessed via dot notation (`renderers/web_core/src/v0_9/processing/message-processor.ts`, `renderers/web_core/src/v0_9/state/surface-model.ts`, and component actions).
 * Also corresponds to `DeleteSurfaceMessage.surfaceId` and `Action.surfaceId`.
 * @type {?}
 */
CreateSurfaceMessageExterns.prototype.surfaceId;
/** @type {?} */ CreateSurfaceMessageExterns.prototype.catalogId;
/** @type {?} */ CreateSurfaceMessageExterns.prototype.theme;
/** @type {?} */ CreateSurfaceMessageExterns.prototype.sendDataModel;

/**
 * Externs for `UpdateComponentsMessage` interface (`renderers/web_core/src/v0_9/schema/server-to-client.ts`).
 * @record
 * @struct
 */
function UpdateComponentsMessageExterns() {}
/** @type {?} */ UpdateComponentsMessageExterns.prototype.updateComponents;
/** @type {?} */ UpdateComponentsMessageExterns.prototype.components;

/**
 * Externs for `AnyComponent` interface and component layout schemas (`renderers/web_core/src/v0_9/schema/common-types.ts`).
 * @record
 * @struct
 */
function AnyComponentExterns() {}
/** @type {?} */ AnyComponentExterns.prototype.id;
/** @type {?} */ AnyComponentExterns.prototype.component;
/** @type {?} */ AnyComponentExterns.prototype.children;
/** @type {?} */ AnyComponentExterns.prototype.child;

/**
 * Externs for `UpdateDataModelMessage` interface (`renderers/web_core/src/v0_9/schema/server-to-client.ts`).
 * @record
 * @struct
 */
function UpdateDataModelMessageExterns() {}
/** @type {?} */ UpdateDataModelMessageExterns.prototype.updateDataModel;
/**
 * Note: Accessed via dot notation (`renderers/web_core/src/v0_9/processing/message-processor.ts` and `renderers/web_core/src/v0_9/rendering/generic-binder.ts`).
 * Also corresponds to `ChildList.path`.
 * @type {?}
 */
UpdateDataModelMessageExterns.prototype.path;
/** @type {?} */ UpdateDataModelMessageExterns.prototype.value;

/**
 * Externs for `DeleteSurfaceMessage` interface (`renderers/web_core/src/v0_9/schema/server-to-client.ts`).
 * @record
 * @struct
 */
function DeleteSurfaceMessageExterns() {}
/** @type {?} */ DeleteSurfaceMessageExterns.prototype.deleteSurface;

/**
 * Externs for `Action` and `A2uiClientAction` interfaces (`renderers/web_core/src/v0_9/schema/common-types.ts`, `renderers/web_core/src/v0_9/schema/client-to-server.ts`).
 * @record
 * @struct
 */
function ActionExterns() {}
/** @type {?} */ ActionExterns.prototype.action;
/** @type {?} */ ActionExterns.prototype.event;
/** @type {?} */ ActionExterns.prototype.name;
/** @type {?} */ ActionExterns.prototype.context;
/** @type {?} */ ActionExterns.prototype.sourceComponentId;

/**
 * Externs for `FunctionCall` interface (`renderers/web_core/src/v0_9/schema/common-types.ts`).
 * @record
 * @struct
 */
function FunctionCallExterns() {}
/** @type {?} */ FunctionCallExterns.prototype.functionCall;
/** @type {?} */ FunctionCallExterns.prototype.call;
/** @type {?} */ FunctionCallExterns.prototype.args;
/** @type {?} */ FunctionCallExterns.prototype.returnType;

/**
 * Externs for `ChildList` interface (`renderers/web_core/src/v0_9/schema/common-types.ts`).
 * @record
 * @struct
 */
function ChildListExterns() {}
/**
 * Note: Accessed via dot notation (`renderers/web_core/src/v0_9/rendering/generic-binder.ts`).
 * @type {?}
 */
ChildListExterns.prototype.componentId;

/**
 * Externs for `Signal` and EventSource reactive interfaces (`renderers/web_core/src/v0_9/reactivity/signals.ts`, `renderers/web_core/src/v0_9/common/events.ts`).
 * @record
 * @struct
 */
function SignalExterns() {}
/** @type {?} */ SignalExterns.prototype.peek;
/** @type {?} */ SignalExterns.prototype.subscribe;

/**
 * Externs for `AndApi` and `OrApi` schema arguments (`renderers/web_core/src/v0_9/basic_catalog/functions/basic_functions_api.ts`).
 * @record
 * @struct
 */
function AndApiExterns() {}
/** @type {?} */ AndApiExterns.prototype.values;

/**
 * Externs for `FormatDateApi` schema arguments (`renderers/web_core/src/v0_9/basic_catalog/functions/basic_functions_api.ts`).
 * @record
 * @struct
 */
function FormatDateApiExterns() {}
/** @type {?} */ FormatDateApiExterns.prototype.format;

/**
 * Externs for `FormatCurrencyApi` schema arguments (`renderers/web_core/src/v0_9/basic_catalog/functions/basic_functions_api.ts`).
 * @record
 * @struct
 */
function FormatCurrencyApiExterns() {}
/** @type {?} */ FormatCurrencyApiExterns.prototype.currency;

/**
 * Externs for `PluralizeApi` schema arguments (`renderers/web_core/src/v0_9/basic_catalog/functions/basic_functions_api.ts`).
 * @record
 * @struct
 */
function PluralizeApiExterns() {}
/** @type {?} */ PluralizeApiExterns.prototype.one;
/** @type {?} */ PluralizeApiExterns.prototype.other;

/**
 * Externs for date formatting tokens used by `date-fns`.
 * @record
 * @struct
 */
function DateFormatTokensExterns() {}
/** @type {?} */ DateFormatTokensExterns.prototype.y;
/** @type {?} */ DateFormatTokensExterns.prototype.M;
/** @type {?} */ DateFormatTokensExterns.prototype.d;
/** @type {?} */ DateFormatTokensExterns.prototype.E;
/** @type {?} */ DateFormatTokensExterns.prototype.a;
/** @type {?} */ DateFormatTokensExterns.prototype.h;
/** @type {?} */ DateFormatTokensExterns.prototype.m;

/**
 * Externs for locale and formatting options used by `date-fns` and `Intl`.
 * @record
 * @struct
 */
function LocaleOptionsExterns() {}
/** @type {?} */ LocaleOptionsExterns.prototype.month;
/** @type {?} */ LocaleOptionsExterns.prototype.day;
/** @type {?} */ LocaleOptionsExterns.prototype.dayPeriod;
/** @type {?} */ LocaleOptionsExterns.prototype.locale;
/** @type {?} */ LocaleOptionsExterns.prototype.width;
/** @type {?} */ LocaleOptionsExterns.prototype.abbreviated;
/** @type {?} */ LocaleOptionsExterns.prototype.wide;
