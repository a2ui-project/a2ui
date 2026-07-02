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

// TODO: Modify the a2ui_explorer app so this file is not needed?

/**
 * @externs
 * @fileoverview Google Closure Compiler externs for the A2UI Explorer demo application wrapper types.
 */

/**
 * Externs for `Example` and `Example_08` interfaces (`types.ts`).
 * Required because `examples-bundle.ts` is generated with string literal keys.
 * @record
 * @struct
 */
function ExampleExterns() {}
/** @type {?|undefined} */
ExampleExterns.prototype.messages;
/** @type {?|undefined} */
ExampleExterns.prototype.version;
/** @type {?|undefined} */
ExampleExterns.prototype.description;
/** @type {?|undefined} */
ExampleExterns.prototype.name;

/**
 * Externs for protocol version strings (`types.ts`).
 * @record
 * @struct
 */
function VersionEnumExterns() {}
/** @type {?|undefined} */
VersionEnumExterns.prototype.V0_9;

/**
 * Externs for demo gallery data model property keys in `examples-bundle.ts` (e.g. Weather Current).
 * Required because unminified object literals in bundled examples are accessed by string JSON pointers at runtime.
 * @record
 * @struct
 */
function ExampleDataModelExterns() {}
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.tempHigh;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.tempLow;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.forecast;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.date;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.temp;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.icon;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.restaurants;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.title;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.subtitle;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.address;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.restaurantName;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.inputValue;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.user;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.email;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.password;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.rememberMe;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.submitted;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.responseMessage;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.isValid;
/** @type {?|undefined} */
ExampleDataModelExterns.prototype.validationErrors;
