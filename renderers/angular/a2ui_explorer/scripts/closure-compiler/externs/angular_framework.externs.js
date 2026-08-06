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
 * @fileoverview Google Closure Compiler externs for `@angular/core` Ivy instructions
 * and lifecycle hooks, and `@angular/common` locale data indices.
 *
 * Prevents Closure Compiler's ADVANCED optimizations from renaming or pruning
 * Angular Ivy static fields and runtime reflection metadata.
 */

/**
 * Externs for Angular Ivy compiler static instruction definitions (`ɵcmp`, `ɵfac`, etc.).
 * @record
 * @struct
 */
function AngularIvyInstructionExterns() {}
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵcmp;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵfac;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵdir;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵpipe;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵmod;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵinj;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.ɵprov;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.__NG_ELEMENT_ID__;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.__NG_ENV_ID__;

/**
 * Externs for Angular lifecycle hook interfaces (`OnInit`, `OnDestroy`, etc.).
 * @record
 * @struct
 */
function AngularLifecycleHookExterns() {}
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngOnChanges;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngOnInit;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngDoCheck;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngAfterContentInit;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngAfterContentChecked;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngAfterViewInit;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngAfterViewChecked;
/** @type {?|undefined} */
AngularLifecycleHookExterns.prototype.ngOnDestroy;

/**
 * Externs for Angular `@Input` metadata flags and property aliases.
 * @record
 * @struct
 */
function AngularInputFlagsExterns() {}
/** @type {?|undefined} */
AngularInputFlagsExterns.prototype.None;
/** @type {?|undefined} */
AngularInputFlagsExterns.prototype.SignalBased;
/** @type {?|undefined} */
AngularInputFlagsExterns.prototype.HasDecoratorInputTransform;

/**
 * Externs for Angular signal primitive internals.
 * @record
 * @struct
 */
function AngularSignalPrimitiveExterns() {}
/** @type {?|undefined} */
AngularSignalPrimitiveExterns.prototype.SIGNAL;
/** @type {?|undefined} */
AngularSignalPrimitiveExterns.prototype.ɵSIGNAL;

/**
 * Externs for `@angular/common` `LocaleDataIndex` enum properties and locale array symbols.
 * Prevents ADVANCED mode from mangling locale array indices used by DatePipe.
 * @record
 * @struct
 */
function AngularLocaleDataIndexExterns() {}
/** @type {?|undefined} */
AngularLocaleDataIndexExterns.prototype.DateTimeFormat;
/** @type {?|undefined} */
AngularLocaleDataIndexExterns.prototype.NumberSymbols;
