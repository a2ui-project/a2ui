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

import {
  DestroyRef,
  Injectable,
  inject,
  Signal as AngularSignal,
  EnvironmentInjector,
} from '@angular/core';
import {
  ComponentContext,
  computed,
  scrapeSchemaBehavior,
  BehaviorNode,
  Signal,
  signal,
  getValue,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {BoundProperty, ComponentTemplate} from './types';
import {initializeAngularReactivity} from './reactivity';

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

  constructor() {
    initializeAngularReactivity(inject(EnvironmentInjector));
  }

  /**
   * Binds all properties of a component to an object of Angular Signals.
   *
   * @param context The ComponentContext containing the model and data context.
   * @param schema The Zod schema of the component.
   * @returns An object where each key corresponds to a component prop and its value is an Angular Signal.
   */
  bind(context: ComponentContext, schema?: z.ZodTypeAny): Record<string, BoundProperty> {
    const props = context.componentModel.properties;
    const bound: Record<string, BoundProperty<unknown>> = {};
    const behaviorTree = scrapeSchemaBehavior(schema || z.object({}));

    for (const key of Object.keys(props)) {
      const value = props[key];
      let template: ComponentTemplate | undefined = undefined;
      const behavior: BehaviorNode = (behaviorTree.type === 'OBJECT'
        ? behaviorTree.shape[key]
        : null) || {type: 'STATIC'};

      const resolvedSig = this.resolveNested(value, behavior, context);

      if (
        behavior.type === 'STRUCTURAL' &&
        value &&
        typeof value === 'object' &&
        'componentId' in value
      ) {
        template = {id: value.componentId, path: value.path};
      }

      const isBoundPath =
        value && typeof value === 'object' && 'path' in value && !('componentId' in value);

      if ((resolvedSig as any).unsubscribe) {
        this.destroyRef.onDestroy(() => (resolvedSig as any).unsubscribe());
      }

      bound[key] = {
        value: resolvedSig as AngularSignal<unknown>,
        raw: value,
        template,
        onUpdate: isBoundPath
          ? (newValue: unknown) => context.dataContext.set(value.path, newValue)
          : () => {},
      };

      if (behavior.type === 'CHECKABLE') {
        const checksArray = Array.isArray(value) ? value : [];

        const ruleResults = checksArray.map(rule => {
          const condition = rule.condition || rule;
          const message = rule.message || 'Validation failed';
          const conditionSig = context.dataContext.resolveSignal(condition);
          return {conditionSig, message};
        });

        const isValidSignal = computed(() => {
          return ruleResults.every(r => !!getValue(r.conditionSig));
        });

        const validationErrorsSignal = computed(() => {
          return ruleResults
            .filter(r => !getValue(r.conditionSig))
            .map(r => r.message);
        });

        bound['isValid'] = {
          value: isValidSignal as AngularSignal<boolean>,
          raw: null,
          onUpdate: () => {},
        };

        bound['validationErrors'] = {
          value: validationErrorsSignal as AngularSignal<unknown>,
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
          return {id: val, basePath: context.dataContext.path};
        });
      }
      case 'STRUCTURAL': {
        if (value && typeof value === 'object' && 'componentId' in value && 'path' in value) {
          const listSig = context.dataContext.resolveSignal({path: value.path});
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
            return arr.map(item => {
              if (typeof item === 'object' && item !== null && 'id' in item) {
                return item;
              }
              return {id: item, basePath: context.dataContext.path};
            });
          });
        }
      }
      case 'DYNAMIC': {
        return context.dataContext.resolveSignal(value);
      }
      case 'ARRAY': {
        if (!Array.isArray(value)) return signal(value);
        const itemSignals = value.map(item => this.resolveNested(item, behavior.element, context));
        return computed(() => itemSignals.map(sig => getValue(sig)));
      }
      case 'OBJECT': {
        if (typeof value !== 'object' || Array.isArray(value)) return signal(value);
        const resolvedProps: Record<string, Signal<any>> = {};
        for (const [k, v] of Object.entries(value)) {
          const childBehavior = behavior.shape[k] || {type: 'STATIC'};
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
