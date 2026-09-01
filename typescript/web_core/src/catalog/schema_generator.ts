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
import {V08_STANDARD_DEFS} from '../v0_8/standard_defs.js';
import {V09_STANDARD_DEFS} from '../v0_9/standard_defs.js';
import {V10_STANDARD_DEFS} from '../v1_0/standard_defs.js';

const STANDARD_DEFS_BY_VERSION: Readonly<Record<string, Record<string, unknown>>> = {
  'v0.8': V08_STANDARD_DEFS,
  'v0.9': V09_STANDARD_DEFS,
  'v0.9.1': V09_STANDARD_DEFS,
  'v1.0': V10_STANDARD_DEFS,
};

/**
 * Resolves the appropriate standard $defs dictionary based on options or catalog configuration.
 */
function getStandardDefsForCatalog(
  catalog: CatalogInterface<any, any>,
  options?: GenerateCatalogSchemaOptions,
): Record<string, unknown> {
  if (options?.standardDefs) {
    return options.standardDefs;
  }
  if (catalog.standardDefs) {
    return catalog.standardDefs;
  }
  if (options?.protocolVersion && options.protocolVersion in STANDARD_DEFS_BY_VERSION) {
    return STANDARD_DEFS_BY_VERSION[options.protocolVersion];
  }
  return V09_STANDARD_DEFS;
}

/**
 * Transforms a schema node with a REF description into a `$ref` definition node.
 */
function transformRefDescriptionNode(obj: Record<string, unknown>): boolean {
  if (typeof obj.description !== 'string' || !obj.description.startsWith('REF:')) {
    return false;
  }
  const content = obj.description.substring(4);
  const pipeIndex = content.indexOf('|');
  const ref = pipeIndex === -1 ? content : content.substring(0, pipeIndex);
  const desc = pipeIndex === -1 ? '' : content.substring(pipeIndex + 1);

  const savedDefault = obj.default;
  for (const key of Object.keys(obj)) {
    delete obj[key];
  }
  obj['$ref'] = ref.startsWith('#') ? ref : `#/$defs/${ref.split('/').pop()}`;
  if (savedDefault !== undefined) {
    obj['default'] = savedDefault;
  }
  if (desc) {
    obj['description'] = desc;
  }
  return true;
}

/**
 * Normalizes property schema structures like anyOf and additionalProperties.
 */
