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

import { DestroyRef, Injectable, inject, NgZone } from '@angular/core';
import {
  ComponentContext,
  computed,
  scrapeSchemaBehavior,
  BehaviorNode,
  Signal,
  signal,
  getValue,
} from '@a2ui/web_core/v0_9';
import { z } from 'zod';
import { toAngularSignal } from './utils';
import { BoundProperty, ComponentTemplate } from './types';

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
   * @param schema The Zod schema of the component.
   * @returns An object where each key corresponds to a component prop and its value is an Angular Signal.
   */
  bind(context: ComponentContext, schema?: z.ZodTypeAny): Record<string, BoundProperty> {
    const props = context.componentModel.properties;
    const bound: Record<string, BoundProperty<any>> = {};
    const behaviorTree = scrapeSchemaBehavior(schema || z.object({}));

    for (const key of Object.keys(props)) {
      const value = props[key];
      let template: ComponentTemplate | undefined = undefined;
      const behavior: BehaviorNode = (behaviorTree.type === 'OBJECT'
        ? behaviorTree.shape[key]
        : null) || { type: 'STATIC' };

      const resolvedPreactSig = this.resolveNested(value, behavior, context);
      const angSig = toAngularSignal(resolvedPreactSig as any, this.destroyRef, this.ngZone);

      if (
        behavior.type === 'STRUCTURAL' &&
        value &&
        typeof value === 'object' &&
        'componentId' in value
      ) {
        template = { id: value.componentId, path: value.path };
      }

      const isBoundPath =
        value && typeof value === 'object' && 'path' in value && !('componentId' in value);

      bound[key] = {
        value: angSig,
        raw: value,
        template,
        onUpdate: isBoundPath
          ? (newValue: any) => context.dataContext.set(value.path, newValue)
          : () => {},
      };

      if (behavior.type === 'CHECKABLE') {
        const checksArray = Array.isArray(value) ? value : [];

        const ruleResults = checksArray.map((rule: any) => {
          const condition = rule.condition || rule;
          const message = rule.message || 'Validation failed';
          const conditionSig = context.dataContext.resolveSignal(condition);
          return { conditionSig, message };
        });

        const isValidPreactSig = computed(() => {
          return ruleResults.every((r: any) => !!getValue(r.conditionSig));
        });

        const validationErrorsPreactSig = computed(() => {
          return ruleResults
            .filter((r: any) => !getValue(r.conditionSig))
            .map((r: any) => r.message);
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

  private resolveNested(
    value: any,
    behavior: BehaviorNode,
    context: ComponentContext,
  ): Signal<any> {
    if (value === undefined || value === null) {
      if (behavior.type === 'STRUCTURAL') {
        return signal([]);
      }
      return signal(value);
    }

    switch (behavior.type) {
      case 'CHILD': {
        const rawSig = context.dataContext.resolveSignal(value);
        return computed(() => {
          const val = getValue(rawSig);
          if (!val) return null;
          if (typeof val === 'object' && val !== null && 'id' in val) {
            return val;
          }
          return { id: val, basePath: context.dataContext.path };
        });
      }
      case 'STRUCTURAL': {
        if (value && typeof value === 'object' && 'componentId' in value && 'path' in value) {
          const listSig = context.dataContext.resolveSignal({ path: value.path });
          const listContext = context.dataContext.nested(value.path);
          return computed(() => {
            const arr = getValue(listSig);
            const currentArr = Array.isArray(arr) ? arr : [];
            return currentArr.map((_, i) => ({
              id: value.componentId,
              basePath: listContext.nested(String(i)).path,
            }));
          });
        } else {
          const listSig = context.dataContext.resolveSignal(value);
          return computed(() => {
            const val = getValue(listSig);
            const arr = Array.isArray(val) ? val : [];
            return arr.map((item) => {
              if (typeof item === 'object' && item !== null && 'id' in item) {
                return item;
              }
              return { id: item, basePath: context.dataContext.path };
            });
          });
        }
      }
      case 'DYNAMIC': {
        return context.dataContext.resolveSignal(value);
      }
      case 'ARRAY': {
        if (!Array.isArray(value)) return signal(value);
        const itemSignals = value.map((item) =>
          this.resolveNested(item, behavior.element, context),
        );
        return computed(() => itemSignals.map((sig) => getValue(sig)));
      }
      case 'OBJECT': {
        if (typeof value !== 'object' || Array.isArray(value)) return signal(value);
        const resolvedProps: Record<string, Signal<any>> = {};
        for (const [k, v] of Object.entries(value)) {
          const childBehavior = behavior.shape[k] || { type: 'STATIC' };
          resolvedProps[k] = this.resolveNested(v, childBehavior, context);
        }
        return computed(() => {
          const result: any = {};
          for (const [k, sig] of Object.entries(resolvedProps)) {
            result[k] = getValue(sig);
          }
          return result;
        });
      }
      case 'STATIC':
      default:
        return signal(value);
    }
  }
}
