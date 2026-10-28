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
import {
  ComponentContext,
  type ComponentNode,
  ResolvedBinding,
  computed,
  getValue,
  isComponentNode,
  isWritable,
  peekValue,
  signal,
} from '@a2ui/web_core/v0_9';
import {BoundProperty, ComponentTemplate} from './types';
import {assertAngularSignal, initializeAngularReactivity} from './reactivity';

function isChildListTemplateObject(
  value: unknown,
): value is {componentId: string; path?: string; '@path'?: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'componentId') &&
    (Object.hasOwn(value, 'path') || Object.hasOwn(value, '@path'))
  );
}

function extractBoundPath(value: unknown): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.hasOwn(value, 'componentId')
  ) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec['@path'] === 'string') return rec['@path'];
  if (typeof rec['path'] === 'string') return rec['path'];
  return undefined;
}

function isStructuredValidationResult(val: unknown): val is Record<string, unknown> {
  return (
    typeof val === 'object' && val !== null && !Array.isArray(val) && Object.hasOwn(val, 'valid')
  );
}

/** Represents a reference to a child component. */
export interface Child {
  id: string;
  basePath: string;
}

/**
 * Binds A2UI ComponentNode or ComponentModel properties to reactive Angular Signals.
 *
 * This service is used by {@link ComponentHostComponent} and {@link AngularWcHost}
 * to expose resolved `ComponentNode.props` (or `ComponentContext` properties) as
 * Angular Signals with two-way data model update callbacks.
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
   * Binds all properties of a resolved `ComponentNode` to an object of Angular Signals.
   *
   * Reads directly from `node.props` (produced by `NodeResolver`) without
   * duplicating `DataContext` subscriptions when the node's schema resolves them.
   *
   * @param node The resolved ComponentNode.
   * @returns A map of property names to reactive `BoundProperty` wrappers.
   */
  bindNode(node: ComponentNode): Record<string, BoundProperty> {
    const rawProps = node.context?.componentModel.properties ?? {};
    const initialNodeProps = peekValue(node.props);
    const bound: Record<string, BoundProperty<unknown>> = {};
    const allKeys = new Set([...Object.keys(rawProps), ...Object.keys(initialNodeProps)]);

    for (const key of allKeys) {
      bound[key] = this.bindNodeProperty(node, key, rawProps[key]);
    }

    if ('checks' in rawProps && !('isValid' in initialNodeProps) && node.context) {
      const checkProps = this.bindChecks(rawProps['checks'], node.context);
      bound['isValid'] = checkProps.isValid;
      bound['validationErrors'] = checkProps.validationErrors;
      bound['validationResults'] = checkProps.validationResults;
    }

    return bound;
  }

  private bindNodeProperty(
    node: ComponentNode,
    key: string,
    rawVal: unknown,
  ): BoundProperty<unknown> {
    if (key === 'action') {
      return {
        value: signal(rawVal) as AngularSignal<unknown>,
        raw: rawVal,
        template: undefined,
        onUpdate: () => {},
      };
    }

    const isCheckSynthetic =
      key === 'isValid' || key === 'validationErrors' || key === 'validationResults';
    const directBound =
      !isCheckSynthetic && rawVal !== undefined && node.context
        ? this.bindProperty(key, rawVal, node.context)
        : undefined;

    const valueSignal = computed(() => {
      const currentProps = getValue(node.props);
      const nodeVal = key in currentProps ? currentProps[key] : rawVal;
      if (
        isComponentNode(nodeVal) ||
        (Array.isArray(nodeVal) && nodeVal.some(isComponentNode)) ||
        !directBound
      ) {
        return this.unwrapNodePropValue(key, nodeVal, node.dataPath);
      }
      return directBound.value();
    });
    assertAngularSignal(valueSignal);

    const template = directBound?.template ?? this.extractNodeTemplate(key, rawVal);
    return {
      value: valueSignal as AngularSignal<unknown>,
      raw: isCheckSynthetic ? null : rawVal,
      template,
      onUpdate: (newValue: unknown) => this.updateNodeProp(node, key, rawVal, newValue),
    };
  }

  private extractNodeTemplate(key: string, rawVal: unknown): ComponentTemplate | undefined {
    if (key !== 'children' || !isChildListTemplateObject(rawVal)) {
      return undefined;
    }
    const path = rawVal['@path'] ?? rawVal.path;
    return rawVal.componentId && path ? {id: rawVal.componentId, path} : undefined;
  }

  private updateNodeProp(
    node: ComponentNode,
    key: string,
    rawVal: unknown,
    newValue: unknown,
  ): void {
    const current = peekValue(node.props)[key];
    if (current instanceof ResolvedBinding && isWritable(current)) {
      current.set(newValue);
      return;
    }
    const boundPath = extractBoundPath(rawVal);
    if (boundPath !== undefined && node.context) {
      node.context.dataContext.set(boundPath, newValue);
    }
  }

  private unwrapNodePropValue(key: string, val: unknown, defaultBasePath: string): unknown {
    if (val instanceof ResolvedBinding) {
      return this.unwrapNodePropValue(key, val.value, defaultBasePath);
    }
    if (isComponentNode(val)) {
      return {id: val.componentId, basePath: val.dataPath};
    }
    if (Array.isArray(val)) {
      if (key === 'children' || val.some(isComponentNode)) {
        return val.map(item =>
          isComponentNode(item)
            ? {id: item.componentId, basePath: item.dataPath}
            : this.normalizeChildItem(item, defaultBasePath),
        );
      }
      return val.map(item => this.unwrapNodePropValue(key, item, defaultBasePath));
    }
    if (['child', 'trigger', 'content'].includes(key)) {
      return this.normalizeChildItem(val, defaultBasePath);
    }
    if (val && typeof val === 'object' && Object.getPrototypeOf(val) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = this.unwrapNodePropValue(k, v, defaultBasePath);
      }
      return out;
    }
    return val;
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

    const {valueSignal, template} = this.transformStructuralSignal(key, value, baseSignal, context);

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
    value: {componentId: string; path?: string; '@path'?: string},
    context: ComponentContext,
  ) {
    const templatePath = value['@path'] ?? value.path ?? '';
    const listBinding = context.dataContext.atLeastV10
      ? {'@path': templatePath}
      : {path: templatePath};
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
      const path = value?.['@path'] ?? value?.path;
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

  private resolveCheckRuleSignals(
    checksArray: unknown[],
    context: ComponentContext,
  ): Array<{conditionSig: unknown; messageSig: unknown}> {
    return checksArray.map(rule => {
      const ruleObj = rule as {condition?: unknown; message?: unknown};
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
      return {conditionSig, messageSig};
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
      ruleResults.every(r => !this.evaluateCheckRule(r.conditionSig, r.messageSig).isBlockingError),
    );

    const validationErrorsSignal = computed(() =>
      ruleResults
        .map(r => this.evaluateCheckRule(r.conditionSig, r.messageSig))
        .filter(res => res.isBlockingError)
        .map(res => res.errorMessage),
    );

    const validationResultsSignal = computed(() =>
      ruleResults
        .map(r => this.evaluateCheckRule(r.conditionSig, r.messageSig))
        .filter(res => !res.isValid)
        .map(res => ({
          valid: false,
          message: res.errorMessage,
          ...(res.code !== undefined ? {code: res.code} : {}),
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
