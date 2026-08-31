/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {zodToJsonSchema} from 'zod-to-json-schema';
import {ComponentApi, FunctionApi, CatalogInterface} from './types.js';

/**
 * Cleans auto-generated Zod schema artifacts and transforms REF markers into explicit `$ref` objects.
 *
 * Removes schema metadata and converts `REF:<url>|<desc>` description markers into `$ref` references.
 *
 * @param node The schema object or array node to sanitize in place.
 * @param visited Set of visited objects to prevent infinite recursion on cyclic structures.
 */
export function cleanSchemaNode(node: unknown, visited = new Set<unknown>()): void {
  if (typeof node !== 'object' || node === null) return;
  if (visited.has(node)) return;
  visited.add(node);
  const obj = node as Record<string, unknown>;

  // If the node itself is a REF target (marked via description), transform it.
  if (typeof obj.description === 'string' && obj.description.startsWith('REF:')) {
    const content = obj.description.substring(4);
    const pipeIndex = content.indexOf('|');
    const ref = pipeIndex === -1 ? content : content.substring(0, pipeIndex);
    const desc = pipeIndex === -1 ? '' : content.substring(pipeIndex + 1);

    for (const key of Object.keys(obj)) {
      delete obj[key];
    }
    obj['$ref'] = ref;
    if (desc) {
      obj['description'] = desc;
    }
    return;
  }

  if ('$schema' in obj) {
    delete obj['$schema'];
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      cleanSchemaNode(item, visited);
    }
  } else {
    for (const key of Object.keys(obj)) {
      cleanSchemaNode(obj[key], visited);
    }
  }
}

/**
 * Configuration options for catalog JSON schema generation.
 */
export interface GenerateCatalogSchemaOptions {
  /** Optional reference URI to a base component schema envelope (e.g. `common_types.json#/$defs/ComponentCommon`). */
  componentEnvelopeRef?: string;
}

function processTheme(catalog: CatalogInterface<any, any>, defs: Record<string, unknown>): void {
  if (!catalog.themeSchema) return;

  const themeRaw = zodToJsonSchema(catalog.themeSchema, {
    target: 'jsonSchema2019-09',
  }) as Record<string, unknown>;
  cleanSchemaNode(themeRaw);

  if (themeRaw.definitions && typeof themeRaw.definitions === 'object') {
    Object.assign(defs, themeRaw.definitions);
    delete themeRaw.definitions;
  } else if (themeRaw.$defs && typeof themeRaw.$defs === 'object') {
    Object.assign(defs, themeRaw.$defs);
    delete themeRaw.$defs;
  }

  const themeObj: Record<string, unknown> = {
    type: 'object',
    properties: (themeRaw.properties as Record<string, unknown>) || {},
    ...(Array.isArray(themeRaw.required) && themeRaw.required.length > 0
      ? {required: themeRaw.required}
      : {}),
    ...(themeRaw.additionalProperties !== undefined
      ? {additionalProperties: themeRaw.additionalProperties}
      : {}),
  };
  defs['theme'] = themeObj;
}

function processSingleComponent(
  name: string,
  comp: ComponentApi,
  defs: Record<string, unknown>,
  options?: GenerateCatalogSchemaOptions,
): Record<string, unknown> {
  let props: Record<string, unknown> = {};
  let reqList: string[] = [];
  let additionalProps: boolean | Record<string, unknown> | undefined = undefined;

  if (comp.schema && typeof comp.schema === 'object' && 'safeParse' in comp.schema) {
    const rawZod = zodToJsonSchema(comp.schema, {
      target: 'jsonSchema2019-09',
    }) as Record<string, unknown>;
    cleanSchemaNode(rawZod);

    if (rawZod.definitions && typeof rawZod.definitions === 'object') {
      Object.assign(defs, rawZod.definitions);
    } else if (rawZod.$defs && typeof rawZod.$defs === 'object') {
      Object.assign(defs, rawZod.$defs);
    }

    props = (rawZod.properties as Record<string, unknown>) || {};
    reqList = Array.isArray(rawZod.required)
      ? (rawZod.required as string[]).filter(r => r !== 'component')
      : [];
    additionalProps =
      typeof rawZod.additionalProperties === 'boolean' ||
      (typeof rawZod.additionalProperties === 'object' && rawZod.additionalProperties !== null)
        ? (rawZod.additionalProperties as boolean | Record<string, unknown>)
        : undefined;
  }

  const {component: _ignored, ...sanitizedProps} = props;
  const innerProperties = {
    component: {const: name},
    ...sanitizedProps,
  };
  const innerRequired = ['component', ...reqList];

  let compSchemaObj: Record<string, unknown>;
  if (options?.componentEnvelopeRef) {
    compSchemaObj = {
      allOf: [
        {$ref: options.componentEnvelopeRef},
        {
          type: 'object',
          properties: innerProperties,
          required: innerRequired,
          ...(additionalProps !== undefined ? {additionalProperties: additionalProps} : {}),
        },
      ],
    };
  } else {
    compSchemaObj = {
      type: 'object',
      properties: innerProperties,
      required: innerRequired,
      ...(additionalProps !== undefined ? {additionalProperties: additionalProps} : {}),
    };
  }

  if (comp.allowedParents && comp.allowedParents.length > 0) {
    compSchemaObj['allowedParents'] = comp.allowedParents;
  }
  if (comp.allowedChildren && comp.allowedChildren.length > 0) {
    compSchemaObj['allowedChildren'] = comp.allowedChildren;
  }

  return compSchemaObj;
}

