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

import {Injectable, inject, Signal as AngularSignal, EnvironmentInjector} from '@angular/core';
import {isAtLeastVersion} from '@a2ui/web_core';
import {
  ComponentContext,
  type ComponentNode,
  ResolvedBinding,
  computed,
  getValue,
  isComponentNode,
  isWritable,
  peekValue,
} from '@a2ui/web_core/v0_9';
import {BoundProperty, ComponentTemplate} from './types';
import {assertAngularSignal, initializeAngularReactivity} from './reactivity';

/** Represents a reference to a child component. */
export interface Child {
  id: string;
  basePath: string;
  /**
   * The resolved node for this child when the parent was bound from a
   * `ComponentNode`. Hosts render it directly instead of searching the tree.
   */
  node?: ComponentNode;
}

/**
 * Binds the resolved properties of a `ComponentNode` to reactive Angular Signals.
 *
 * `NodeResolver` already resolves every property of a node: dynamic values arrive
 * as `ResolvedBinding` instances (writable ones carry their setter), actions as
 * ready-to-call closures, child properties as live `ComponentNode` references, and
 * `checks` as `isValid`, `validationErrors`, and `validationResults`. This service
 * is a thin adapter that exposes each entry of `node.props` as a {@link BoundProperty}
 * for {@link ComponentHostComponent} and {@link AngularWcHost}.
 */
@Injectable({
  providedIn: 'root',
})
export class ComponentBinder {
  private readonly boundCleanups = new WeakMap<Record<string, BoundProperty>, Array<() => void>>();

  constructor() {
    initializeAngularReactivity(inject(EnvironmentInjector));
  }

  /**
   * Binds all properties of a resolved `ComponentNode` to an object of Angular Signals.
   *
   * Reads only from `node.props`; no additional `DataContext` subscriptions are created.
   *
   * @param node The resolved ComponentNode.
   * @returns A map of property names to reactive `BoundProperty` wrappers.
   */
  bindNode(node: ComponentNode): Record<string, BoundProperty> {
    const rawProps = node.context?.componentModel.properties ?? {};
    const bound: Record<string, BoundProperty<unknown>> = {};
    for (const key of Object.keys(peekValue(node.props))) {
      bound[key] = this.bindNodeProperty(node, key, rawProps[key]);
    }
    return bound;
  }

  private bindNodeProperty(
    node: ComponentNode,
    key: string,
    rawVal: unknown,
  ): BoundProperty<unknown> {
    const atLeastV10 = Boolean(node.context?.dataContext.atLeastV10);
    const valueSignal = computed(() =>
      this.unwrapNodePropValue(key, getValue(node.props)[key], node.dataPath, atLeastV10),
    );
    assertAngularSignal(valueSignal);
    return {
      value: valueSignal as AngularSignal<unknown>,
      raw: rawVal,
      template: this.extractNodeTemplate(key, rawVal, atLeastV10),
      onUpdate: (newValue: unknown) => {
        const binding = peekValue(node.props)[key];
        if (binding instanceof ResolvedBinding && isWritable(binding)) {
          binding.set(newValue);
        }
      },
    };
  }

  private extractNodeTemplate(
    key: string,
    rawVal: unknown,
    atLeastV10: boolean,
  ): ComponentTemplate | undefined {
    if (key !== 'children') {
      return undefined;
    }
    return extractChildListTemplate(rawVal, atLeastV10);
  }

