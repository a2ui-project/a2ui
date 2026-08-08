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
/** @type {?} */ Object.prototype.adoptedStyleSheets;
/** @type {?} */ Object.prototype.replaceSync;
/** @type {?} */ Object.prototype._$litStatic$;
/** @type {?} */ Object.prototype.strings;
/** @type {?} */ Object.prototype.values;
/** @type {?} */ Object.prototype.elementProperties;
/** @type {?} */ Object.prototype.finalized;
/** @type {?} */ Object.prototype.styles;
/** @type {?} */ Object.prototype.properties;
/** @type {?} */ Object.prototype.renderOptions;
/** @type {?} */ Object.prototype.attributeToPropertyMap;
/** @type {?} */ Object.prototype.context;
/** @type {?} */ Object.prototype.controller;
/** @type {?} */ Object.prototype.createController;
/** @type {?} */ Object.prototype.r;
/** @type {?} */ Object.prototype.raw;
/** @type {?} */ Object.prototype._processedSheet;
/** @type {?} */ Object.prototype._processedCss;
/** @type {?} */ Object.prototype.value;
/** @type {?} */ Object.prototype.render;
/** @type {?} */ Object.prototype.update;
/** @type {?} */ Object.prototype.willUpdate;
/** @type {?} */ Object.prototype.firstUpdated;
/** @type {?} */ Object.prototype.updated;
/** @type {?} */ Object.prototype.shouldUpdate;
/** @type {?} */ Object.prototype.performUpdate;
/** @type {?} */ Object.prototype.scheduleUpdate;
/** @type {?} */ Object.prototype.createRenderRoot;
/** @type {?} */ Object.prototype.requestUpdate;
/** @type {?} */ Object.prototype.connectedCallback;
/** @type {?} */ Object.prototype.disconnectedCallback;
/** @type {?} */ Object.prototype.adoptedCallback;
/** @type {?} */ Object.prototype.attributeChangedCallback;
/** @type {?} */ Object.prototype.hostConnected;
/** @type {?} */ Object.prototype.hostDisconnected;
/** @type {?} */ Object.prototype.hostUpdate;
/** @type {?} */ Object.prototype.hostUpdated;
/** @type {?} */ Object.prototype.addController;
/** @type {?} */ Object.prototype.removeController;
/** @type {?} */ Object.prototype._def;
/** @type {?} */ Object.prototype.typeName;
/** @type {?} */ Object.prototype.innerType;
/** @type {?} */ Object.prototype.options;
/** @type {?} */ Object.prototype.shape;
/** @type {?} */ Object.prototype.schema;
/** @type {?} */ Object.prototype.element;
/** @type {?} */ Object.prototype.keyType;
/** @type {?} */ Object.prototype.valueType;
/** @type {?} */ Object.prototype.type;
/** @type {?} */ Object.prototype.checks;
/** @type {?} */ Object.prototype.props;
/** @type {?} */ Object.prototype.snapshot;
/** @type {?} */ Object.prototype.binder;
/** @type {?} */ Object.prototype.resolveDynamicValue;
/** @type {?} */ Object.prototype.resolveAction;
/** @type {?} */ Object.prototype.subscribe;
/** @type {?} */ Object.prototype.unsubscribe;
/** @type {?} */ Object.prototype.setValue;
/** @type {?} */ Object.prototype.getValue;
/** @type {?} */ Object.prototype.peek;
/** @type {?} */ Object.prototype.resultType;
/** @type {?} */ Object.prototype.directiveName;
/** @type {?} */ Object.prototype.execute;
/** @type {?} */ Object.prototype.invoker;
/** @type {?} */ Object.prototype.functions;
/** @type {?} */ Object.prototype.components;
/** @type {?} */ Object.prototype.id;
/** @type {?} */ Object.prototype.path;
/** @type {?} */ Object.prototype.componentId;
/** @type {?} */ Object.prototype.event;
/** @type {?} */ Object.prototype.call;
/** @type {?} */ Object.prototype.args;
/** @type {?} */ Object.prototype.returnType;
/** @type {?} */ Object.prototype.name;
/** @type {?} */ Object.prototype.text;
/** @type {?} */ Object.prototype.variant;
/** @type {?} */ Object.prototype.weight;
/** @type {?} */ Object.prototype.align;
/** @type {?} */ Object.prototype.justify;
/** @type {?} */ Object.prototype.child;
/** @type {?} */ Object.prototype.children;
/** @type {?} */ Object.prototype.action;
/** @type {?} */ Object.prototype.label;
/** @type {?} */ Object.prototype.placeholder;
/** @type {?} */ Object.prototype.fit;
/** @type {?} */ Object.prototype.url;
/** @type {?} */ Object.prototype.description;
/** @type {?} */ Object.prototype.axis;
/** @type {?} */ Object.prototype.min;
/** @type {?} */ Object.prototype.max;
/** @type {?} */ Object.prototype.step;
/** @type {?} */ Object.prototype.direction;
/** @type {?} */ Object.prototype.listStyle;
/** @type {?} */ Object.prototype.format;
/** @type {?} */ Object.prototype.currency;
/** @type {?} */ Object.prototype.decimals;
/** @type {?} */ Object.prototype.grouping;
/** @type {?} */ Object.prototype.one;
/** @type {?} */ Object.prototype.other;
/** @type {?} */ Object.prototype.zero;
/** @type {?} */ Object.prototype.two;
/** @type {?} */ Object.prototype.few;
/** @type {?} */ Object.prototype.many;
/** @type {?} */ Object.prototype.tagClassMap;
/** @type {?} */ Object.prototype.condition;
/** @type {?} */ Object.prototype.message;
/** @type {?} */ Object.prototype.surfaceId;
/** @type {?} */ Object.prototype.sourceComponentId;
/** @type {?} */ Object.prototype.timestamp;
/** @type {?} */ Object.prototype.createSurface;
/** @type {?} */ Object.prototype.updateComponents;
/** @type {?} */ Object.prototype.updateDataModel;
/** @type {?} */ Object.prototype.deleteSurface;
/** @type {?} */ Object.prototype.catalogId;
/** @type {?} */ Object.prototype.sendDataModel;
/** @type {?} */ Object.prototype.theme;
/** @type {?} */ Object.prototype.component;
/** @type {?} */ Object.prototype.surfaces;
/** @type {?} */ Object.prototype.code;
/** @type {?} */ Object.prototype.messages;
/** @type {?} */ Object.prototype.version;
/** @type {?} */ Object.prototype.basePath;
/** @type {?} */ Object.prototype.errors;
/** @type {?} */ Object.prototype.error;
/** @type {?} */ Object.prototype.success;
/** @type {?} */ Object.prototype.data;
/** @type {?} */ Object.prototype.log;
/** @type {?} */ Object.prototype.onCreated;
/** @type {?} */ Object.prototype.onDeleted;
/** @type {?} */ Object.prototype.onAction;
/** @type {?} */ Object.prototype.onError;
/** @type {?} */ Object.prototype.dispatch;
/** @type {?} */ Object.prototype.dispatchAction;
/** @type {?} */ Object.prototype.dispatchError;
/** @type {?} */ Object.prototype.catalogs;
/** @type {?} */ Object.prototype.actionHandler;
/** @type {?} */ Object.prototype.width;
/** @type {?} */ Object.prototype.unit;
/** @type {?} */ Object.prototype.values;
/** @type {?} */ Object.prototype.defaultWidth;
/** @type {?} */ Object.prototype.defaultContext;
/** @type {?} */ Object.prototype.formatting;
/** @type {?} */ Object.prototype.standalone;
/** @type {?} */ Object.prototype.abbreviated;
/** @type {?} */ Object.prototype.narrow;
/** @type {?} */ Object.prototype.short;
/** @type {?} */ Object.prototype.wide;
/** @type {?} */ Object.prototype.firstWeekContainsDate;
/** @type {?} */ Object.prototype.weekStartsOn;
/** @type {?} */ Object.prototype.useAdditionalWeekYearTokens;
/** @type {?} */ Object.prototype.useAdditionalDayOfYearTokens;
/** @type {?} */ Object.prototype.locale;
/** @type {?} */ Object.prototype.options;
/** @type {?} */ Object.prototype.match;
/** @type {?} */ Object.prototype.localize;
/** @type {?} */ Object.prototype.formatLong;
/** @type {?} */ Object.prototype.date;
/** @type {?} */ Object.prototype.time;
/** @type {?} */ Object.prototype.dateTime;
/** @type {?} */ Object.prototype.era;
/** @type {?} */ Object.prototype.eras;
/** @type {?} */ Object.prototype.month;
/** @type {?} */ Object.prototype.months;
/** @type {?} */ Object.prototype.quarter;
/** @type {?} */ Object.prototype.quarters;
/** @type {?} */ Object.prototype.day;
/** @type {?} */ Object.prototype.days;
/** @type {?} */ Object.prototype.dayPeriod;
/** @type {?} */ Object.prototype.dayPeriods;
/** @type {?} */ Object.prototype.forecast;
/** @type {?} */ Object.prototype.tempHigh;
/** @type {?} */ Object.prototype.tempLow;
/** @type {?} */ Object.prototype.temp;
/** @type {?} */ Object.prototype.icon;
/** @type {?} */ Object.prototype.restaurants;
/** @type {?} */ Object.prototype.title;
/** @type {?} */ Object.prototype.subtitle;
/** @type {?} */ Object.prototype.address;
/** @type {?} */ Object.prototype.restaurantName;

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
/** @type {?} */ LitElementExterns.prototype.enabledWarnings;
/** @type {?} */ LitElementExterns.prototype.enableWarning;
/** @type {?} */ LitElementExterns.prototype.disableWarning;
