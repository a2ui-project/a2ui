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

import {Type} from '@angular/core';
import {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import type {AngularComponentImplementation} from './types';
import {AngularWcHost} from './angular_wc_host';

const angularWcCache = new WeakMap<Type<object>, WebComponentImplementation>();
const tagNameCounts = new Map<string, number>();

/**
 * Computes a unique custom element tag name of the form `a2ui-ng-<name>`.
 *
 * Names are disambiguated with an incrementing suffix (`a2ui-ng-<name>-2`, ...) so that two
 * different Angular components sharing a component name get distinct tags.
 */
function computeTagName(name: string): string {
  const baseTagName = `a2ui-ng-${name.toLowerCase()}`;
  const count = (tagNameCounts.get(baseTagName) ?? 0) + 1;
  tagNameCounts.set(baseTagName, count);
  return count === 1 ? baseTagName : `${baseTagName}-${count}`;
}

/**
 * Wraps an Angular `@Component` class declaration (`AngularComponentImplementation`) into a
 * W3C Custom Element (`WebComponentImplementation`).
 *
 * The returned implementation carries a generated `a2ui-ng-<name>` tag and an element class that
 * mounts the Angular component when connected. The element is not defined in the
 * `customElements` registry here; renderers define it on demand with `registerUniversalElement`
 * right before rendering it, like any other `WebComponentImplementation`.
 *
 * Calling this twice with the same component class returns the same implementation.
 *
 * @param componentImpl The AngularComponentImplementation combining the ComponentApi schema and component class.
 * @returns The WebComponentImplementation representation.
 */
export function toWebComponent(
  componentImpl: AngularComponentImplementation,
): WebComponentImplementation {
  const componentClass = componentImpl.component;

  const cached = angularWcCache.get(componentClass);
  if (cached) {
    return cached;
  }

  const tagName = computeTagName(componentImpl.name);
  // `customElements` refuses to define the same class under two tag names, so each Angular
  // component gets its own (otherwise identical) element class.
  const element = class extends AngularWcHost {};

  const implementation: WebComponentImplementation = {
    name: componentImpl.name,
    schema: componentImpl.schema,
    tagName,
    element,
  };

  angularWcCache.set(componentClass, implementation);
  return implementation;
}
