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

import {ComponentFixture} from '@angular/core/testing';
import {signal} from '@angular/core';
import {BoundProperty, ComponentTemplate} from './types';

/**
 * Extracts the type of the props input from a component type.
 */
export type ComponentToProps<C> = C extends {props: () => infer P} ? P : never;

/**
 * Sets the props input of a component in a type-safe way, for use in tests.
 */
export function setComponentProps<T extends {props: () => any}>(
  fixture: ComponentFixture<T>,
  props: ComponentToProps<T>,
) {
  fixture.componentRef.setInput('props', props);
}

/**
 * Creates a mock BoundProperty for testing.
 */
export function createBoundProperty<T>(val: T, template?: ComponentTemplate) {
  return {
    value: signal(val),
    raw: val,
    template,
    onUpdate: jasmine.createSpy('onUpdate'),
  } satisfies BoundProperty<T>;
}