  private unwrapNodePropValue(
    key: string,
    val: unknown,
    defaultBasePath: string,
    atLeastV10: boolean,
  ): unknown {
    if (val instanceof ResolvedBinding) {
      return this.unwrapNodePropValue(key, val.value, defaultBasePath, atLeastV10);
    }
    if (isComponentNode(val)) {
      return toChild(val);
    }
    if (Array.isArray(val)) {
      if (key === 'children') {
        return val.map(item =>
          isComponentNode(item)
            ? toChild(item)
            : this.normalizeChildItem(item, defaultBasePath, atLeastV10),
        );
      }
      return val.map(item => this.unwrapNodePropValue(key, item, defaultBasePath, atLeastV10));
    }
    if (['child', 'trigger', 'content'].includes(key)) {
      return this.normalizeChildItem(val, defaultBasePath, atLeastV10);
    }
    if (val && typeof val === 'object' && Object.getPrototypeOf(val) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = this.unwrapNodePropValue(k, v, defaultBasePath, atLeastV10);
      }
      return out;
    }
    return val;
  }

  /**
   * Unsubscribes any reactive signal subscriptions created by {@link bind}.
   *
   * Property maps returned by {@link bindNode} hold no subscriptions of their own, so
   * calling this with one of them is a no-op.
   *
   * @param bound The bound property map returned by {@link bind} or {@link bindNode}.
   */
  unbind(bound: Record<string, BoundProperty> | undefined): void {
    if (!bound) return;
    const cleanups = this.boundCleanups.get(bound);
    if (!cleanups) return;
    this.boundCleanups.delete(bound);
    for (const cleanup of cleanups) {
      cleanup();
    }
  }

  /**
   * Binds all properties of a component to an object of Angular Signals from its
   * `ComponentContext`, resolving data bindings through the `DataContext` directly.
   *
   * @deprecated Use {@link bindNode}. Hosts bind from the resolved `ComponentNode` via
   *   `bindNode(node)`. This path remains for elements that are given a `ComponentContext`
   *   without a node and will be removed in a future release.
   * @param context The ComponentContext containing the model and data context.
   * @returns An object where each key corresponds to a component prop and its value is an Angular Signal.
   */
  bind(context: ComponentContext): Record<string, BoundProperty> {
    const props = context.componentModel.properties;
    const bound: Record<string, BoundProperty<unknown>> = {};
    const cleanups: Array<() => void> = [];
    const checksKey = isAtLeastVersion(
      context.dataContext.surface?.protocolVersion ??
        context.dataContext.surface?.defaultCatalog?.protocolVersion,
      '1.0',
    )
      ? '@checks'
      : 'checks';

    for (const key of Object.keys(props)) {
      const value = props[key];
      bound[key] = this.bindProperty(key, value, context, cleanups);

      // Below v1.0 a component's check rules are `checks`; from v1.0 the
      // processor stores them under `@checks`, while any bare `checks` entry
      // is an ordinary custom component property.
      if (key === checksKey) {
        const checkProps = this.bindChecks(value, context, cleanups);
        bound['isValid'] = checkProps.isValid;
        bound['validationErrors'] = checkProps.validationErrors;
      }
    }

    if (cleanups.length > 0) {
      this.boundCleanups.set(bound, cleanups);
    }
    return bound;
  }

  private bindProperty(
    key: string,
    value: any,
    context: ComponentContext,
    cleanups: Array<() => void>,
  ): BoundProperty<unknown> {
    const atLeastV10 = isAtLeastVersion(
      context.dataContext.surface?.protocolVersion ??
        context.dataContext.surface?.defaultCatalog?.protocolVersion,
      '1.0',
    );
    const templateInfo = extractChildListTemplate(value, atLeastV10);
    const boundPath =
      value && typeof value === 'object' && !Array.isArray(value) && !templateInfo
        ? atLeastV10
          ? typeof value['@path'] === 'string' && !('@child' in value)
            ? (value['@path'] as string)
            : undefined
          : typeof value.path === 'string' && !('componentId' in value)
            ? (value.path as string)
            : undefined
        : undefined;
    const isActionProp =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ((atLeastV10 && ('@action' in value || '@functionCall' in value)) ||
        // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        'event' in value ||
        'functionCall' in value);
    const isChildWrapper =
      atLeastV10 &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '@child' in value &&
      !templateInfo;

    const baseSignal = templateInfo
      ? this.createChildListSignal(templateInfo, context, cleanups)
      : isChildWrapper
        ? computed(() => value['@child'])
        : isActionProp
          ? computed(() => value)
          : context.dataContext.resolveSignal(value);

    const {valueSignal, template} = this.transformStructuralSignal(
      key,
      value,
      templateInfo,
      baseSignal,
      context,
      atLeastV10,
    );

    if (valueSignal?.unsubscribe) {
      cleanups.push(() => valueSignal.unsubscribe!());
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
    template: {id: string; path: string},
    context: ComponentContext,
    cleanups: Array<() => void>,
  ) {
    const atLeastV10 = isAtLeastVersion(
      context.dataContext.surface?.protocolVersion ??
        context.dataContext.surface?.defaultCatalog?.protocolVersion,
      '1.0',
    );
    const listBinding = atLeastV10 ? {'@path': template.path} : {path: template.path};
    const listSig = context.dataContext.resolveSignal(listBinding);
    if (listSig?.unsubscribe) {
      cleanups.push(() => listSig.unsubscribe!());
    }
    assertAngularSignal(listSig);

    const listContext = context.dataContext.nested(template.path);
    return computed(() => {
      const arr = listSig();
      const currentArr = Array.isArray(arr) ? arr : [];
      return currentArr.map((_, i) => ({
        id: template.id,
        basePath: listContext.nested(String(i)).path,
      }));
    });
  }

  private transformStructuralSignal(
    key: string,
    _value: any,
    template: ComponentTemplate | undefined,
    valueSignal: any,
    context: ComponentContext,
    atLeastV10: boolean,
  ): {valueSignal: any; template: ComponentTemplate | undefined} {
    if (['child', 'trigger', 'content'].includes(key)) {
      assertAngularSignal(valueSignal);
      return {
        template: undefined,
        valueSignal: computed(() =>
          this.normalizeChildItem(valueSignal(), context.dataContext.path, atLeastV10),
        ),
      };
    }

    if (key === 'children') {
      assertAngularSignal(valueSignal);
      return {
        template,
        valueSignal: computed(() => {
          const val = valueSignal();
          const arr = Array.isArray(val) ? val : [];
          return arr.map(item =>
            this.normalizeChildItem(item, context.dataContext.path, atLeastV10),
          );
        }),
      };
    }

    return {valueSignal, template: undefined};
  }

  private normalizeChildItem(val: unknown, basePath: string, atLeastV10: boolean): unknown {
    if (!val) return null;
    if (typeof val === 'object') {
      if ('id' in val) {
        return val;
      }
      if (
        atLeastV10 &&
        '@child' in val &&
        typeof (val as Record<string, unknown>)['@child'] === 'string'
      ) {
        return {id: (val as Record<string, unknown>)['@child'], basePath};
      }
    }
    return {id: val, basePath};
  }

  private bindChecks(
    value: unknown,
    context: ComponentContext,
    cleanups: Array<() => void>,
  ): {isValid: BoundProperty<unknown>; validationErrors: BoundProperty<unknown>} {
    const checksArray = Array.isArray(value) ? value : [];

    const ruleResults = checksArray.map(rule => {
      const condition = rule.condition ?? rule;
      const message = rule.message ?? 'Validation failed';
      const conditionSig = context.dataContext.resolveSignal(condition);
      const messageSig = context.dataContext.resolveSignal(message);
      if (conditionSig?.unsubscribe) {
        cleanups.push(() => conditionSig.unsubscribe!());
      }
      if (messageSig?.unsubscribe) {
        cleanups.push(() => messageSig.unsubscribe!());
      }
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

function toChild(node: ComponentNode): Child {
  return {id: node.componentId, basePath: node.dataPath, node};
}

function extractChildListTemplate(
  value: unknown,
  atLeastV10: boolean,
): {id: string; path: string} | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (atLeastV10 && typeof obj['@child'] === 'string' && typeof obj['@path'] === 'string') {
    return obj['@child'] && obj['@path'] ? {id: obj['@child'], path: obj['@path']} : undefined;
  }
  // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
  if (typeof obj['componentId'] === 'string') {
    const path = atLeastV10 && typeof obj['@path'] === 'string' ? obj['@path'] : obj['path'];
    if (typeof path === 'string' && obj['componentId'] && path) {
      return {id: obj['componentId'], path};
    }
  }
  return undefined;
}