function processComponents(
  catalog: CatalogInterface<any, any>,
  schema: Record<string, unknown>,
  defs: Record<string, unknown>,
  options?: GenerateCatalogSchemaOptions,
): void {
  if (catalog.components.size === 0) {
    schema['components'] = {};
    return;
  }

  const componentsMap: Record<string, unknown> = {};
  for (const [name, comp] of catalog.components.entries()) {
    componentsMap[name] = processSingleComponent(name, comp, defs, options);
  }

  schema['components'] = componentsMap;

  defs['anyComponent'] = {
    oneOf: Array.from(catalog.components.keys()).map(name => ({
      $ref: `#/components/${name}`,
    })),
    discriminator: {
      propertyName: 'component',
    },
  };
}

function processSingleFunction(
  name: string,
  fn: FunctionApi,
  defs: Record<string, unknown>,
): Record<string, unknown> {
  let paramSchemaObj: Record<string, unknown>;
  if (fn.schema && typeof fn.schema === 'object' && 'safeParse' in fn.schema) {
    const rawZod = zodToJsonSchema(fn.schema, {
      target: 'jsonSchema2019-09',
    }) as Record<string, unknown>;
    cleanSchemaNode(rawZod);

    if (rawZod.definitions && typeof rawZod.definitions === 'object') {
      Object.assign(defs, rawZod.definitions);
      delete rawZod.definitions;
    } else if (rawZod.$defs && typeof rawZod.$defs === 'object') {
      Object.assign(defs, rawZod.$defs);
      delete rawZod.$defs;
    }

    paramSchemaObj = rawZod;
  } else {
    paramSchemaObj = {type: 'object', properties: {}};
  }

  const returnType = fn.returnType ?? 'any';
  const fnProperties: Record<string, unknown> = {
    call: {const: name},
    args: paramSchemaObj,
  };
  const fnRequired = ['call', 'args'];

  const fnObj: Record<string, unknown> = {
    type: 'object',
    properties: fnProperties,
    required: fnRequired,
    returnType,
  };

  if (fn.description) {
    fnObj['description'] = fn.description;
  }
  if (fn.allowedCallers) {
    fnObj['allowedCallers'] = fn.allowedCallers;
  }
  if (fn.requiresUserActivation !== undefined) {
    fnObj['requiresUserActivation'] = fn.requiresUserActivation;
  }

  return fnObj;
}

function processFunctions(
  catalog: CatalogInterface<any, any>,
  schema: Record<string, unknown>,
  defs: Record<string, unknown>,
): void {
  if (catalog.functions.size === 0) return;

  const functionsMap: Record<string, unknown> = {};
  for (const [name, fn] of catalog.functions.entries()) {
    functionsMap[name] = processSingleFunction(name, fn, defs);
  }

  schema['functions'] = functionsMap;

  defs['anyFunction'] = {
    oneOf: Array.from(catalog.functions.keys()).map(name => ({
      $ref: `#/functions/${name}`,
    })),
  };
}

/**
 * Reconstructs a specification-compliant A2UI catalog JSON Schema document from a Catalog instance.
 *
 * Converts component and function Zod schemas into standardized JSON Schema definitions,
 * merging sub-definitions, resolving common type references, and building union schemas.
 *
 * @param catalog The catalog instance to serialize.
 * @param options Optional configuration options such as component envelope wrapping.
 * @returns Specification-compliant A2UI Catalog JSON Schema object.
 */
export function generateCatalogSchema<
  T extends ComponentApi = ComponentApi,
  F extends FunctionApi = FunctionApi,
>(
  catalog: CatalogInterface<T, F>,
  options?: GenerateCatalogSchemaOptions,
): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    catalogId: catalog.id,
  };

  if (catalog.instructions) {
    schema['instructions'] = catalog.instructions;
  }

  const defs: Record<string, unknown> = {};

  processTheme(catalog, defs);
  processComponents(catalog, schema, defs, options);
  processFunctions(catalog, schema, defs);

  if (Object.keys(defs).length > 0) {
    schema['$defs'] = defs;
  }

  return schema;
}
