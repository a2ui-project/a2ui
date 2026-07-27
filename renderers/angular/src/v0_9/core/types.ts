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

import {Signal} from '@angular/core';
import {z} from 'zod';
import {ComponentApi, DataBindingSchema, FunctionCallSchema} from '@a2ui/web_core/v0_9';
import {Child} from './component-binder.service';

/** Data structure that represents a template used to render a collection of children. */
export interface ComponentTemplate {
  id?: string;
  path?: string;
}

/**
 * Represents a component property bound to an Angular Signal and update logic.
 *
 * This interface is used by {@link ComponentBinder} to expose properties to
 * Angular components. It contains the current value as a Signal, the raw
 * property definition, and an update function.
 *
 * @template T The type of the property value.
 */
export interface BoundProperty<T = unknown> {
  /**
   * The reactive Angular Signal containing the current resolved value.
   *
   * This signal automatically updates whenever the underlying A2UI data
   * model changes.
   */
  readonly value: Signal<T>;

  /**
   * The raw value from the A2UI ComponentModel.
   *
   * This may be a literal value or a data binding path object.
   */
  readonly raw: unknown;

  /** This field is present for "children" props that define their children using a template. */
  readonly template?: ComponentTemplate;

  /**
   * Callback to update the value in the A2UI DataContext.
   *
   * If the property is bound to a path in the data model, calling this
   * will update that path. If the property is a literal value, this
   * is typically a no-op.
   */
  readonly onUpdate: (newValue: T) => void;
}

type DataBindingType = z.infer<typeof DataBindingSchema>;
type FunctionCallType = z.infer<typeof FunctionCallSchema>;
type DynamicSchemaValueToRaw<Input> = Exclude<Input, DataBindingType | FunctionCallType>;

type InferredInterfaceToProps<InferredSchema> = {
  [K in keyof InferredSchema]: K extends 'children'
    ? BoundProperty<Child[]>
    : K extends 'child' | 'trigger' | 'content'
      ? BoundProperty<Child>
      : BoundProperty<DynamicSchemaValueToRaw<InferredSchema[K]>>;
};

interface CheckProps {
  isValid: boolean;
  validationErrors: string[];
}

/** The binder can add some properties to the Props object. This util adds them to the type. */
export type ExtendedProps<ComponentProps extends {[key: string]: unknown}> =
  'checks' extends keyof ComponentProps ? ComponentProps & CheckProps : ComponentProps;

/**
 * Utility to convert a component Api Type to the props Type, where the
 * values are wrapped in BoundProperty. This is used to correctly type the props()
 * in a UI component
 *
 * @example
 * export const TextComponentApi = {
 *   name: 'Text',
 *   schema: z.object({
 *     text: z.string(),
 *   })
 *   .strict(),
 * } satisfies ComponentApi;
 * export type TextComponentProps = ComponentApiToProps<typeof TextComponentApi>; // outputs { text: BoundProperty<string>; }
 */
export type ComponentApiToProps<Api extends ComponentApi> = InferredInterfaceToProps<
  ExtendedProps<z.infer<Api['schema']>>
>;