function cleanSchemaProperties(obj: Record<string, unknown>): void {
  if (Array.isArray(obj.anyOf)) {
    obj.oneOf = obj.anyOf;
    delete obj.anyOf;
  }

  if (
    obj.additionalProperties &&
    typeof obj.additionalProperties === 'object' &&
    Object.keys(obj.additionalProperties).length === 0
  ) {
    obj.additionalProperties = true;
  }

  if (
    obj.unevaluatedProperties &&
    typeof obj.unevaluatedProperties === 'object' &&
    Object.keys(obj.unevaluatedProperties).length === 0
  ) {
    obj.unevaluatedProperties = true;
  }

  if ('$schema' in obj) {
    delete obj['$schema'];
  }
}

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

  if (Array.isArray(node)) {
    for (const item of node) {
      cleanSchemaNode(item, visited);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  if (transformRefDescriptionNode(obj)) {
    return;
  }

  cleanSchemaProperties(obj);

  for (const key of Object.keys(obj)) {
    cleanSchemaNode(obj[key], visited);
  }
}

/**
 * Configuration options for catalog JSON schema generation.
 */
export interface GenerateCatalogSchemaOptions {
  /** Reference URI to a base component schema envelope (e.g. `common_types.json#/$defs/ComponentCommon`). */
  componentEnvelopeRef?: string;
  /** Explicit standard $defs dictionary to use when serializing catalog components and functions. */
  standardDefs?: Record<string, unknown>;
  /** Explicit protocol version for standard $defs resolution ('v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0'). */
  protocolVersion?: 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0' | string;
}

function processTheme(catalog: CatalogInterface<any, any>, defs: Record<string, unknown>): void {
  if (!catalog.themeSchema) return;

  const themeRaw = zodToJsonSchema(catalog.themeSchema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  cleanSchemaNode(themeRaw);

  if (themeRaw.definitions && typeof themeRaw.definitions === 'object') {
    Object.assign(defs, themeRaw.definitions);
    delete themeRaw.definitions;
  } else if (themeRaw.$defs && typeof themeRaw.$defs === 'object') {
    Object.assign(defs, themeRaw.$defs);
    delete themeRaw.$defs;
  }

  const isV08 = catalog.id.includes('v0_8') || catalog.id.includes('v0.8');

  const themeObj: Record<string, unknown> = {
    type: 'object',
    properties: (themeRaw.properties as Record<string, unknown>) || {},
    ...(Array.isArray(themeRaw.required) && themeRaw.required.length > 0
      ? {required: themeRaw.required}
      : {}),
    ...(isV08
      ? {}
      : {
          additionalProperties:
            themeRaw.additionalProperties !== undefined ? themeRaw.additionalProperties : true,
        }),
  };
  defs['theme'] = themeObj;
}

/**
 * Extracts raw Zod properties, required fields, and definitions from a component API schema.
 */
function extractZodComponentSchema(
  comp: ComponentApi,
  defs: Record<string, unknown>,
): {
  props: Record<string, unknown>;
  reqList: string[];
  additionalProps: boolean | Record<string, unknown> | undefined;
} {
  if (!comp.schema || typeof comp.schema !== 'object' || !('safeParse' in comp.schema)) {
    return {props: {}, reqList: [], additionalProps: undefined};
  }
  const rawZod = zodToJsonSchema(comp.schema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  cleanSchemaNode(rawZod);

  if (rawZod.definitions && typeof rawZod.definitions === 'object') {
    Object.assign(defs, rawZod.definitions);
  } else if (rawZod.$defs && typeof rawZod.$defs === 'object') {
    Object.assign(defs, rawZod.$defs);
  }

  const props = (rawZod.properties as Record<string, unknown>) || {};
  const reqList = Array.isArray(rawZod.required)
    ? (rawZod.required as string[]).filter(r => r !== 'component' && r !== 'id')
    : [];
  const rawExtra = rawZod.unevaluatedProperties ?? rawZod.additionalProperties;
  const additionalProps =
    typeof rawExtra === 'boolean' || (typeof rawExtra === 'object' && rawExtra !== null)
      ? (rawExtra as boolean | Record<string, unknown>)
      : undefined;

  return {props, reqList, additionalProps};
}

function processSingleComponent(
  name: string,
  comp: ComponentApi,
  defs: Record<string, unknown>,
  _catalog: CatalogInterface<any, any>,
  options?: GenerateCatalogSchemaOptions,
): Record<string, unknown> {
  const {props, reqList, additionalProps} = extractZodComponentSchema(comp, defs);

  const {component: _ignoredComp, id: _ignoredId, ...sanitizedProps} = props;
  const innerProperties = {
    id: {$ref: '#/$defs/ComponentId'},
    ...sanitizedProps,
    component: {const: name},
  };
  const innerRequired = ['id', ...reqList, 'component'];

  let compSchemaObj: Record<string, unknown>;
  if (options?.componentEnvelopeRef) {
    compSchemaObj = {
      allOf: [
        {$ref: options.componentEnvelopeRef},
        {
          type: 'object',
          properties: innerProperties,
          required: innerRequired,
        },
      ],
      unevaluatedProperties: additionalProps !== undefined ? additionalProps : false,
    };
  } else {
    compSchemaObj = {
      type: 'object',
      properties: innerProperties,
      required: innerRequired,
      unevaluatedProperties: additionalProps !== undefined ? additionalProps : false,
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
    componentsMap[name] = processSingleComponent(name, comp, defs, catalog, options);
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
  _name: string,
  fn: FunctionApi,
  defs: Record<string, unknown>,
): Record<string, unknown> {
  if ((fn as any).rawSchema) {
    return (fn as any).rawSchema;
  }

  let paramSchemaObj: Record<string, unknown>;
  if (fn.schema && typeof fn.schema === 'object' && 'safeParse' in fn.schema) {
    const rawZod = zodToJsonSchema(fn.schema, {
      target: 'jsonSchema2019-09',
      $refStrategy: 'none',
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

  if (fn.description && paramSchemaObj.description === undefined) {
    paramSchemaObj.description = fn.description;
  }

  if (paramSchemaObj.type === 'object') {
    const rawExtra =
      (paramSchemaObj as any).unevaluatedProperties ?? (paramSchemaObj as any).additionalProperties;
    const additionalProps =
      typeof rawExtra === 'boolean' || (typeof rawExtra === 'object' && rawExtra !== null)
        ? (rawExtra as boolean | Record<string, unknown>)
        : undefined;

    if (paramSchemaObj.additionalProperties !== undefined) {
      delete paramSchemaObj.additionalProperties;
    }
    paramSchemaObj.unevaluatedProperties = additionalProps !== undefined ? additionalProps : false;
  }

  return paramSchemaObj;
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

function collectReferencedDefs(
  node: unknown,
  referenced: Set<string>,
  visited = new Set<unknown>(),
): void {
  if (typeof node !== 'object' || node === null) return;
  if (visited.has(node)) return;
  visited.add(node);

  if (typeof (node as Record<string, unknown>)['$ref'] === 'string') {
    const ref = (node as Record<string, unknown>)['$ref'] as string;
    if (ref.startsWith('#/$defs/')) {
      referenced.add(ref.substring('#/$defs/'.length));
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectReferencedDefs(item, referenced, visited);
    }
  } else {
    for (const val of Object.values(node as Record<string, unknown>)) {
      collectReferencedDefs(val, referenced, visited);
    }
  }
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

  const referenced = new Set<string>();
  collectReferencedDefs(schema, referenced);

  const standardDefs = getStandardDefsForCatalog(catalog, options);

  // Fixed-point iteration to discover all transitive $defs references
  let defsCountBefore: number;
  do {
    defsCountBefore = Object.keys(defs).length;
    const referenced = new Set<string>();
    collectReferencedDefs(schema, referenced);
    collectReferencedDefs(defs, referenced);

    if (
      referenced.has('DynamicString') ||
      referenced.has('DynamicNumber') ||
      referenced.has('DynamicBoolean') ||
      referenced.has('DynamicValue')
    ) {
      referenced.add('DataBinding');
      referenced.add('FunctionCall');
    }

    for (const refName of referenced) {
      if (refName in standardDefs && !(refName in defs)) {
        defs[refName] = standardDefs[refName];
      }
    }
  } while (Object.keys(defs).length > defsCountBefore);

  if (Object.keys(defs).length > 0) {
    schema['$defs'] = defs;
  }

  return schema;
}
