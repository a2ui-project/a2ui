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
 * @fileoverview Google Closure Compiler externs for A2UI v0.9 web core types and schemas.
 */

/**
 * Externs for `CreateSurfaceMessage` interface (`server-to-client.ts`).
 * @record
 * @struct
 */
function CreateSurfaceMessageExterns() {}
/** @type {?} */ CreateSurfaceMessageExterns.prototype.createSurface;
/** @type {?} */ CreateSurfaceMessageExterns.prototype.surfaceId;

/**
 * Externs for `UpdateComponentsMessage` interface (`server-to-client.ts`).
 * @record
 * @struct
 */
function UpdateComponentsMessageExterns() {}
/** @type {?} */ UpdateComponentsMessageExterns.prototype.updateComponents;
/** @type {?} */ UpdateComponentsMessageExterns.prototype.components;

/**
 * Externs for `AnyComponent` interface and component layout schemas (`common-types.ts`).
 * @record
 * @struct
 */
function AnyComponentExterns() {}
/** @type {?} */ AnyComponentExterns.prototype.component;
/** @type {?} */ AnyComponentExterns.prototype.children;
/** @type {?} */ AnyComponentExterns.prototype.child;
/** @type {?} */ AnyComponentExterns.prototype.props;

/**
 * Externs for `UpdateDataModelMessage` interface (`server-to-client.ts`).
 * @record
 * @struct
 */
function UpdateDataModelMessageExterns() {}
/** @type {?} */ UpdateDataModelMessageExterns.prototype.updateDataModel;
/** @type {?} */ UpdateDataModelMessageExterns.prototype.path;
/** @type {?} */ UpdateDataModelMessageExterns.prototype.value;

/**
 * Externs for `DeleteSurfaceMessage` interface (`server-to-client.ts`).
 * @record
 * @struct
 */
function DeleteSurfaceMessageExterns() {}
/** @type {?} */ DeleteSurfaceMessageExterns.prototype.deleteSurface;

/**
 * Externs for `Action` and `A2uiClientAction` interfaces (`common-types.ts`, `client-to-server.ts`).
 * @record
 * @struct
 */
function ActionExterns() {}
/** @type {?} */ ActionExterns.prototype.action;
/** @type {?} */ ActionExterns.prototype.event;
/** @type {?} */ ActionExterns.prototype.sourceComponentId;

/**
 * Externs for `FunctionCall` interface (`common-types.ts`).
 * @record
 * @struct
 */
function FunctionCallExterns() {}
/** @type {?} */ FunctionCallExterns.prototype.functionCall;
/** @type {?} */ FunctionCallExterns.prototype.args;

/**
 * Externs for `ChildList` interface (`common-types.ts`).
 * @record
 * @struct
 */
function ChildListExterns() {}
/** @type {?} */ ChildListExterns.prototype.componentId;

/**
 * Externs for `Signal` and EventSource reactive interfaces (`signals.ts`, `events.ts`).
 * @record
 * @struct
 */
function SignalExterns() {}
/** @type {?} */ SignalExterns.prototype.peek;
/** @type {?} */ SignalExterns.prototype.subscribe;

/**
 * Externs for `AndApi` and `OrApi` schema arguments (`basic_functions_api.ts`).
 * @record
 * @struct
 */
function AndApiExterns() {}
/** @type {?} */ AndApiExterns.prototype.values;

/**
 * Externs for `FormatDateApi` schema arguments (`basic_functions_api.ts`).
 * @record
 * @struct
 */
function FormatDateApiExterns() {}
/** @type {?} */ FormatDateApiExterns.prototype.format;

/**
 * Externs for `FormatCurrencyApi` schema arguments (`basic_functions_api.ts`).
 * @record
 * @struct
 */
function FormatCurrencyApiExterns() {}
/** @type {?} */ FormatCurrencyApiExterns.prototype.currency;

/**
 * Externs for `PluralizeApi` schema arguments (`basic_functions_api.ts`).
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
