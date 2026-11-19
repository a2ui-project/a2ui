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

/**
 * Validates composed message lists against the sample catalog's JSON schema.
 * `@a2ui/embed`'s server validates every tool result again before it reaches
 * the host; this check lets `explain` fall back to the deterministic composer
 * when the model's layout is invalid, and lets tests check every composer.
 */

import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';

/** A problem found in a message list. */
export interface ValidationIssue {
  readonly surfaceId?: string;
  readonly componentId?: string;
  readonly component?: string;
  readonly message: string;
}

/** Result of {@link MessageValidator.validate}. */
export interface ValidationReport {
  readonly ok: boolean;
  readonly errors: readonly ValidationIssue[];
}

/**
 * Checks a message list. {@link MessageValidator} implements it, and so does
 * `app.validate` from `@a2ui/embed/mcp/server`.
 */
export interface LayoutValidator {
  validate(messages: unknown): ValidationReport;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MESSAGE_KINDS = ['createSurface', 'updateComponents', 'updateDataModel'] as const;

/** Returns the component IDs a component refers to as children. */
function childReferences(component: JsonObject): string[] {
  const refs: string[] = [];
  for (const key of ['child', 'trigger', 'content']) {
    const value = component[key];
    if (typeof value === 'string') refs.push(value);
  }
  const children = component['children'];
  if (Array.isArray(children)) {
    refs.push(...children.filter((id): id is string => typeof id === 'string'));
  } else if (isObject(children) && typeof children['componentId'] === 'string') {
    refs.push(children['componentId']);
  }
  const tabs = component['tabs'];
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (isObject(tab) && typeof tab['child'] === 'string') refs.push(tab['child']);
    }
  }
  return refs;
}

/** Validates A2UI v1.0 message lists against one catalog JSON schema. */
export class MessageValidator {
  private readonly ajv = new Ajv2020({strict: false, allErrors: false});
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly catalogId: string;
  private readonly componentNames: ReadonlySet<string>;

  constructor(catalogSchema: JsonObject) {
    this.catalogId = String(catalogSchema['catalogId']);
    const components = isObject(catalogSchema['components']) ? catalogSchema['components'] : {};
    this.componentNames = new Set(Object.keys(components));
    this.ajv.addSchema({...catalogSchema, $id: 'catalog'});
  }

  private validatorFor(name: string): ValidateFunction {
    let validate = this.validators.get(name);
    if (!validate) {
      validate = this.ajv.getSchema(`catalog#/components/${name}`)!;
      this.validators.set(name, validate);
    }
    return validate;
  }

  /**
   * Checks the envelope of every message, that each surface uses this
   * catalog, that every component matches its catalog schema, that IDs are
   * unique, that `root` exists, and that every child reference resolves.
   */
  validate(messages: readonly unknown[]): ValidationReport {
    const errors: ValidationIssue[] = [];
    const componentsBySurface = new Map<string, Map<string, JsonObject>>();
    for (const message of messages) {
      if (!isObject(message) || message['version'] !== '1.0') {
        errors.push({message: 'Each message must be an object with version "1.0".'});
        continue;
      }
      const kinds = MESSAGE_KINDS.filter(kind => kind in message);
      const kind = kinds[0];
      const body = kind ? message[kind] : undefined;
      if (kinds.length !== 1 || Object.keys(message).length !== 2 || !isObject(body)) {
        errors.push({
          message: `Each message must have exactly one of ${MESSAGE_KINDS.join(', ')}.`,
        });
        continue;
      }
      const surfaceId = body['surfaceId'];
      if (typeof surfaceId !== 'string' || surfaceId.length === 0) {
        errors.push({message: `${kind} needs a surfaceId.`});
        continue;
      }
      if (kind === 'createSurface' && body['catalogId'] !== this.catalogId) {
        errors.push({surfaceId, message: `createSurface must use catalogId "${this.catalogId}".`});
      }
      // Without a path (or with '/'), the value replaces the whole data model.
      const wholeModel = body['path'] === undefined || body['path'] === '/';
      if (kind === 'updateDataModel' && wholeModel && 'value' in body && !isObject(body['value'])) {
        errors.push({surfaceId, message: 'updateDataModel.value must be an object.'});
      }
      if (kind === 'updateComponents') {
        const surfaceComponents = componentsBySurface.get(surfaceId) ?? new Map();
        componentsBySurface.set(surfaceId, surfaceComponents);
        const components = body['components'];
        if (!Array.isArray(components) || components.length === 0) {
          errors.push({
            surfaceId,
            message: 'updateComponents.components must be a non-empty array.',
          });
          continue;
        }
        for (const component of components) {
          errors.push(...this.validateComponent(surfaceId, component, surfaceComponents));
        }
      }
    }
    for (const [surfaceId, components] of componentsBySurface) {
      if (!components.has('root')) {
        errors.push({surfaceId, message: 'No component has the id "root".'});
      }
      for (const [componentId, component] of components) {
        for (const ref of childReferences(component)) {
          if (!components.has(ref)) {
            errors.push({
              surfaceId,
              componentId,
              component: String(component['component']),
              message: `Refers to the missing component "${ref}".`,
            });
          }
        }
      }
    }
    return {ok: errors.length === 0, errors};
  }

  private validateComponent(
    surfaceId: string,
    component: unknown,
    seen: Map<string, JsonObject>,
  ): ValidationIssue[] {
    if (!isObject(component) || typeof component['id'] !== 'string') {
      return [{surfaceId, message: 'Each component must be an object with a string id.'}];
    }
    const componentId = component['id'];
    const name = component['component'];
    if (typeof name !== 'string' || !this.componentNames.has(name)) {
      return [{surfaceId, componentId, message: `Unknown component type "${String(name)}".`}];
    }
    const issues: ValidationIssue[] = [];
    if (seen.has(componentId)) {
      issues.push({surfaceId, componentId, component: name, message: 'Duplicate component id.'});
    }
    seen.set(componentId, component);
    const validate = this.validatorFor(name);
    if (!validate(component)) {
      for (const error of validate.errors ?? []) {
        const property = error.instancePath || '/';
        issues.push({
          surfaceId,
          componentId,
          component: name,
          message: `${property} ${error.message ?? 'is invalid'}`,
        });
      }
    }
    return issues;
  }
}
