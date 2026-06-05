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

import {DestroyRef, Injectable, inject, NgZone} from '@angular/core';
import {ComponentContext, computed} from '@a2ui/web_core/v0_9';
import {toAngularSignal} from './utils';
import {BoundProperty, ComponentTemplate} from './types';

/** Represents a reference to a child component. */
export interface Child {
  id: string;
  basePath: string;
}

/**
 * Binds A2UI ComponentModel properties to reactive Angular Signals.
 *
 * This service is used by {@link ComponentHostComponent} to resolve data bindings
 * from the A2UI DataContext and expose them as Angular Signals. It ensures that
 * property updates from the A2UI protocol are correctly reflected in Angular
 * components and provides callbacks for updating the data model.
 */
@Injectable({
  providedIn: 'root',
})
export class ComponentBinder {
  private destroyRef = inject(DestroyRef);
  private ngZone = inject(NgZone);

  /**
   * Binds all properties of a component to an object of Angular Signals.
   *
   * @param context The ComponentContext containing the model and data context.
   * @returns An object where each key corresponds to a component prop and its value is an Angular Signal.
   */
  bind(context: ComponentContext): Record<string, BoundProperty> {
    const props = context.componentModel.properties;
    const bound: Record<string, BoundProperty<any>> = {};

    for (const key of Object.keys(props)) {
      const value = props[key];
      let template: ComponentTemplate | undefined = undefined;

      let preactSig;
      const isChildListTemplate =
        value && typeof value === 'object' && 'componentId' in value && 'path' in value;
      const isBoundPath =
        value && typeof value === 'object' && 'path' in value && !('componentId' in value);

      if (isChildListTemplate) {
        const listSig = context.dataContext.resolveSignal({path: value.path});
        const listContext = context.dataContext.nested(value.path);
        preactSig = computed(() => {
          const arr = listSig.value;
          const currentArr = Array.isArray(arr) ? arr : [];
          return currentArr.map((_, i) => ({
            id: value.componentId,
            basePath: listContext.nested(String(i)).path,
          }));
        });
      } else {
        preactSig = context.dataContext.resolveSignal(value);
      }

      if (['child', 'trigger', 'content'].includes(key)) {
        const originalSig = preactSig;
        preactSig = computed(() => {
          const val = originalSig.value;
          if (!val) return null;
          if (typeof val === 'object' && val !== null && 'id' in val) {
            return val;
          }
          return {id: val, basePath: context.dataContext.path};
        });
      } else if (key === 'children') {
        const originalSig = preactSig;
        const id = value?.componentId;
        const path = value?.path;
        if (id && path) {
          template = {id, path};
        }
        preactSig = computed(() => {
          const val = originalSig.value;
          const arr = Array.isArray(val) ? val : [];
          return arr.map(item => {
            if (typeof item === 'object' && item !== null && 'id' in item) {
              return item;
            }
            return {id: item, basePath: context.dataContext.path};
          });
        });
      }

      const angSig = toAngularSignal(preactSig as any, this.destroyRef, this.ngZone);

      bound[key] = {
        value: angSig,
        raw: value,
        template,
        onUpdate: isBoundPath
          ? (newValue: any) => context.dataContext.set(value.path, newValue)
          : () => {}, // No-op for non-bound values
      };

      if (key === 'checks') {
        const checksArray = Array.isArray(value) ? value : [];

        const ruleResults = checksArray.map((rule: any) => {
          const condition = rule.condition || rule;
          const message = rule.message || 'Validation failed';
          const conditionSig = context.dataContext.resolveSignal(condition);
          return {conditionSig, message};
        });

        const isValidPreactSig = computed(() => {
          return ruleResults.every((r: any) => !!r.conditionSig.value);
        });

        const validationErrorsPreactSig = computed(() => {
          return ruleResults.filter((r: any) => !r.conditionSig.value).map((r: any) => r.message);
        });

        bound['isValid'] = {
          value: toAngularSignal(isValidPreactSig, this.destroyRef, this.ngZone),
          raw: null,
          onUpdate: () => {},
        };

        bound['validationErrors'] = {
          value: toAngularSignal(validationErrorsPreactSig, this.destroyRef, this.ngZone),
          raw: null,
          onUpdate: () => {},
        };
      }
    }

    return bound;
  }
}
