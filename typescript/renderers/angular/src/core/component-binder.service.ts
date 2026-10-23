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
import { ComponentContext, computed, signal } from '@a2ui/web_core/v0_9';
import { BoundProperty, ComponentTemplate } from './types';
import { assertAngularSignal, initializeAngularReactivity } from './reactivity';

function isChildListTemplateObject(
  value: unknown,
): value is { componentId: string; path?: string; '@path'?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'componentId' in value &&
    ('path' in value || '@path' in value)
  );
}

function extractBoundPath(value: unknown): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    'componentId' in value
  ) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec['@path'] === 'string') return rec['@path'];
  if (typeof rec['path'] === 'string') return rec['path'];
  return undefined;
}

function isStructuredValidationResult(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && 'valid' in val;
}

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
        bound['validationResults'] = checkProps.validationResults;
      }
    }

    return bound;
  }

  private bindProperty(key: string, value: any, context: ComponentContext): BoundProperty<unknown> {
    const isChildListTemplate = isChildListTemplateObject(value);
    const boundPath = extractBoundPath(value);

    const baseSignal =
      key === 'action'
        ? signal(value)
        : isChildListTemplate
          ? this.createChildListSignal(value, context)
          : context.dataContext.resolveSignal(value);

    const { valueSignal, template } = this.transformStructuralSignal(
      key,
      value,
      baseSignal,
      context,
    );

    if (valueSignal?.unsubscribe) {
      this.destroyRef.onDestroy(() => valueSignal.unsubscribe!());
    }

    return {
      value: valueSignal as AngularSignal<unknown>,
      raw: value,
      template,
      onUpdate:
        boundPath !== undefined
          ? (newValue: unknown) => context.dataContext.set(boundPath, newValue)
          : () => {}, // No-op for non-bound values
    };
  }

  private createChildListSignal(
    value: { componentId: string; path?: string; '@path'?: string },
    context: ComponentContext,
  ) {
    const templatePath = value['@path'] ?? value.path ?? '';
    const listBinding = context.dataContext.atLeastV10
      ? { '@path': templatePath }
      : { path: templatePath };
    const listSig = context.dataContext.resolveSignal(listBinding);
    if (listSig?.unsubscribe) {
      this.destroyRef.onDestroy(() => listSig.unsubscribe!());
    }
    assertAngularSignal(listSig);

    const listContext = context.dataContext.nested(templatePath);
    return computed(() => {
      const arr = listSig();
      const currentArr = Array.isArray(arr) ? arr : [];
      return currentArr.map((_, i) => ({
        id: value.componentId,
        basePath: listContext.nested(String(i), i).path,
      }));
    });
  }

  private transformStructuralSignal(
    key: string,
    value: any,
    valueSignal: any,
    context: ComponentContext,
  ): { valueSignal: any; template: ComponentTemplate | undefined } {
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
      const path = value?.['@path'] ?? value?.path;
      const template = id && path ? { id, path } : undefined;
      return {
        template,
        valueSignal: computed(() => {
          const val = valueSignal();
          const arr = Array.isArray(val) ? val : [];
          return arr.map((item) => this.normalizeChildItem(item, context.dataContext.path));
        }),
      };
    }

    return { valueSignal, template: undefined };
  }

  private normalizeChildItem(val: unknown, basePath: string): unknown {
    if (!val) return null;
    if (typeof val === 'object' && 'id' in val) {
      return val;
    }
    return { id: val, basePath };
  }

  private resolveCheckRuleSignals(
    checksArray: unknown[],
    context: ComponentContext,
  ): Array<{ conditionSig: unknown; messageSig: unknown }> {
    return checksArray.map((rule) => {
      const ruleObj = rule as { condition?: unknown; message?: unknown };
      const condition = ruleObj.condition ?? rule;
      const message = ruleObj.message ?? 'Validation failed';
      const conditionSig = context.dataContext.resolveSignal(condition);
      const messageSig = context.dataContext.resolveSignal(message);
      if (conditionSig?.unsubscribe) {
        this.destroyRef.onDestroy(() => conditionSig.unsubscribe!());
      }
      if (messageSig?.unsubscribe) {
        this.destroyRef.onDestroy(() => messageSig.unsubscribe!());
      }
      return { conditionSig, messageSig };
    });
  }

  private bindChecks(
    value: unknown,
    context: ComponentContext,
  ): {
    isValid: BoundProperty<unknown>;
    validationErrors: BoundProperty<unknown>;
    validationResults: BoundProperty<unknown>;
  } {
    const checksArray = Array.isArray(value) ? value : [];
    const ruleResults = this.resolveCheckRuleSignals(checksArray, context);

    const isValidSignal = computed(() =>
      ruleResults.every(
        (r) => !this.evaluateCheckRule(r.conditionSig, r.messageSig).isBlockingError,
      ),
    );

    const validationErrorsSignal = computed(() =>
      ruleResults
        .map((r) => this.evaluateCheckRule(r.conditionSig, r.messageSig))
        .filter((res) => res.isBlockingError)
        .map((res) => res.errorMessage),
    );

    const validationResultsSignal = computed(() =>
      ruleResults
        .map((r) => this.evaluateCheckRule(r.conditionSig, r.messageSig))
        .filter((res) => !res.isValid)
        .map((res) => ({
          valid: false,
          message: res.errorMessage,
          ...(res.code !== undefined ? { code: res.code } : {}),
          severity: res.severity,
        })),
    );

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
      validationResults: {
        value: validationResultsSignal as AngularSignal<unknown>,
        raw: null,
        onUpdate: () => {},
      },
    };
  }

  private evaluateCheckRule(
    conditionSig: unknown,
    messageSig: unknown,
  ): {
    isValid: boolean;
    isBlockingError: boolean;
    errorMessage: string;
    severity: string;
    code?: string;
  } {
    assertAngularSignal(conditionSig);
    assertAngularSignal(messageSig);
    const rawResult = conditionSig();
    const fallbackMsg = (messageSig() as string) || 'Validation failed';

    if (isStructuredValidationResult(rawResult)) {
      const isValid = Boolean(rawResult['valid']);
      const severity = typeof rawResult['severity'] === 'string' ? rawResult['severity'] : 'error';
      const code = typeof rawResult['code'] === 'string' ? rawResult['code'] : undefined;
      const dynamicMsg =
        typeof rawResult['message'] === 'string' && rawResult['message']
          ? rawResult['message']
          : undefined;
      return {
        isValid,
        isBlockingError: !isValid && severity === 'error',
        errorMessage: dynamicMsg || fallbackMsg,
        severity,
        code,
      };
    }

    const isValid = Boolean(rawResult);
    return {
      isValid,
      isBlockingError: !isValid,
      errorMessage: fallbackMsg,
      severity: 'error',
    };
  }
}
