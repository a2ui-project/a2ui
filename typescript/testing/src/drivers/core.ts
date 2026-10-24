/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ComponentContext, GenericBinder, type SurfaceModel} from '@a2ui/web_core/v0_9';

import type {ComponentRef, SurfaceDriver} from '../types.js';

/**
 * Resolves a component instance the way a renderer would: a `ComponentContext`
 * scoped to the instance, and a `GenericBinder` built from the component's
 * catalog schema.
 */
export function bindComponent(
  surface: SurfaceModel<any>,
  ref: ComponentRef,
): {context: ComponentContext; binder: GenericBinder<Record<string, unknown>>} {
  const component = surface.componentsModel.get(ref.id);
  if (!component) {
    throw new Error(`Component '${ref.id}' is not on surface '${surface.id}'.`);
  }
  const api = component.catalog.components.get(component.type);
  if (!api) {
    throw new Error(
      `Component '${ref.id}' has type '${component.type}', which catalog '${component.catalog.id}' does not declare.`,
    );
  }
  const context = new ComponentContext(surface, ref.id, ref.scope ?? '/');
  const binder = new GenericBinder<Record<string, unknown>>(context, api.schema);
  return {context, binder};
}

/** Yields to the macrotask queue so pending promises and subscriptions run. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Driver that runs the harness contract on `web_core` state alone.
 *
 * No renderer is involved. `mount` binds the root component and keeps it
 * bound, as a renderer does when it puts the surface on screen, so bindings
 * on the root (for example a startup trigger) resolve the way they would when
 * rendered; descendants resolve when a test reads them. `click` runs the
 * component's `action` closure, the same closure a renderer hands to its
 * button, and `setValue` calls the setter the binder generates for a bound
 * `value` property, the same setter a text field calls on input. Both paths
 * end in `SurfaceModel`, so recorded actions, function calls, and data model
 * writes match a rendered surface.
 */
export function createCoreDriver(): SurfaceDriver {
  const subscriptions: Array<{unsubscribe(): void}> = [];

  return {
    name: 'core',

    mount(surface) {
      const bindRoot = (id: string) => {
        if (id !== surface.rootId) return;
        try {
          subscriptions.push(bindComponent(surface, {id}).binder.subscribe(() => {}));
        } catch {
          // An unknown component type is already reported by the processor.
        }
      };
      if (surface.componentsModel.get(surface.rootId)) bindRoot(surface.rootId);
      subscriptions.push(surface.componentsModel.onCreated.subscribe(c => bindRoot(c.id)));
    },

    props(surface, ref) {
      return bindComponent(surface, ref).binder.snapshot;
    },

    async click(surface, ref) {
      const {binder} = bindComponent(surface, ref);
      const action = binder.snapshot['action'];
      if (typeof action !== 'function') {
        throw new Error(`Component '${ref.id}' declares no action, so it cannot be clicked.`);
      }
      await (action as () => Promise<void>)();
      await flush();
    },

    async setValue(surface, ref, value) {
      const component = surface.componentsModel.get(ref.id);
      const raw = component?.properties['value'];
      const bindingKey = raw && typeof raw === 'object' && '@path' in raw ? '@path' : 'path';
      if (!raw || typeof raw !== 'object' || typeof raw[bindingKey] !== 'string') {
        throw new Error(
          `Component '${ref.id}' does not bind 'value' to a data model path, so user input would be lost. Bind it with {"path": "/..."} to make it editable.`,
        );
      }
      const {binder} = bindComponent(surface, ref);
      const setter = binder.snapshot['setValue'];
      if (typeof setter !== 'function') {
        throw new Error(`Component '${ref.id}' of type '${component!.type}' accepts no value.`);
      }
      (setter as (value: unknown) => void)(value);
      await flush();
    },

    async settle() {
      await flush();
    },

    dispose() {
      while (subscriptions.length > 0) subscriptions.pop()?.unsubscribe();
    },
  };
}
