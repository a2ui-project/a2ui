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

/* eslint-disable no-unused-vars */

/**
 * @externs
 * @fileoverview Google Closure Compiler externs for browser globals and third-party libraries.
 */

let localStorage;
let NOOP_AFTER_RENDER_REF;
let logHmrWarning;
let goog;
let resolveJitResources;
let Hammer;

/** @type {?} */ Object.prototype.litPropertyMetadata;
/** @type {?} */ Object.prototype.kind;
/** @type {?} */ Object.prototype.access;
/** @type {?} */ Object.prototype.addInitializer;

/**
 * Externs for Lit (`@lit/reactive-element`, `lit-element`, `lit-html`).
 * @record
 * @struct
 */
function LitElementExterns() {}
/** @type {?} */ LitElementExterns.prototype.elementProperties;
/** @type {?} */ LitElementExterns.prototype.attributeToPropertyMap;
/** @type {?} */ LitElementExterns.prototype.finalized;
/** @type {?} */ LitElementExterns.prototype.renderOptions;
/** @type {?} */ LitElementExterns.prototype.styles;
/** @type {?} */ LitElementExterns.prototype.properties;

/**
 * Externs for TC39 2023 Decorators context object (`kind`, `name`, `static`, `private`, `access`, `addInitializer`).
 * @record
 * @struct
 */
function DecoratorContextExterns() {}
/** @type {?} */ DecoratorContextExterns.prototype.kind;
/** @type {?} */ DecoratorContextExterns.prototype.name;
/** @type {?} */ DecoratorContextExterns.prototype.static;
/** @type {?} */ DecoratorContextExterns.prototype.private;
/** @type {?} */ DecoratorContextExterns.prototype.access;
/** @type {?} */ DecoratorContextExterns.prototype.addInitializer;
/** @type {?} */ DecoratorContextExterns.prototype.metadata;
