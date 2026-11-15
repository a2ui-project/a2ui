/*
 * Copyright 2026 Google LLC
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
 * @externs
 * @fileoverview Google Closure Compiler externs for Ajv, the JSON Schema validator
 * (`@a2ui/validator-ajv`) the explorer passes to `provideA2uiValidator`.
 *
 * Ajv compiles each schema to JavaScript source and evaluates it with `new Function`, so the
 * generated code reads and writes properties by their source names, which ADVANCED mode does not
 * see. The properties below are shared between that generated code and Ajv's own (compiled)
 * runtime, or read by `@a2ui/validator-ajv` and `@a2ui/web_core` from the errors the generated
 * code creates. The keys of Ajv's meta-schemas are in `json_documents.externs.js`.
 */

/**
 * Externs for the properties of a compiled validate function that both the generated code and
 * Ajv's runtime use: `errors` (also read by `@a2ui/validator-ajv`) and the `evaluated`
 * properties and items that `unevaluatedProperties` and `unevaluatedItems` track.
 * @record
 * @struct
 */
function AjvValidateFunctionExterns() {}
/** @type {?} */ AjvValidateFunctionExterns.prototype.errors;
/** @type {?} */ AjvValidateFunctionExterns.prototype.evaluated;
/** @type {?} */ AjvValidateFunctionExterns.prototype.props;
/** @type {?} */ AjvValidateFunctionExterns.prototype.dynamicProps;
/** @type {?} */ AjvValidateFunctionExterns.prototype.dynamicItems;

/**
 * Externs for the fields of Ajv's `ErrorObject` and its `params` that the generated code creates
 * and `@a2ui/validator-ajv` and `@a2ui/web_core` read to build and word `A2uiIssue`s. (`type` and
 * `items` are JSON Schema keywords, declared in `json_documents.externs.js`.)
 * @record
 * @struct
 */
function AjvErrorObjectExterns() {}
/** @type {?} */ AjvErrorObjectExterns.prototype.instancePath;
/** @type {?} */ AjvErrorObjectExterns.prototype.keyword;
/** @type {?} */ AjvErrorObjectExterns.prototype.params;
/** @type {?} */ AjvErrorObjectExterns.prototype.message;
/** @type {?} */ AjvErrorObjectExterns.prototype.missingProperty;
/** @type {?} */ AjvErrorObjectExterns.prototype.additionalProperty;
/** @type {?} */ AjvErrorObjectExterns.prototype.unevaluatedProperty;
/** @type {?} */ AjvErrorObjectExterns.prototype.allowedValue;
/** @type {?} */ AjvErrorObjectExterns.prototype.allowedValues;

/**
 * Externs for the JSON types that key Ajv's rule groups (`RULES.types[type]`), which Ajv looks
 * up with the `type` keyword's value.
 * @record
 * @struct
 */
function AjvRuleTypesExterns() {}
/** @type {?} */ AjvRuleTypesExterns.prototype.number;
/** @type {?} */ AjvRuleTypesExterns.prototype.integer;
/** @type {?} */ AjvRuleTypesExterns.prototype.string;
/** @type {?} */ AjvRuleTypesExterns.prototype.array;
/** @type {?} */ AjvRuleTypesExterns.prototype.object;
/** @type {?} */ AjvRuleTypesExterns.prototype.boolean;
/** @type {?} */ AjvRuleTypesExterns.prototype.null;

/**
 * Externs for the members of Ajv's TypeScript enums (`DataType`, `Type`, `UsedValueState`,
 * `DiscrError`, `PropError`). The compiled enums assign their members with bracket strings
 * (`DataType[DataType["Wrong"] = 1] = "Wrong"`) and Ajv reads them with dots (`DataType.Wrong`),
 * so without these ADVANCED mode renames the reads, they are `undefined`, and every `type` check
 * is inverted.
 * @record
 * @struct
 */
function AjvEnumExterns() {}
/** @type {?} */ AjvEnumExterns.prototype.Correct;
/** @type {?} */ AjvEnumExterns.prototype.Wrong;
/** @type {?} */ AjvEnumExterns.prototype.Num;
/** @type {?} */ AjvEnumExterns.prototype.Str;
/** @type {?} */ AjvEnumExterns.prototype.Started;
/** @type {?} */ AjvEnumExterns.prototype.Completed;
/** @type {?} */ AjvEnumExterns.prototype.Mapping;
/** @type {?} */ AjvEnumExterns.prototype.Tag;
/** @type {?} */ AjvEnumExterns.prototype.Additional;
/** @type {?} */ AjvEnumExterns.prototype.Missing;
