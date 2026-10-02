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

import {
  DestroyRef,
  Injectable,
  inject,
  Signal as AngularSignal,
  EnvironmentInjector,
} from '@angular/core';
import {ComponentContext, computed} from '@a2ui/web_core/v0_9';
import {BoundProperty, ComponentTemplate} from './types';
import {assertAngularSignal, initializeAngularReactivity} from './reactivity';

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
   * @returns An object where each key corresponds to a component prop and its value is an Angular Signal.
   */
  bind(context: ComponentContext): Record<string, BoundProperty> {
    const props = context.componentModel.properties;
    const bound: Record<string, BoundProperty<unknown>> = {};

    for (const key of Object.keys(props)) {
      const value = props[key];
      bound[key] = this.bindProperty(key, value, context);

      if (key === 'checks') {
        const checkProps = this.bindChecks(value, context);
        bound['isValid'] = checkProps.isValid;
        bound['validationErrors'] = checkProps.validationErrors;
      }
    }

    return bound;
  }

  private bindProperty(key: string, value: any, context: ComponentContext): BoundProperty<unknown> {
    const isChildListTemplate =
      value && typeof value === 'object' && 'componentId' in value && 'path' in value;
    const isBoundPath =
      value && typeof value === 'object' && 'path' in value && !('componentId' in value);

    const baseSignal = isChildListTemplate
      ? this.createChildListSignal(value, context)
      : context.dataContext.resolveSignal(value);

    const {valueSignal, template} = this.transformStructuralSignal(key, value, baseSignal, context);

    if (valueSignal?.unsubscribe) {
      this.destroyRef.onDestroy(() => valueSignal.unsubscribe!());
    }

    return {
      value: valueSignal as AngularSignal<unknown>,
      raw: value,
      template,
      onUpdate: isBoundPath
        ? (newValue: unknown) => context.dataContext.set(value.path, newValue)
        : () => {}, // No-op for non-bound values
    };
  }

  private createChildListSignal(
    value: {componentId: string; path: string},
    context: ComponentContext,
  ) {
    const listSig = context.dataContext.resolveSignal({path: value.path});
    assertAngularSignal(listSig);

    const listContext = context.dataContext.nested(value.path);
    return computed(() => {
      const arr = listSig();
      const currentArr = Array.isArray(arr) ? arr : [];
      return currentArr.map((_, i) => ({
        id: value.componentId,
        basePath: listContext.nested(String(i)).path,
      }));
    });
  }

  private transformStructuralSignal(
    key: string,
    value: any,
    valueSignal: any,
    context: ComponentContext,
  ): {valueSignal: any; template: ComponentTemplate | undefined} {
    if (['child', 'trigger', 'content'].includes(key)) {
      assertAngularSignal(valueSignal);
      return {
        template: undefined,
        valueSignal: computed(() =>
          this.normalizeChildItem(valueSignal(), context.dataContext.path),
        ),
      };
    }

    if (key === 'children') {
      assertAngularSignal(valueSignal);
      const id = value?.componentId;
      const path = value?.path;
      const template = id && path ? {id, path} : undefined;
      return {
        template,
        valueSignal: computed(() => {
          const val = valueSignal();
          const arr = Array.isArray(val) ? val : [];
          return arr.map(item => this.normalizeChildItem(item, context.dataContext.path));
        }),
      };
    }

    return {valueSignal, template: undefined};
  }

  private normalizeChildItem(val: unknown, basePath: string): unknown {
    if (!val) return null;
    if (typeof val === 'object' && 'id' in val) {
      return val;
    }
    return {id: val, basePath};
  }

  private bindChecks(
    value: unknown,
    context: ComponentContext,
  ): {isValid: BoundProperty<unknown>; validationErrors: BoundProperty<unknown>} {
    const checksArray = Array.isArray(value) ? value : [];

    const ruleResults = checksArray.map(rule => {
      const condition = rule.condition ?? rule;
      const message = rule.message ?? 'Validation failed';
      const conditionSig = context.dataContext.resolveSignal(condition);
      const messageSig = context.dataContext.resolveSignal(message);
      return {conditionSig, messageSig};
    });

    const isValidSignal = computed(() =>
      ruleResults.every(r => !this.evaluateCheckRule(r.conditionSig, r.messageSig).isBlockingError),
    );

    const validationErrorsSignal = computed(() => {
      const errors: string[] = [];
      for (const r of ruleResults) {
        const result = this.evaluateCheckRule(r.conditionSig, r.messageSig);
        if (result.isBlockingError) {
          errors.push(result.errorMessage);
        }
      }
      return errors;
    });

    return {
      isValid: {
        value: isValidSignal as AngularSignal<unknown>,
        raw: null,
        onUpdate: () => {},
      },
      validationErrors: {
        value: validationErrorsSignal as AngularSignal<unknown>,
        raw: null,
        onUpdate: () => {},
      },
    };
  }

  private evaluateCheckRule(
    conditionSig: unknown,
    messageSig: unknown,
  ): {isBlockingError: boolean; errorMessage: string} {
    assertAngularSignal(conditionSig);
    assertAngularSignal(messageSig);
    const rawResult = conditionSig();

    if (typeof rawResult === 'object' && rawResult !== null && 'valid' in rawResult) {
      const resObj = rawResult as Record<string, unknown>;
      const isValid = Boolean(resObj['valid']);
      const severity = typeof resObj['severity'] === 'string' ? resObj['severity'] : 'error';
      const dynamicMsg =
        typeof resObj['message'] === 'string' && resObj['message'] ? resObj['message'] : undefined;
      return {
        isBlockingError: !isValid && severity === 'error',
        errorMessage: dynamicMsg || (messageSig() as string) || 'Validation failed',
      };
    }

    const isValid = Boolean(rawResult);
    return {
      isBlockingError: !isValid,
      errorMessage: (messageSig() as string) || 'Validation failed',
    };
  }
}
