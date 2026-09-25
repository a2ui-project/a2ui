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
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.inputs;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.outputs;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.selectors;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.exportAs;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.factory;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.dependencies;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.features;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.hostBindings;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.hostVars;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.hostAttrs;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.type;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.vars;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.decls;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.template;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.styles;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.encapsulation;
/** @type {?|undefined} */
AngularIvyInstructionExterns.prototype.changeDetection;

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
/** @type {?|undefined} */
Object.prototype.componentKey;
/** @type {?|undefined} */
Object.prototype.props;
/** @type {?|undefined} */
Object.prototype.surfaceId;
/** @type {?|undefined} */
Object.prototype.componentId;
/** @type {?|undefined} */
Object.prototype.dataContextPath;
/** @type {?|undefined} */
Object.prototype.variant;
/** @type {?|undefined} */
Object.prototype.value;
/** @type {?|undefined} */
Object.prototype.text;
/** @type {?|undefined} */
Object.prototype.label;
/** @type {?|undefined} */
Object.prototype.children;
/** @type {?|undefined} */
Object.prototype.child;
/** @type {?|undefined} */
Object.prototype.align;
/** @type {?|undefined} */
Object.prototype.distribution;
/** @type {?|undefined} */
Object.prototype.weight;
/** @type {?|undefined} */
Object.prototype.url;
/** @type {?|undefined} */
Object.prototype.action;
/** @type {?|undefined} */
Object.prototype.options;
/** @type {?|undefined} */
Object.prototype.fit;
/** @type {?|undefined} */
Object.prototype.altText;
/** @type {?|undefined} */
Object.prototype.description;
/** @type {?|undefined} */
Object.prototype.textFieldType;
/** @type {?|undefined} */
Object.prototype.min;
/** @type {?|undefined} */
Object.prototype.max;
/** @type {?|undefined} */
Object.prototype.tabs;
/** @type {?|undefined} */
Object.prototype.title;
/** @type {?|undefined} */
Object.prototype.listStyle;
/** @type {?|undefined} */
Object.prototype.axis;
/** @type {?|undefined} */
Object.prototype.accessibility;
/** @type {?|undefined} */
Object.prototype.ngIf;
/** @type {?|undefined} */
Object.prototype.ngIfThen;
/** @type {?|undefined} */
Object.prototype.ngIfElse;
/** @type {?|undefined} */
Object.prototype.ngFor;
/** @type {?|undefined} */
Object.prototype.ngForOf;
/** @type {?|undefined} */
Object.prototype.ngForTrackBy;
/** @type {?|undefined} */
Object.prototype.ngForTemplate;
/** @type {?|undefined} */
Object.prototype.ngSwitch;
/** @type {?|undefined} */
Object.prototype.ngSwitchCase;
/** @type {?|undefined} */
Object.prototype.ngSwitchDefault;
/** @type {?|undefined} */
Object.prototype.ngClass;
/** @type {?|undefined} */
Object.prototype.ngStyle;
/** @type {?|undefined} */
Object.prototype.ngComponentOutlet;
/** @type {?|undefined} */
Object.prototype.ngComponentOutletInputs;
/** @type {?|undefined} */
Object.prototype.ngComponentOutletInjector;
/** @type {?|undefined} */
Object.prototype.ngComponentOutletEnvironmentInjector;
/** @type {?|undefined} */
Object.prototype.ngComponentOutletContent;
/** @type {?|undefined} */
Object.prototype.ngComponentOutletNgModule;
/** @type {?|undefined} */
Object.prototype.checks;
/** @type {?|undefined} */
Object.prototype.condition;
/** @type {?|undefined} */
Object.prototype.message;
/** @type {?|undefined} */
Object.prototype.isValid;
/** @type {?|undefined} */
Object.prototype.validationErrors;
/** @type {?|undefined} */
Object.prototype.call;
/** @type {?|undefined} */
Object.prototype.args;
/** @type {?|undefined} */
Object.prototype.path;

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
